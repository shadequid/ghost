/**
 * X/Twitter follow service — track accounts and fetch tweets via authenticated GraphQL API.
 *
 * User provides session cookies (auth_token + ct0) once. Ghost fetches tweets
 * every 5 min for followed accounts. Tweets flow into TweetService as RawTweet.
 */

import type { Database } from "bun:sqlite";
import type { CredentialStore } from "../config/credentials.js";
import { tagCoins } from "./news-sources.js";
import type { RawTweet } from "./tweets-types.js";
import type { XQueryIdCache } from "./x-query-ids.js";
import type { Logger } from "pino";

// Public bearer token embedded in X's frontend JS — same for all users.
const X_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const X_FEATURES: Record<string, boolean> = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const FETCH_WINDOW_S = 24 * 3600; // fetch cycle: only process tweets from last 24h
const CRED_AUTH = "x_auth_token";
const CRED_CT0 = "x_ct0";
const CRED_USER = "x_screen_name";
const CRED_SELF_USER_ID = "x_self_user_id";
const CRED_INCLUDE_FOLLOWING = "x_include_following";
const FOLLOWING_CACHE_TTL_MS = 6 * 3600 * 1000; // re-resolve Following list every 6h
const FOLLOWING_CAP_PER_CYCLE = 50;             // cap UserTweets calls per cycle
const FOLLOWING_REQ_DELAY_MS = 3000;            // throttle UserTweets (X ≈ 500/15min; 3s leaves headroom for X's shorter sub-minute window)

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Thrown when X returns HTTP 429. `retryAfterMs` is sourced from the
 * `Retry-After` response header — integer seconds or HTTP-date — falling
 * back to 60 s when the header is missing or unparseable. The daemon uses
 * this hint to schedule the next fetch cycle precisely, instead of the
 * generic exponential backoff that applies to other errors.
 */
