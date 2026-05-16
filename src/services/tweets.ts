/**
 * TweetService — storage, pagination, and search for X tweets.
 *
 * Tweets never pass through an LLM. There is no relevance evaluation, no
 * summarization, and no per-item AI processing. Content is stored and
 * returned raw.
 */

import type { Database, Statement } from "bun:sqlite";
import type { Logger } from "pino";
import type { RawTweet, Tweet, TweetStats } from "./tweets-types.js";
import { TWEET_TTL } from "./tweets-types.js";

interface GetTweetsOpts {
  limit?: number;
  username?: string;
  beforePublishedAt?: number;
  beforeId?: string;
  afterPublishedAt?: number;
  afterId?: string;
}

interface SearchTweetsOpts {
  query?: string;
  coins?: string[];
  username?: string;
  limit?: number;
}

interface Stmts {
  insert: Statement;
  updateStats: Statement;
  getById: Statement;
  dismiss: Statement;
  pruneExpired: Statement;
  pendingEvaluation: Statement;
  updateRelevance: Statement;
}

export class TweetService {
  private readonly log: Logger;
  private readonly stmts: Stmts;

  constructor(private readonly db: Database, logger: Logger) {
    this.log = logger;
    this.stmts = {
      insert: db.prepare(`
        INSERT OR IGNORE INTO tweets
          (id, username, display_name, avatar_url, tweet_id, url, content, image_url, coins, stats_json, published_at, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      updateStats: db.prepare(`UPDATE tweets SET stats_json = ? WHERE username = ? AND tweet_id = ?`),
      getById: db.prepare(`SELECT * FROM tweets WHERE id = ?`),
      dismiss: db.prepare(`UPDATE tweets SET dismissed_at = unixepoch() WHERE id = ?`),
      pruneExpired: db.prepare(`DELETE FROM tweets WHERE expires_at < unixepoch()`),
      pendingEvaluation: db.prepare(`
        SELECT id, username, content, coins
        FROM tweets
        WHERE ai_relevant IS NULL AND dismissed_at IS NULL
        ORDER BY published_at DESC
        LIMIT ?
      `),
      updateRelevance: db.prepare(`UPDATE tweets SET ai_relevant = ? WHERE id = ?`),
    };
  }

  /** Insert a batch of raw tweets. Idempotent on (username, tweet_id). */
  insertTweets(raws: RawTweet[]): number {
    if (raws.length === 0) return 0;
    const now = Math.floor(Date.now() / 1000);
    let inserted = 0;
    for (const raw of raws) {
      const stats = raw.stats ? JSON.stringify(raw.stats) : null;
      // Always refresh stats for already-stored tweets so counts stay live.
      if (stats) this.stmts.updateStats.run(stats, raw.username, raw.tweetId);

      const id = crypto.randomUUID();
      const result = this.stmts.insert.run(
        id,
        raw.username,
        raw.displayName ?? null,
        raw.avatarUrl ?? null,
        raw.tweetId,
        raw.url,
        raw.content,
        raw.imageUrl ?? null,
        JSON.stringify(raw.coins),
        stats,
        raw.publishedAt,
        now,
        raw.publishedAt + TWEET_TTL,
      );
      if (Number(result.changes ?? 0) > 0) inserted++;
    }
    this.stmts.pruneExpired.run();
    return inserted;
  }

  getTweet(id: string): Tweet | null {
    const row = this.stmts.getById.get(id) as Record<string, unknown> | null;
    return row ? mapTweet(row) : null;
  }

  /** Cursor-paginated feed. Defaults to 20 most recent, descending. */
  getTweets(opts: GetTweetsOpts = {}): Tweet[] {
    const limit = opts.limit ?? 20;
    const where: string[] = ["dismissed_at IS NULL", "(ai_relevant IS NULL OR ai_relevant = 1)"];
    const params: Array<string | number> = [];

    if (opts.username) {
      where.push("username = ?");
      params.push(opts.username);
    }
    if (opts.beforePublishedAt !== undefined && opts.beforeId !== undefined) {
      where.push("(published_at < ? OR (published_at = ? AND id < ?))");
      params.push(opts.beforePublishedAt, opts.beforePublishedAt, opts.beforeId);
    } else if (opts.afterPublishedAt !== undefined && opts.afterId !== undefined) {
      where.push("(published_at > ? OR (published_at = ? AND id > ?))");
      params.push(opts.afterPublishedAt, opts.afterPublishedAt, opts.afterId);
    }

    const sql = `
      SELECT id, username, display_name, avatar_url, tweet_id, url, content, image_url, coins,
             stats_json, published_at, fetched_at, expires_at
      FROM tweets
      WHERE ${where.join(" AND ")}
      ORDER BY published_at DESC, id DESC
      LIMIT ?
    `;
    params.push(limit);
    return this.db.prepare(sql).all(...params).map((r) => mapTweet(r as Record<string, unknown>));
  }

  /** Agent-facing search. Matches content LIKE ?, optional username, optional coins. */
  searchTweets(opts: SearchTweetsOpts = {}): Tweet[] {
    const limit = Math.min(opts.limit ?? 50, 100);
    const where: string[] = ["dismissed_at IS NULL", "(ai_relevant IS NULL OR ai_relevant = 1)"];
    const params: Array<string | number> = [];

    if (opts.query) {
      where.push("content LIKE ?");
      params.push(`%${opts.query}%`);
    }
    if (opts.username) {
      where.push("username = ?");
      params.push(opts.username.replace(/^@/, ""));
    }
    if (opts.coins && opts.coins.length > 0) {
      const placeholders = opts.coins.map(() => "?").join(", ");
      where.push(`EXISTS (SELECT 1 FROM json_each(coins) WHERE value IN (${placeholders}))`);
      params.push(...opts.coins.map((c) => c.toUpperCase()));
    }

    const sql = `
      SELECT id, username, display_name, avatar_url, tweet_id, url, content, image_url, coins,
             stats_json, published_at, fetched_at, expires_at
      FROM tweets
      WHERE ${where.join(" AND ")}
      ORDER BY published_at DESC, id DESC
      LIMIT ?
    `;
    params.push(limit);
    return this.db.prepare(sql).all(...params).map((r) => mapTweet(r as Record<string, unknown>));
  }

  /** Total count of non-dismissed, relevant (or pending) tweets, optionally scoped to a username. */
  countTweets(opts: { username?: string } = {}): number {
    const sql = opts.username
      ? `SELECT COUNT(*) AS c FROM tweets WHERE dismissed_at IS NULL AND (ai_relevant IS NULL OR ai_relevant = 1) AND username = ?`
      : `SELECT COUNT(*) AS c FROM tweets WHERE dismissed_at IS NULL AND (ai_relevant IS NULL OR ai_relevant = 1)`;
    const row = opts.username
      ? this.db.prepare(sql).get(opts.username)
      : this.db.prepare(sql).get();
    return Number((row as { c: number } | null)?.c ?? 0);
  }

  /** Return tweets not yet classified by the evaluate job. */
  listPendingEvaluations(batchSize = 20): Array<{ id: string; username: string; content: string; coins: string[] }> {
    const rows = this.stmts.pendingEvaluation.all(batchSize) as Array<{
      id: string;
      username: string;
      content: string;
      coins: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      content: r.content,
      coins: JSON.parse(r.coins || "[]") as string[],
    }));
  }

  /**
   * Persist evaluation decisions. IDs in selectedIds get ai_relevant=1;
   * all other candidates get ai_relevant=0. Mirrors NewsService.saveEvaluation.
   */
  saveEvaluation(
    candidates: ReadonlyArray<{ id: string }>,
    selectedIds: ReadonlyArray<string>,
  ): void {
    const selected = new Set(selectedIds);
    for (const tweet of candidates) {
      this.stmts.updateRelevance.run(selected.has(tweet.id) ? 1 : 0, tweet.id);
    }
  }

  dismissTweet(id: string): void {
    this.stmts.dismiss.run(id);
  }

  pruneExpired(): number {
    const res = this.stmts.pruneExpired.run();
    return Number(res.changes ?? 0);
  }
}

function mapTweet(row: Record<string, unknown>): Tweet {
  let stats: TweetStats | null = null;
  if (row.stats_json) {
    try { stats = JSON.parse(row.stats_json as string) as TweetStats; } catch { /* ignore */ }
  }
  return {
    id: row.id as string,
    username: row.username as string,
    displayName: (row.display_name as string) ?? null,
    tweetId: row.tweet_id as string,
    url: (row.url as string) ?? null,
    content: row.content as string,
    imageUrl: (row.image_url as string) ?? null,
    avatarUrl: (row.avatar_url as string) ?? null,
    coins: JSON.parse((row.coins as string) || "[]") as string[],
    stats,
    publishedAt: row.published_at as number,
    fetchedAt: row.fetched_at as number,
    expiresAt: row.expires_at as number,
  };
}
