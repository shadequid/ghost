/**
 * News service — SQLite-backed news aggregation with dedup, classification, and pruning.
 */

import type { Database } from "bun:sqlite";
import type { WatchlistService } from "./watchlist.js";
import type { CredentialStore } from "../config/credentials.js";
import type { Logger } from "pino";
import {
  type NewsArticle,
  type NewsSource,
  type Importance,
  URGENT_KEYWORDS,
  CRYPTO_KEYWORDS,
  URGENT_TTL,
  IMPORTANT_TTL,
  REFERENCE_TTL,
  NEWS_SOURCE_PRESETS,
} from "./news-types.js";
import { createAdapter, type RawArticle } from "./news-sources.js";
import { mapRow, mapSource, tokenize, tokenOverlap } from "./news-helpers.js";

export class NewsService {
  private readonly stmts;
  private readonly log: Logger;

  constructor(
    private readonly db: Database,
    private readonly watchlist: WatchlistService,
    private readonly credentials: CredentialStore | undefined,
    logger: Logger,
  ) {
    this.log = logger;
    this.stmts = {
      insertArticle: db.prepare(`
        INSERT OR IGNORE INTO articles
          (id, source_id, external_id, url, title, snippet, image_url, coins, importance, published_at, fetched_at, expires_at, full_summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      dismissArticle: db.prepare(`UPDATE articles SET dismissed_at = unixepoch() WHERE id = ?`),
      pruneExpired: db.prepare(`DELETE FROM articles WHERE expires_at < unixepoch()`),
      getArticle: db.prepare(`SELECT * FROM articles WHERE id = ?`),
      updateSummary: db.prepare(`UPDATE articles SET full_summary = ? WHERE id = ?`),
      // Recent titles for cross-source dedup (within 6h window)
      recentTitles: db.prepare(`
        SELECT id, title FROM articles
        WHERE published_at > ? AND source_id != ?
      `),
      // Source management
      listSources: db.prepare(`SELECT source_id, name, enabled, api_key, custom_url, added_at FROM news_sources ORDER BY added_at`),
      upsertSource: db.prepare(`
        INSERT INTO news_sources (source_id, name, enabled, api_key, custom_url)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), news_sources.name), enabled = excluded.enabled, api_key = COALESCE(excluded.api_key, news_sources.api_key), custom_url = COALESCE(excluded.custom_url, news_sources.custom_url)
      `),
      toggleSource: db.prepare(`UPDATE news_sources SET enabled = ? WHERE source_id = ?`),
      setApiKey: db.prepare(`UPDATE news_sources SET api_key = ? WHERE source_id = ?`),
      removeSource: db.prepare(`DELETE FROM news_sources WHERE source_id = ?`),
      getSource: db.prepare(`SELECT source_id, name, enabled, api_key, custom_url, added_at FROM news_sources WHERE source_id = ?`),
      unsummarized: db.prepare(`SELECT id FROM articles WHERE full_summary IS NULL AND ai_relevant = 1 ORDER BY published_at DESC LIMIT ?`),
      // AI relevance evaluation
      updateRelevance: db.prepare(`UPDATE articles SET ai_relevant = ? WHERE id = ?`),
      updateDuplicate: db.prepare(`UPDATE articles SET ai_duplicate_of = ? WHERE id = ?`),
      pendingEvaluation: db.prepare(`SELECT id, title, snippet FROM articles WHERE ai_relevant IS NULL ORDER BY published_at DESC LIMIT ?`),
      evaluatedTitles: db.prepare(`SELECT id, title FROM articles WHERE ai_relevant IS NOT NULL ORDER BY published_at DESC LIMIT ?`),
      // Per-(chat, scope) /news pagination — track which articles were
      // already delivered to a chat so the next call can drain different
      // ones. Pruned alongside expired articles to bound storage.
      markShown: db.prepare(`
        INSERT OR IGNORE INTO news_shown (chat_id, scope, article_id, shown_at)
        VALUES (?, ?, ?, unixepoch())
      `),
      pruneOrphanedShown: db.prepare(`
        DELETE FROM news_shown WHERE article_id NOT IN (SELECT id FROM articles)
      `),
    };

    this.seedPresets();
  }

  private seedPresets(): void {
    for (const preset of NEWS_SOURCE_PRESETS) {
      const existing = this.stmts.getSource.get(preset.sourceId) as { source_id: string } | undefined;
      if (!existing) {
        // RSS sources enabled by default (no API key needed), API sources disabled
        const enabled = preset.needsApiKey ? 0 : 1;
        this.stmts.upsertSource.run(preset.sourceId, preset.name, enabled, null, preset.defaultUrl ?? null);
      }
    }
  }

  async fetchAll(): Promise<number> {
    const sources = this.getSources().filter((s) => s.enabled);
    if (sources.length === 0) return 0;

    const results = await Promise.allSettled(
      sources.map(async (source) => {
        const adapter = createAdapter(source.sourceId, source.customUrl ?? undefined);
        if (!adapter) return [];
        const apiKey = await this.getSourceApiKey(source.sourceId);
        return adapter.fetch(apiKey ?? undefined, source.customUrl ?? undefined);
      }),
    );

    const now = Math.floor(Date.now() / 1000);
    const watchlistSymbols = new Set(this.watchlist.list().map((w) => w.symbol));
    let inserted = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        this.log.warn({ source: sources[i].sourceId, reason: result.reason }, "source fetch failed");
        continue;
      }

      for (const raw of result.value) {
        // Cross-source dedup check
        if (this.isDuplicate(raw, sources[i].sourceId, now)) continue;

        const importance = this.classifyImportance(raw, watchlistSymbols);
        const ttl = importance === "urgent" ? URGENT_TTL : importance === "important" ? IMPORTANT_TTL : REFERENCE_TTL;
        const id = crypto.randomUUID();

        try {
          this.stmts.insertArticle.run(
            id,
            sources[i].sourceId,
            raw.externalId,
            raw.url,
            raw.title,
            raw.snippet,
            raw.imageUrl ?? null,
            JSON.stringify(raw.coins),
            importance,
            raw.publishedAt,
            now,
            raw.publishedAt + ttl,
            null,
          );
          inserted++;
        } catch {
          // UNIQUE constraint violation — same source+externalId, skip
        }
      }
    }

    // Prune expired articles
    this.pruneExpired();
    return inserted;
  }

  getArticles(opts: {
    limit?: number;
    offset?: number;
    importance?: Importance;
    coins?: string[];
    // Cursor pagination — stable against concurrent inserts (evaluator job)
    beforePublishedAt?: number;
    beforeId?: string;
    afterPublishedAt?: number;
    afterId?: string;
  } = {}): NewsArticle[] {
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    const coins = opts.coins?.map((c) => c.toUpperCase()) ?? [];

    const coinClause = coins.length > 0
      ? `AND EXISTS (SELECT 1 FROM json_each(coins) WHERE value IN (${coins.map(() => "?").join(", ")}))`
      : "";
    const importanceClause = opts.importance ? `AND importance = ?` : "";

    let cursorClause = "";
    const cursorParams: Array<string | number> = [];
    if (opts.beforePublishedAt !== undefined && opts.beforeId !== undefined) {
      cursorClause = "AND (published_at < ? OR (published_at = ? AND id < ?))";
      cursorParams.push(opts.beforePublishedAt, opts.beforePublishedAt, opts.beforeId);
    } else if (opts.afterPublishedAt !== undefined && opts.afterId !== undefined) {
      cursorClause = "AND (published_at > ? OR (published_at = ? AND id > ?))";
      cursorParams.push(opts.afterPublishedAt, opts.afterPublishedAt, opts.afterId);
    }

    // full_summary IS NOT NULL: hide articles still in the
    // evaluate→summarize pipeline. The chain runs in the background news
    // jobs with a short window (≤ ~20 s) and summarizeBatch falls back to
    // [partial]<snippet> on LLM failure, so articles eventually appear
    // either way. Filtering at the API keeps the widget contract
    // "showed = ready to read" and removes the half-rendered state.
    const sql = `
      SELECT id, source_id, external_id, url, title, snippet, image_url, coins,
             importance, published_at, fetched_at, expires_at, full_summary,
             ai_relevant, ai_duplicate_of
      FROM articles
      WHERE ai_relevant = 1 AND ai_duplicate_of IS NULL AND dismissed_at IS NULL
        AND full_summary IS NOT NULL
        ${coinClause} ${importanceClause} ${cursorClause}
      ORDER BY published_at DESC, id DESC
      LIMIT ? OFFSET ?
    `;
    const params = [
      ...coins,
      ...(opts.importance ? [opts.importance] : []),
      ...cursorParams,
      limit,
      offset,
    ];
    return this.db.prepare(sql).all(...params).map((r) => mapRow(r as Record<string, unknown>));
  }

  /**
   * Observer news detector input. Limit defaults to 20 to bound judge prompt size.
   * Caller filters by coin / position match — this read returns every ready article.
   */
  listRecentRelevant(sinceTs: number, limit = 20): NewsArticle[] {
    const sql = `
      SELECT id, source_id, external_id, url, title, snippet, image_url, coins,
             importance, published_at, fetched_at, expires_at, full_summary,
             ai_relevant, ai_duplicate_of
      FROM articles
      WHERE ai_relevant = 1
        AND full_summary IS NOT NULL
        AND ai_duplicate_of IS NULL
        AND dismissed_at IS NULL
        AND expires_at > unixepoch()
        AND published_at > ?
      ORDER BY published_at DESC, id DESC
      LIMIT ?
    `;
    return this.db
      .prepare(sql)
      .all(sinceTs, limit)
      .map((r) => mapRow(r as Record<string, unknown>));
  }

  /** Search articles by keyword and/or coins. For agent tool use. */
  searchArticles(opts: { query?: string; coins?: string[]; limit?: number } = {}): NewsArticle[] {
    const limit = Math.min(opts.limit ?? 50, 100);
    const conditions: string[] = ["ai_duplicate_of IS NULL"];
    const params: Array<string | number> = [];

    // Keyword search
    if (opts.query) {
      conditions.push("(title LIKE ? OR snippet LIKE ?)");
      const pattern = `%${opts.query}%`;
      params.push(pattern, pattern);
    }

    // Coin filter
    if (opts.coins && opts.coins.length > 0) {
      const placeholders = opts.coins.map(() => "?").join(", ");
      conditions.push(`EXISTS (SELECT 1 FROM json_each(coins) WHERE value IN (${placeholders}))`);
      params.push(...opts.coins.map((c) => c.toUpperCase()));
    }

    params.push(limit);
    const sql = `
      SELECT id, source_id, external_id, url, title, snippet, image_url, coins,
             importance, published_at, fetched_at, expires_at, full_summary,
             ai_relevant, ai_duplicate_of
      FROM articles
      WHERE ${conditions.join(" AND ")}
      ORDER BY published_at DESC
      LIMIT ?
    `;
    return (this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>).map(mapRow);
  }

  /** Total count of relevant non-dismissed articles, optionally filtered. */
  countArticles(opts: { coins?: string[]; importance?: Importance } = {}): number {
    const coins = opts.coins?.map((c) => c.toUpperCase()) ?? [];
    const coinClause = coins.length > 0
      ? `AND EXISTS (SELECT 1 FROM json_each(coins) WHERE value IN (${coins.map(() => "?").join(", ")}))`
      : "";
    const importanceClause = opts.importance ? `AND importance = ?` : "";
    // Same visibility filter as getArticles — count must match what the
    // widget will actually render.
    const sql = `
      SELECT COUNT(*) AS c FROM articles
      WHERE ai_relevant = 1 AND ai_duplicate_of IS NULL AND dismissed_at IS NULL
        AND full_summary IS NOT NULL
        ${coinClause} ${importanceClause}
    `;
    const params = [...coins, ...(opts.importance ? [opts.importance] : [])];
    const row = this.db.prepare(sql).get(...params) as { c: number } | null;
    return Number(row?.c ?? 0);
  }

  getArticle(articleId: string): NewsArticle | null {
    const row = this.stmts.getArticle.get(articleId) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }

  pruneExpired(): number {
    const result = this.stmts.pruneExpired.run();
    // Also drop orphaned `news_shown` rows whose article was just expired.
    // Bounds storage for active /news users without a separate cron.
    this.stmts.pruneOrphanedShown.run();
    return result.changes;
  }

  /**
   * Return up to `limit` relevant non-dismissed articles that have NOT been
   * delivered to (`chatId`, `scope`) yet via /news. Sorted newest-first so a
   * trader catching up sees fresh news at the top of every batch.
   *
   * `scope` is `global` (no filter) or `symbol:<SYM>` (only articles with
   * `<SYM>` in `coins`). Each scope has an independent shown-set, so
   * `/news` and `/news BTC` drain in parallel without colliding.
   *
   * Caller is responsible for calling {@link markArticlesShown} after a
   * successful delivery — read + write are split so a failed Telegram send
   * doesn't accidentally mark unsent articles as seen.
   */
  getUnshownArticles(
    chatId: string,
    scope: string,
    opts: { limit?: number; symbol?: string } = {},
  ): NewsArticle[] {
    const limit = opts.limit ?? 5;
    const params: Array<string | number> = [chatId, scope];
    let coinClause = "";
    if (opts.symbol) {
      coinClause = `AND EXISTS (SELECT 1 FROM json_each(a.coins) WHERE value = ?)`;
      params.push(opts.symbol.toUpperCase());
    }
    params.push(limit);
    const sql = `
      SELECT a.id, a.source_id, a.external_id, a.url, a.title, a.snippet,
             a.image_url, a.coins, a.importance, a.published_at, a.fetched_at,
             a.expires_at, a.full_summary, a.ai_relevant, a.ai_duplicate_of
      FROM articles a
      WHERE a.ai_relevant = 1
        AND a.ai_duplicate_of IS NULL
        AND a.dismissed_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM news_shown s
          WHERE s.article_id = a.id AND s.chat_id = ? AND s.scope = ?
        )
        ${coinClause}
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT ?
    `;
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => mapRow(r as Record<string, unknown>));
  }

  /** Record that the listed articles were delivered to (`chatId`, `scope`).
   *  Idempotent — re-marking is a no-op via INSERT OR IGNORE. */
  markArticlesShown(chatId: string, scope: string, articleIds: ReadonlyArray<string>): void {
    if (articleIds.length === 0) return;
    for (const id of articleIds) {
      this.stmts.markShown.run(chatId, scope, id);
    }
  }

  getSources(): NewsSource[] {
    const rows = this.stmts.listSources.all() as Array<Record<string, unknown>>;
    return rows.map(mapSource);
  }

  /** Fast lookup table from `sourceId` → display `name` for renderers that
   *  need to show the human-readable name (e.g. /news on Telegram showing
   *  `CoinTelegraph` instead of `cointelegraph`). One query per call —
   *  cheap enough to call once per /news invocation. */
  getSourceNames(): Map<string, string> {
    const sources = this.getSources();
    return new Map(sources.map((s) => [s.sourceId, s.name]));
  }

  toggleSource(sourceId: string, enabled: boolean): void {
    this.stmts.toggleSource.run(enabled ? 1 : 0, sourceId);
  }

  async setSourceApiKey(sourceId: string, apiKey: string): Promise<void> {
    if (this.credentials) {
      await this.credentials.set(`news_api_key:${sourceId}`, apiKey);
    } else {
      // Fallback: store in DB (should not happen in production)
      this.stmts.setApiKey.run(apiKey, sourceId);
    }
  }

  /** Retrieve API key from CredentialStore, falling back to DB column. */
  private async getSourceApiKey(sourceId: string): Promise<string | null> {
    if (this.credentials) {
      const key = await this.credentials.get(`news_api_key:${sourceId}`);
      if (key) return key;
    }
    // Fallback: check DB column for legacy/migration
    const source = this.stmts.getSource.get(sourceId) as { api_key: string | null } | undefined;
    return source?.api_key ?? null;
  }

  /**
   * Upsert a news source. On conflict the name and customUrl are updated.
   * Used by the agent tool layer to persist discovered feeds.
   */
  upsertSource(opts: { sourceId: string; name: string; enabled: boolean; customUrl: string }): void {
    this.stmts.upsertSource.run(opts.sourceId, opts.name, opts.enabled ? 1 : 0, null, opts.customUrl);
  }

  addCustomRss(url: string, name: string): { ok: boolean; error?: string } {
    // Validate URL format
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: "URL must use http:// or https://" };
      }
    } catch {
      return { ok: false, error: "Invalid URL format" };
    }

    const sourceId = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const existing = this.stmts.getSource.get(sourceId) as { source_id: string } | undefined;
    if (existing) {
      return { ok: false, error: `Source "${name}" already exists` };
    }

    this.stmts.upsertSource.run(sourceId, name, 1, null, url);
    return { ok: true };
  }

  dismissArticle(articleId: string): boolean {
    const result = this.stmts.dismissArticle.run(articleId);
    return result.changes > 0;
  }

  removeCustomSource(sourceId: string): boolean {
    // Only allow removing non-preset sources
    const isPreset = NEWS_SOURCE_PRESETS.some((p) => p.sourceId === sourceId);
    if (isPreset) return false;
    const result = this.stmts.removeSource.run(sourceId);
    return result.changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Pure CRUD — called from the news background jobs via taskAgent
  // ---------------------------------------------------------------------------

  /**
   * Return up to `limit` relevant articles that still need a full_summary.
   * Called by the news-summarize job before prompting taskAgent.
   */
  listPendingSummaries(limit = 10): NewsArticle[] {
    const rows = this.stmts.unsummarized.all(limit) as Array<{ id: string }>;
    return rows
      .map((r) => this.getArticle(r.id))
      .filter((a): a is NewsArticle => !!a);
  }

  /**
   * Persist a summary text for the given article.
   * Caller is responsible for passing a non-empty string.
   */
  saveSummary(articleId: string, text: string): void {
    this.stmts.updateSummary.run(text, articleId);
  }

  /**
   * Return up to `batchSize` articles that have not been evaluated for
   * AI relevance yet (ai_relevant IS NULL), after applying the rule-based
   * crypto pre-filter. Irrelevant articles are marked immediately so the
   * caller's AI call is scoped to genuine candidates only.
   *
   * Returns `{ candidates, total }` where `total` is the raw pending count
   * (pre-filter) so the caller can log how many were processed overall.
   */
  listPendingEvaluations(batchSize = 20): {
    candidates: Array<{ id: string; title: string; snippet: string }>;
    existingTitles: Array<{ id: string; title: string }>;
    total: number;
  } {
    const pending = this.stmts.pendingEvaluation.all(batchSize) as Array<{
      id: string;
      title: string;
      snippet: string;
    }>;
    if (pending.length === 0) {
      return { candidates: [], existingTitles: [], total: 0 };
    }

    // Tier 1: Rule-based pre-filter (free, no tokens)
    const candidates: typeof pending = [];
    const rejected: typeof pending = [];
    for (const article of pending) {
      if (this.isCryptoRelevant(article.title, article.snippet)) {
        candidates.push(article);
      } else {
        rejected.push(article);
      }
    }

    // Mark rejected articles irrelevant immediately
    for (const article of rejected) {
      this.stmts.updateRelevance.run(0, article.id);
    }
    if (rejected.length > 0) {
      this.log.info(
        { rejected: rejected.length, candidates: candidates.length },
        "pre-filter complete",
      );
    }

    const existingTitles = this.stmts.evaluatedTitles.all(50) as Array<{
      id: string;
      title: string;
    }>;

    return { candidates, existingTitles, total: pending.length };
  }

  /**
   * Persist evaluation decisions returned by the AI.
   * `selectedIds` is the set of article IDs the AI deemed relevant.
   * All candidates not in that set are marked irrelevant.
   */
  saveEvaluation(
    candidates: ReadonlyArray<{ id: string }>,
    selectedIds: ReadonlyArray<string>,
  ): void {
    const selected = new Set(selectedIds);
    for (const article of candidates) {
      this.stmts.updateRelevance.run(selected.has(article.id) ? 1 : 0, article.id);
    }
  }

  /** Rule-based check: does the article mention crypto at all? */
  private isCryptoRelevant(title: string, snippet: string): boolean {
    const text = `${title} ${snippet}`.toLowerCase();
    // Pass if any crypto keyword matches
    for (const kw of CRYPTO_KEYWORDS) {
      if (text.includes(kw)) return true;
    }
    return false;
  }

  private classifyImportance(raw: RawArticle, watchlistSymbols: Set<string>): Importance {
    const text = `${raw.title} ${raw.snippet}`.toLowerCase();

    // Check urgent keywords
    for (const keyword of URGENT_KEYWORDS) {
      if (text.includes(keyword)) return "urgent";
    }

    // CryptoPanic importance signal
    if (raw.importanceSignal !== undefined && raw.importanceSignal > 2) return "important";

    // Watchlist overlap
    if (raw.coins.some((c) => watchlistSymbols.has(c))) return "important";

    return "reference";
  }

  private isDuplicate(raw: RawArticle, sourceId: string, now: number): boolean {
    const sixHoursAgo = now - 6 * 3600;
    const recent = this.stmts.recentTitles.all(sixHoursAgo, sourceId) as Array<{ id: string; title: string }>;

    const tokens = tokenize(raw.title);
    if (tokens.length === 0) return false;

    for (const existing of recent) {
      const existingTokens = tokenize(existing.title);
      if (existingTokens.length === 0) continue;
      const overlap = tokenOverlap(tokens, existingTokens);
      if (overlap >= 0.6) return true;
    }

    return false;
  }
}