export class XRateLimitError extends Error {
  readonly retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "XRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Parse the `Retry-After` HTTP header into milliseconds. Supports:
 *   - Integer seconds (e.g. "120")
 *   - HTTP-date (e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
 *   - Missing / unparseable → fallback value
 */
export function parseRetryAfter(header: string | null, fallbackMs = 60_000): number {
  if (!header) return fallbackMs;
  const trimmed = header.trim();
  // Integer seconds — explicit regex so "0", "-5", "30s" all bypass the
  // date-parse branch (where `new Date("0")` or `new Date("-5")` can parse
  // as year 2000 / year -5 respectively).
  if (/^-?\d+$/.test(trimmed)) {
    const asInt = Number.parseInt(trimmed, 10);
    if (asInt > 0) return asInt * 1000;
    return fallbackMs;
  }
  // HTTP-date — only attempted when the header isn't a pure integer.
  const asDate = new Date(trimmed);
  if (!Number.isNaN(asDate.getTime())) {
    return Math.max(0, asDate.getTime() - Date.now());
  }
  return fallbackMs;
}

export interface XFollow {
  username: string;
  userId: string | null;
  displayName: string | null;
  addedAt: number;
  enabled: boolean;
  source: "following" | "manual";
}

/** Result row for `XFollowService.search` — `notFollow` rows may be missing
 *  `userId` / `displayName` when the X profile lookup is degraded. */
export interface XSearchCandidate {
  username: string;
  userId?: string;
  displayName?: string;
}

interface FollowedUser {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Emitted as each per-account UserTweets call returns so callers can insert
 * into the DB immediately (vs. waiting the full ≥50 s cycle). The consumer
 * (the daemon background loop) is responsible for persistence + event emission.
 */
export type XFollowBatchSink = (batch: RawTweet[], source: "following" | "manual") => void;

/** Lifecycle state of the background fetch cycle — surfaced to the UI so the
 *  widget can render a "Fetching X timeline…" hint on first connect instead of
 *  looking frozen while the cycle crawls through up to 50 accounts at 1 req/s. */
export type XFetchState = "idle" | "running" | "backoff";

/** Upgrade a `_normal.` profile image URL to the slightly crisper `_bigger.` variant. */
function biggerAvatar(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace("_normal.", "_bigger.");
}

export class XFollowService {
  private readonly stmts;
  private readonly log: Logger;
  private onEnableCallback: (() => void | Promise<void>) | null = null;
  private followingCache: { list: FollowedUser[]; fetchedAt: number } | null = null;
  private fetchState: XFetchState = "idle";

  constructor(
    private readonly db: Database,
    private readonly credentials: CredentialStore,
    private readonly queryIds: XQueryIdCache,
    logger: Logger,
  ) {
    this.log = logger;
    this.stmts = {
      add: db.prepare(
        `INSERT INTO x_follows (username, user_id, display_name, source, enabled, user_disabled)
         VALUES (?, ?, ?, ?, 1, 0)
         ON CONFLICT(username) DO NOTHING`,
      ),
      // Following auto-import: insert with source='following'. If the row
      // already exists (manual add or previous following sync), preserve the
      // existing user override flags — don't reset enabled/user_disabled.
      addFollowing: db.prepare(
        `INSERT INTO x_follows (username, user_id, display_name, source, enabled, user_disabled)
         VALUES (?, ?, ?, 'following', 1, 0)
         ON CONFLICT(username) DO UPDATE
           SET user_id = COALESCE(x_follows.user_id, excluded.user_id),
               display_name = COALESCE(x_follows.display_name, excluded.display_name)`,
      ),
      remove: db.prepare(`DELETE FROM x_follows WHERE username = ?`),
      list: db.prepare(
        `SELECT username, user_id, display_name, added_at, enabled, source, user_disabled
           FROM x_follows ORDER BY added_at DESC`,
      ),
      get: db.prepare(
        `SELECT username, user_id, display_name, added_at, enabled, source, user_disabled
           FROM x_follows WHERE username = ?`,
      ),
      updateUserId: db.prepare(`UPDATE x_follows SET user_id = ?, display_name = ? WHERE username = ?`),
      setEnabled: db.prepare(
        `UPDATE x_follows SET enabled = ?, user_disabled = ? WHERE username = ?`,
      ),
      // Bulk OFF — every following row goes muted; user_disabled stays as the
      // user left it so re-enabling bulk can honour individual unchecks.
      bulkDisableFollowing: db.prepare(
        `UPDATE x_follows SET enabled = 0 WHERE source = 'following'`,
      ),
      // Bulk ON — restore enabled only for rows the user did not explicitly mute.
      bulkEnableFollowing: db.prepare(
        `UPDATE x_follows SET enabled = 1 WHERE source = 'following' AND user_disabled = 0`,
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  /** Store and validate X session cookies. Returns authenticated user info. */
  async auth(authToken: string, ct0: string): Promise<{ screenName: string; name: string }> {
    const resp = await this.graphqlGet("UserByScreenName", { screen_name: "x" }, authToken, ct0);
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`X auth validation failed (HTTP ${resp.status}): ${body.slice(0, 200)}`);
    }
    await this.credentials.set(CRED_AUTH, authToken);
    await this.credentials.set(CRED_CT0, ct0);

    // Fetch authenticated user's identity
    try {
      const meResp = await fetch("https://x.com/i/api/1.1/account/multi/list.json", {
        signal: AbortSignal.timeout(10_000),
        headers: {
          authorization: `Bearer ${X_BEARER}`,
          "x-csrf-token": ct0,
          cookie: `auth_token=${authToken}; ct0=${ct0}`,
        },
      });
      if (meResp.ok) {
        const data = (await meResp.json()) as { users?: Array<{ screen_name?: string; name?: string }> };
        const me = data.users?.[0];
        if (me?.screen_name) {
          await this.credentials.set(CRED_USER, JSON.stringify({ screenName: me.screen_name, name: me.name ?? me.screen_name }));
          // Pre-warm the self user_id so the first Following fetch doesn't have to
          // do an extra UserByScreenName round-trip (and risk returning [] on a race).
          // Best-effort — if this fails, getSelfUserId() will retry lazily.
          try {
            const resolved = await this.resolveUser(me.screen_name);
            if (resolved?.userId) await this.credentials.set(CRED_SELF_USER_ID, resolved.userId);
          } catch { /* ignore — lazy path will retry */ }
          return { screenName: me.screen_name, name: me.name ?? me.screen_name };
        }
      }
    } catch { /* ignore — auth still succeeded */ }

    return { screenName: "", name: "" };
  }

  async hasAuth(): Promise<boolean> {
    return (await this.credentials.has(CRED_AUTH)) && (await this.credentials.has(CRED_CT0));
  }

  /** Clear stored X session cookies and cached identity. Followed accounts persist. */
  async unlinkAuth(): Promise<void> {
    await this.credentials.delete(CRED_AUTH);
    await this.credentials.delete(CRED_CT0);
    await this.credentials.delete(CRED_USER);
    await this.credentials.delete(CRED_SELF_USER_ID);
    this.followingCache = null;
  }

  /** Get authenticated user info (stored during auth). */
  async getAuthUser(): Promise<{ screenName: string; name: string } | null> {
    const raw = await this.credentials.get(CRED_USER);
    if (!raw) return null;
    try { return JSON.parse(raw) as { screenName: string; name: string }; } catch { return null; }
  }

  /**
   * Whether the daemon should also pull tweets from the user's X.com following list.
   *
   * Default is ON: an unset key (first connect) returns `true`. Explicit opt-out is
   * stored as "0"; explicit opt-in as "1". This means we always write a value,
   * never delete — so the toggle reflects the ON default on first render.
   */
  async getIncludeFollowing(): Promise<boolean> {
    const raw = await this.credentials.get(CRED_INCLUDE_FOLLOWING);
    if (raw === null) return true;
    return raw !== "0";
  }

  async setIncludeFollowing(enabled: boolean): Promise<void> {
    await this.credentials.set(CRED_INCLUDE_FOLLOWING, enabled ? "1" : "0");
    // Reflect the bulk toggle on every following row. Manual unchecks recorded
    // in user_disabled survive — they stay muted even after bulk re-enable.
    if (enabled) {
      this.stmts.bulkEnableFollowing.run();
    } else {
      this.stmts.bulkDisableFollowing.run();
    }
  }

  private async getAuth(): Promise<{ authToken: string; ct0: string } | null> {
    const authToken = await this.credentials.get(CRED_AUTH);
    const ct0 = await this.credentials.get(CRED_CT0);
    if (!authToken || !ct0) return null;
    return { authToken, ct0 };
  }

  /** Register callback to trigger immediate fetch when X.com is enabled. */
  onEnable(cb: () => void | Promise<void>): void { this.onEnableCallback = cb; }

  /** Current lifecycle state of the background fetch cycle. The daemon is the
   *  sole writer (via `setFetchState`); `getFetchState` is safe to call from
   *  any thread / gateway handler. */
  getFetchState(): XFetchState { return this.fetchState; }

  /** Invoked by the daemon around each fetch cycle. Kept on the service so
   *  state co-locates with `fetchAll` / `fetchFollowingAccountsTweets` and
   *  stays in sync even if the daemon changes its retry strategy. */
  setFetchState(state: XFetchState): void { this.fetchState = state; }

  /**
   * Trigger an immediate fetch cycle. Returns a promise that resolves when the
   * fetch completes (so callers with a deadline can `Promise.race` it); callers
   * that want fire-and-forget can simply not await.
   */
  triggerFetch(): Promise<void> {
    const res = this.onEnableCallback?.();
    return Promise.resolve(res);
  }

  // ---------------------------------------------------------------------------
  // Follow management
  // ---------------------------------------------------------------------------

  /** Follow an X account. Resolves user ID + display name via GraphQL — rejects if user not found. */
  async follow(username: string): Promise<{ added: boolean; notFound: boolean; displayName?: string }> {
    const clean = username.replace(/^@/, "").toLowerCase().trim();
    if (!clean) return { added: false, notFound: false };

    const user = await this.resolveUser(clean);
    if (!user) return { added: false, notFound: true };

    const result = this.stmts.add.run(clean, user.userId, user.displayName, "manual");
    return { added: result.changes > 0, notFound: false, displayName: user.displayName };
  }

  unfollow(username: string): boolean {
    const clean = username.replace(/^@/, "").toLowerCase().trim();
    const result = this.stmts.remove.run(clean);
    return result.changes > 0;
  }

  list(): XFollow[] {
    const rows = this.stmts.list.all() as Array<{
      username: string;
      user_id: string | null;
      display_name: string | null;
      added_at: number;
      enabled: number;
      source: string;
      user_disabled: number;
    }>;
    return rows.map((r) => ({
      username: r.username,
      userId: r.user_id,
      displayName: r.display_name,
      addedAt: r.added_at,
      enabled: r.enabled !== 0,
      source: r.source === "following" ? "following" : "manual",
    }));
  }

  /**
   * Flip a single account's enabled flag. Persists the user's intent via
   * `user_disabled` so that bulk re-toggle of the Following list does not
   * clobber a manual uncheck. Idempotent. Returns true when a row matched.
   */
  setEnabled(username: string, enabled: boolean): boolean {
    const clean = username.replace(/^@/, "").toLowerCase().trim();
    if (!clean) return false;
    const userDisabled = enabled ? 0 : 1;
    const result = this.stmts.setEnabled.run(enabled ? 1 : 0, userDisabled, clean);
    return result.changes > 0;
  }

  /**
   * Total accounts the authenticated user follows on X.com. Used by the web
   * "Manage follower" modal to render "Include accounts you follow on X.com
   * (N followed)". Returns null when the resolution cannot complete (no auth,
   * Following queryId missing, X returned a non-JSON body). The widget shows
   * "—" in that case and the bulk checkbox stays interactive.
   */
  async getFollowingCount(): Promise<number | null> {
    const auth = await this.getAuth();
    if (!auth) return null;
    try {
      const list = await this.resolveFollowingList(auth);
      return list.length;
    } catch {
      return null;
    }
  }

  /**
   * Search by partial `@handle` against both the tracked list and the
   * authenticated user's X.com Following list. Returns two parallel arrays so
   * the UI can render "Followed" vs "Not Follow" sub-sections without further
   * filtering. Matching is case-insensitive substring on the screen name; a
   * leading `@` in the query is stripped.
   *
   * If the Following list cannot be resolved (no auth, X rate-limit, parse
   * error), `notFollow` is returned empty and the failure is logged — the
   * tracked-list match is always attempted because it is purely local.
   */
  async search(query: string): Promise<{ followed: XFollow[]; notFollow: XSearchCandidate[] }> {
    const q = query.replace(/^@/, "").toLowerCase().trim();
    if (!q) return { followed: [], notFollow: [] };

    const all = this.list();
    const followed = all.filter((f) => f.username.toLowerCase().includes(q));

    const auth = await this.getAuth();
    if (!auth) return { followed, notFollow: [] };

    let followingList: FollowedUser[];
    try {
      followingList = await this.resolveFollowingList(auth);
    } catch (err) {
      this.log.warn({ err }, "x-follows search: following list resolve failed");
      return { followed, notFollow: [] };
    }
    const trackedNames = new Set(all.map((f) => f.username.toLowerCase()));
    const notFollow: XSearchCandidate[] = followingList
      .filter((u) => u.username.toLowerCase().includes(q) && !trackedNames.has(u.username.toLowerCase()))
      .map((u) => ({ username: u.username, userId: u.userId, displayName: u.displayName }));
    return { followed, notFollow };
  }

  // ---------------------------------------------------------------------------
  // Tweet fetching
  // ---------------------------------------------------------------------------

  /**
   * Fetch recent tweets (≤ 24h) from manual follows and/or the user's X home timeline.
   *
   * `sink` is invoked with each per-account batch as soon as it returns — the
   * daemon uses this to insert incrementally and emit `tweets.inserted` so the
   * widget can render the first tweets within ~1 s instead of waiting for the
   * ≥50 s cycle. The final return value is the full deduped list,
   * preserved for any caller that wants the end-of-cycle snapshot.
   */
  async fetchAll(sink?: XFollowBatchSink): Promise<RawTweet[]> {
    const auth = await this.getAuth();
    if (!auth) return []; // No auth configured — skip silently

    const includeFollowing = await this.getIncludeFollowing();
    const follows = this.list();
    if (follows.length === 0 && !includeFollowing) return [];

    const out: RawTweet[] = [];
    const seen = new Set<string>();
    // Wrap the caller's sink with dedup so a tweet that appears both in the
    // Following timeline AND under a manual follow is only persisted once.
    const emit = (batch: RawTweet[], source: "following" | "manual"): void => {
      if (batch.length === 0) return;
      const fresh: RawTweet[] = [];
      for (const t of batch) {
        const key = `${t.username}:${t.tweetId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push(t);
      }
      if (fresh.length === 0) return;
      out.push(...fresh);
      if (sink) {
        try { sink(fresh, source); }
        catch (err) { this.log.warn({ err }, "tweet sink threw"); }
      }
    };

    // 1. Pull tweets from every account the user follows on X.com.
    let rateLimited: XRateLimitError | null = null;
    if (includeFollowing) {
      try {
        await this.fetchFollowingAccountsTweets(auth, (batch) => emit(batch, "following"));
      } catch (err) {
        if (err instanceof XRateLimitError) {
          rateLimited = err;
        } else {
          this.log.warn({ err }, "following-accounts fetch failed");
        }
      }
    }

    // If we got rate-limited in (1), skip (2) entirely — manual follows use
    // the same X UserTweets quota, so every call would 429 too. Propagate
    // the error up so the daemon can schedule the next cycle via
    // Retry-After instead of firing a half-broken cycle.
    if (rateLimited) throw rateLimited;

    // 2. Manually-added follows — per-user UserTweets call.
    // Re-read the list so any rows the Following sync just upserted are
    // present; then drop disabled rows (`enabled = 0`) — the user muted them
    // explicitly via the modal and we must not waste a UserTweets call.
    const refreshed = this.list().filter((f) => f.enabled && f.source === "manual");
    // Resolve missing user IDs / display names first. Opportunistically capture
    // the avatar URL from the same response so we can pass it into fetchUserTweets
    // below (UserTweets strips author, so we have to supply avatar as a fallback).
    const avatarByUsername = new Map<string, string | null>();
    for (const f of refreshed) {
      if (f.userId && f.displayName) continue;
      try {
        const user = await this.resolveUser(f.username);
        if (user) {
          this.stmts.updateUserId.run(user.userId, user.displayName, f.username);
          f.userId = user.userId;
          f.displayName = user.displayName;
          avatarByUsername.set(f.username, user.avatarUrl);
        }
      } catch {
        this.log.warn({ username: f.username }, "resolve failed");
      }
    }

    for (let i = 0; i < refreshed.length; i++) {
      const f = refreshed[i];
      if (!f.userId) continue;
      let avatarUrl = avatarByUsername.get(f.username) ?? null;
      if (!avatarByUsername.has(f.username)) {
        try {
          const resolved = await this.resolveUser(f.username);
          avatarUrl = resolved?.avatarUrl ?? null;
          avatarByUsername.set(f.username, avatarUrl);
        } catch { /* ignore — fall back to null */ }
      }
      try {
        const batch = await this.fetchUserTweets(
          f.userId,
          f.username,
          f.displayName ?? f.username,
          auth,
          avatarUrl,
        );
        emit(batch, "manual");
      } catch (err) {
        // Same break-and-propagate rule as the Following loop: hitting 429
        // on any manual follow means the whole quota is exhausted.
        if (err instanceof XRateLimitError) {
          this.log.warn(
            { username: f.username, processed: i, retryAfterMs: err.retryAfterMs },
            "rate limited by X — pausing cycle",
          );
          throw err;
        }
        this.log.warn({ username: f.username, err }, "fetch failed");
      }
      if (i < refreshed.length - 1) await sleep(FOLLOWING_REQ_DELAY_MS);
    }

    return out;
  }

  // ---------------------------------------------------------------------------
  // Private — GraphQL
  // ---------------------------------------------------------------------------

  private async resolveUser(username: string): Promise<{ userId: string; displayName: string; avatarUrl: string | null } | null> {
    const auth = await this.getAuth();
    if (!auth) return null;

    const resp = await this.graphqlGet("UserByScreenName", { screen_name: username }, auth.authToken, auth.ct0);
    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      data?: { user?: { result?: {
        rest_id?: string;
        core?: { name?: string };
        legacy?: { name?: string; profile_image_url_https?: string };
        avatar?: { image_url?: string };
      } } };
    };
    const result = data.data?.user?.result;
    if (!result?.rest_id) return null;
    const displayName = result.core?.name ?? result.legacy?.name ?? username;
    const avatarUrl = biggerAvatar(result.legacy?.profile_image_url_https ?? result.avatar?.image_url);
    return { userId: result.rest_id, displayName, avatarUrl };
  }

  private async fetchUserTweets(
    userId: string,
    username: string,
    displayName: string,
    auth: { authToken: string; ct0: string },
    fallbackAvatarUrl: string | null = null,
  ): Promise<RawTweet[]> {
    const variables = {
      userId,
      count: 20,
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
      withV2Timeline: true,
    };

    const resp = await this.graphqlGet("UserTweets", variables, auth.authToken, auth.ct0);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      if (resp.status === 429) {
        const retryAfterMs = parseRetryAfter(resp.headers.get("retry-after"));
        throw new XRateLimitError(
          `HTTP 429: Rate limit exceeded (retry after ${Math.round(retryAfterMs / 1000)}s)`,
          retryAfterMs,
        );
      }
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 100)}`);
    }

    const body = (await resp.json()) as Record<string, unknown>;
    return this.parseTweetsResponse(body, username, displayName, fallbackAvatarUrl);
  }

  private parseTweetsResponse(
    body: Record<string, unknown>,
    username: string,
    displayName: string,
    fallbackAvatarUrl: string | null = null,
  ): RawTweet[] {
    const cutoff = Math.floor(Date.now() / 1000) - FETCH_WINDOW_S;
    const tweets: RawTweet[] = [];

    // Navigate: data.user.result.timeline_v2.timeline (old) or data.user.result.timeline.timeline (new)
    const userResult = ((body.data as Record<string, unknown>)
      ?.user as Record<string, unknown>)
      ?.result as Record<string, unknown> | undefined;
    const tl = (userResult?.timeline_v2 ?? userResult?.timeline) as Record<string, unknown> | undefined;
    const insts = ((tl?.timeline as Record<string, unknown>)?.instructions as Array<Record<string, unknown>>) ?? [];

    for (const inst of insts) {
      const entries = (inst.entries as Array<Record<string, unknown>>) ?? [];
      if (inst.entry) entries.push(inst.entry as Record<string, unknown>);

      for (const entry of entries) {
        const content = entry.content as Record<string, unknown> | undefined;
        const item = content?.itemContent as Record<string, unknown> | undefined;
        const result = (item?.tweet_results as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
        const rt = this.parseTweetResult(result, cutoff, username, displayName, fallbackAvatarUrl);
        if (rt) tweets.push(rt);
      }
    }

    return tweets;
  }

  /**
   * Fetch tweets from every account the authenticated user follows on X.com.
   *
   * X removed the public HomeLatestTimeline query from the web bundle, so we
   * resolve the Following list once per TTL and then iterate `UserTweets` for
   * each followed user (capped per cycle to stay under rate limits).
   */
  async fetchFollowingAccountsTweets(
    auth: { authToken: string; ct0: string },
    onBatch?: (batch: RawTweet[]) => void,
  ): Promise<RawTweet[]> {
    const list = await this.resolveFollowingList(auth);
    if (list.length === 0) return [];

    // Upsert every Following row into x_follows so the modal can render it +
    // toggle it. Pre-existing rows (manual or already-following) preserve
    // their user_disabled flag — the addFollowing statement is a no-op on
    // conflict beyond patching missing user_id / display_name.
    for (const u of list) {
      try {
        this.stmts.addFollowing.run(u.username.toLowerCase(), u.userId, u.displayName);
      } catch (err) {
        // Non-fatal: a single CHECK violation should not abort the fetch cycle.
        this.log.warn({ err, username: u.username }, "addFollowing upsert failed");
      }
    }

    // Build the muted-set once so the per-account loop can skip explicit
    // unchecks recorded on `source = 'following'` rows.
    const muted = new Set(
      this.list()
        .filter((f) => !f.enabled)
        .map((f) => f.username.toLowerCase()),
    );

    const out: RawTweet[] = [];
    const targets = list
      .filter((u) => !muted.has(u.username.toLowerCase()))
      .slice(0, FOLLOWING_CAP_PER_CYCLE);
    for (let i = 0; i < targets.length; i++) {
      const u = targets[i];
      try {
        const batch = await this.fetchUserTweets(u.userId, u.username, u.displayName, auth, u.avatarUrl);
        if (batch.length > 0) {
          out.push(...batch);
          // Emit per-account so the widget shows tweets as they arrive instead
          // of waiting for all 50 calls to complete (≥50 s at 1 req/s throttle).
          if (onBatch) {
            try { onBatch(batch); }
            catch (err) { this.log.warn({ err, username: u.username }, "following onBatch threw"); }
          }
        }
      } catch (err) {
        // 429 rate limit — break cycle AND propagate so fetchAll skips
        // the manual-follows loop too (otherwise it would immediately hit
        // 429 again on each manual follow account).
        if (err instanceof XRateLimitError) {
          this.log.warn(
            { username: u.username, processed: i, retryAfterMs: err.retryAfterMs },
            "rate limited by X — pausing cycle",
          );
          throw err;
        }
        this.log.warn({ username: u.username, err }, "following fetch failed");
      }
      if (i < targets.length - 1) await sleep(FOLLOWING_REQ_DELAY_MS);
    }
    return out;
  }

  /** Resolve the list of accounts the authenticated user follows, with a TTL cache. */
  private async resolveFollowingList(auth: { authToken: string; ct0: string }): Promise<FollowedUser[]> {
    if (
      this.followingCache &&
      Date.now() - this.followingCache.fetchedAt < FOLLOWING_CACHE_TTL_MS
    ) {
      return this.followingCache.list;
    }

    const selfId = await this.getSelfUserId(auth);
    if (!selfId) return [];

    const qid = await this.queryIds.getQueryId("Following");
    if (!qid) {
      this.log.warn("Following queryId not found in X's bundle");
      return [];
    }

    const variables = { userId: selfId, count: 200, includePromotedContent: false };
    const resp = await this.graphqlGet("Following", variables, auth.authToken, auth.ct0);
    const text = await resp.text();
    if (!resp.ok) {
      this.log.warn({ status: resp.status, preview: text.slice(0, 200) }, "Following HTTP error");
      return [];
    }
    if (!text.trim() || !text.trim().startsWith("{")) {
      this.log.warn({ preview: text.slice(0, 200) }, "Following: empty/non-JSON body");
      return [];
    }

    let body: Record<string, unknown>;
    try { body = JSON.parse(text) as Record<string, unknown>; }
    catch {
      this.log.warn({ preview: text.slice(0, 200) }, "Following: JSON parse failed");
      return [];
    }

    const list = this.parseFollowingList(body);
    this.followingCache = { list, fetchedAt: Date.now() };
    this.log.info({ count: list.length }, "resolved X following list");
    return list;
  }

  private parseFollowingList(body: Record<string, unknown>): FollowedUser[] {
    const userResult = ((body.data as Record<string, unknown>)
      ?.user as Record<string, unknown>)
      ?.result as Record<string, unknown> | undefined;
    const tl = (userResult?.timeline as Record<string, unknown>) ?? (userResult?.timeline_v2 as Record<string, unknown>);
    const insts = ((tl?.timeline as Record<string, unknown>)?.instructions as Array<Record<string, unknown>>) ?? [];

    const out: FollowedUser[] = [];
    for (const inst of insts) {
      const entries = (inst.entries as Array<Record<string, unknown>>) ?? [];
      for (const entry of entries) {
        const content = entry.content as Record<string, unknown> | undefined;
        const item = content?.itemContent as Record<string, unknown> | undefined;
        if (item?.__typename !== "TimelineUser") continue;
        const userRes = (item.user_results as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
        if (!userRes?.rest_id) continue;
        const legacy = userRes.legacy as Record<string, unknown> | undefined;
        const core = (userRes.core as Record<string, unknown>) ?? undefined;
        const avatar = userRes.avatar as Record<string, unknown> | undefined;
        const username = (core?.screen_name as string) ?? (legacy?.screen_name as string);
        const displayName = (core?.name as string) ?? (legacy?.name as string) ?? username;
        if (!username) continue;
        const avatarUrl = biggerAvatar(
          (legacy?.profile_image_url_https as string | undefined) ?? (avatar?.image_url as string | undefined),
        );
        out.push({ userId: userRes.rest_id as string, username, displayName, avatarUrl });
      }
    }
    return out;
  }

  private async getSelfUserId(auth: { authToken: string; ct0: string }): Promise<string | null> {
    const cached = await this.credentials.get(CRED_SELF_USER_ID);
    if (cached) return cached;

    const user = await this.getAuthUser();
    if (!user?.screenName) return null;
    const resolved = await this.resolveUser(user.screenName);
    if (!resolved) return null;
    await this.credentials.set(CRED_SELF_USER_ID, resolved.userId);
    return resolved.userId;
  }

  /**
   * Extract a RawTweet from a raw tweet `result` node. If `fallbackUsername`
   * is provided, it's used when the result doesn't carry its own author
   * info (the UserTweets endpoint omits author because we queried by userId).
   */
  private parseTweetResult(
    input: Record<string, unknown> | undefined,
    cutoff: number,
    fallbackUsername?: string,
    fallbackDisplayName?: string,
    fallbackAvatarUrl: string | null = null,
  ): RawTweet | null {
    let result = input;
    if (result?.__typename === "TweetWithVisibilityResults") {
      result = result.tweet as Record<string, unknown>;
    }
    if (!result) return null;

    const legacy = result.legacy as Record<string, unknown> | undefined;
    if (!legacy) return null;

    // Author — prefer the result's own core.user_results; fall back to caller defaults.
    const authorResult = ((result.core as Record<string, unknown>)
      ?.user_results as Record<string, unknown>)
      ?.result as Record<string, unknown> | undefined;
    const authorLegacy = authorResult?.legacy as Record<string, unknown> | undefined;
    const authorAvatar = authorResult?.avatar as Record<string, unknown> | undefined;
    const username = (authorLegacy?.screen_name as string) ?? fallbackUsername;
    const displayName = (authorLegacy?.name as string) ?? fallbackDisplayName ?? username ?? "";
    if (!username) return null;

    const avatarUrl = biggerAvatar(
      (authorLegacy?.profile_image_url_https as string | undefined)
        ?? (authorAvatar?.image_url as string | undefined),
    ) ?? fallbackAvatarUrl;

    const noteText = ((result.note_tweet as Record<string, unknown>)
      ?.note_tweet_results as Record<string, unknown>)
      ?.result as Record<string, unknown> | undefined;
    const text = (noteText?.text as string) ?? (legacy.full_text as string) ?? "";
    const createdAt = legacy.created_at as string | undefined;
    const tweetId = (legacy.id_str as string) ?? "";
    if (!text || !tweetId) return null;

    const publishedAt = createdAt ? Math.floor(new Date(createdAt).getTime() / 1000) : 0;
    if (publishedAt < cutoff) return null;

    const extEntities = (legacy.extended_entities as Record<string, unknown>) ?? legacy.entities as Record<string, unknown> ?? {};
    const media = (extEntities.media as Array<Record<string, unknown>>) ?? [];
    const mediaUrls = new Set(media.map((m) => m.url as string).filter(Boolean));
    const imageUrl = (media[0]?.media_url_https as string) ?? undefined;

    let cleanText = text;
    for (const mUrl of mediaUrls) cleanText = cleanText.replace(mUrl, "");
    cleanText = cleanText.trimEnd();

    let fullText = cleanText;
    let quoted = (result.quoted_status_result as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
    if (quoted?.__typename === "TweetWithVisibilityResults") quoted = quoted.tweet as Record<string, unknown>;
    if (quoted) {
      const qLegacy = quoted.legacy as Record<string, unknown> | undefined;
      const qCore = (quoted.core as Record<string, unknown>)?.user_results as Record<string, unknown>;
      const qUser = (qCore?.result as Record<string, unknown>)?.legacy as Record<string, unknown> | undefined;
      const qText = (qLegacy?.full_text as string) ?? "";
      const qName = (qUser?.screen_name as string) ?? "";
      if (qText) fullText += `\n▸ @${qName}: ${qText}`;
    }

    const views = (result.views as Record<string, unknown>)?.count;
    const stats = {
      views: views != null ? Number(views) : 0,
      replies: (legacy.reply_count as number) ?? 0,
      retweets: (legacy.retweet_count as number) ?? 0,
      likes: (legacy.favorite_count as number) ?? 0,
      bookmarks: (legacy.bookmark_count as number) ?? 0,
    };

    return {
      username,
      displayName,
      tweetId,
      url: `https://x.com/${username}/status/${tweetId}`,
      content: fullText.slice(0, 800),
      imageUrl,
      avatarUrl: avatarUrl ?? null,
      coins: tagCoins(fullText),
      publishedAt,
      stats,
    };
  }

  private async graphqlGet(
    operation: string,
    variables: Record<string, unknown>,
    authToken: string,
    ct0: string,
  ): Promise<Response> {
    const doFetch = async () => {
      const qid = await this.queryIds.getQueryId(operation);
      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(X_FEATURES),
      });
      return fetch(`https://x.com/i/api/graphql/${qid}/${operation}?${params}`, {
        signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: `Bearer ${X_BEARER}`,
          "x-csrf-token": ct0,
          cookie: `auth_token=${authToken}; ct0=${ct0}`,
        },
      });
    };

    const resp = await doFetch();
    // Retry once with fresh query IDs if stale
    if (resp.ok) {
      const text = await resp.clone().text();
      if (text.includes('"Query not found"')) {
        this.log.warn({ operation }, "query id stale, refreshing");
        this.queryIds.invalidate();
        return doFetch();
      }
    }
    return resp;
  }
}
