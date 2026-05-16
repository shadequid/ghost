/**
 * Version-check service. Polls the registry's npm metadata endpoint for
 * `@hyperflow/ghost`, parses `dist-tags.<tag>`, and caches the
 * result in memory with a TTL. All failures (network, non-200,
 * malformed body) return `null` — the caller treats "cannot check" the
 * same as "no update".
 *
 * Contract is intentionally tiny: `getLatest(force?, tag?)` is all
 * callers need. Instantiated once in `runtime.ts` and shared.
 *
 * Caching shape: per-tag in-memory cache + per-tag inflight
 * coalescing. Only the `latest` tag is persisted to the on-disk update
 * cache (the file the CLI reads for its update hint); other tags stay
 * in memory only.
 */

import type { Logger } from "pino";
import { PACKAGE_NAME, getRegistryUrl } from "./registry.js";
import { writeUpdateCache, type UpdateCache } from "./version-cache.js";

export interface VersionCheck {
  /**
   * Resolve a dist-tag to its published version. Every tag is cached
   * with the same TTL + null-retry semantics, and concurrent calls for
   * the same tag are coalesced to a single fetch.
   */
  getLatest(force?: boolean, tag?: string): Promise<string | null>;
}

export interface VersionCheckOptions {
  logger: Logger;
  /** Cache TTL in ms. Defaults to 1h, or `GHOST_UPDATE_CHECK_TTL_MS` env. */
  ttlMs?: number;
  /** Fetch timeout in ms. Defaults to 5s. */
  timeoutMs?: number;
  /**
   * Cooldown in ms after a failed fetch before the cached `null` can be
   * re-fetched. Defaults to 60s, or `GHOST_UPDATE_CHECK_NULL_RETRY_MS` env.
   */
  nullRetryMs?: number;
  /** Override the registry URL. Defaults to `getRegistryUrl()`. */
  registryUrl?: string;
  /**
   * Injected for tests. Defaults to `writeUpdateCache` which persists
   * the result to `~/.ghost/update-cache.json` so the CLI can read it
   * without re-fetching. Only invoked for the `latest` tag.
   */
  persistCache?: (cache: UpdateCache) => void;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
/**
 * On fetch failure (network down, 4xx, 5xx, malformed body) we cache
 * `null` for only this short window instead of the full TTL, so
 * offline-boot users recover quickly once the network returns.
 */
const DEFAULT_NULL_RETRY_MS = 60 * 1000;

export interface FetchLatestVersionOptions {
  /** Fetch timeout in ms. Required. */
  timeoutMs: number;
  /** Dist-tag to read. Defaults to `"latest"`. */
  tag?: string;
  /** Registry base URL. Defaults to `getRegistryUrl()`. */
  registryUrl?: string;
  /** Required. Pass `pino({ level: "silent" })` to suppress warnings. */
  logger: Logger;
}

/**
 * One-shot network probe: fetch `<registry>/<package>`, parse
 * `dist-tags.<tag>`, return the version string or `null` on any failure
 * (network, non-200, malformed body, missing tag). Never throws.
 */
export async function fetchLatestVersion(
  opts: FetchLatestVersionOptions,
): Promise<string | null> {
  const registryUrl = opts.registryUrl ?? getRegistryUrl();
  const tag = opts.tag ?? "latest";
  const endpoint = `${registryUrl}${encodeURIComponent(PACKAGE_NAME)}`;
  try {
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      opts.logger.warn({ status: res.status, endpoint, tag }, "version-check: non-200 response");
      return null;
    }
    const body = (await res.json()) as unknown;
    const version = extractDistTag(body, tag);
    if (!version) {
      opts.logger.warn({ endpoint, tag }, "version-check: missing dist-tag in response body");
      return null;
    }
    return version;
  } catch (err) {
    opts.logger.warn({ err, tag }, "version-check: fetch failed");
    return null;
  }
}

interface CacheEntry {
  value: string | null;
  at: number;
  /** Effective freshness window for this entry (ttl on success, null-retry on failure). */
  freshMs: number;
}

export class VersionCheckService implements VersionCheck {
  private readonly logger: Logger;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;
  private readonly nullRetryMs: number;
  private readonly registryUrl: string;
  private readonly persistCache: (cache: UpdateCache) => void;

  private readonly cache = new Map<string, CacheEntry>();
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(options: VersionCheckOptions) {
    this.logger = options.logger;
    this.ttlMs = options.ttlMs ?? parsePositiveEnv("GHOST_UPDATE_CHECK_TTL_MS") ?? DEFAULT_TTL_MS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.nullRetryMs =
      options.nullRetryMs ?? parsePositiveEnv("GHOST_UPDATE_CHECK_NULL_RETRY_MS") ?? DEFAULT_NULL_RETRY_MS;
    this.registryUrl = options.registryUrl ?? getRegistryUrl();
    const boundLogger = this.logger;
    this.persistCache =
      options.persistCache ?? ((cache) => writeUpdateCache(cache, undefined, boundLogger));
  }

  async getLatest(force = false, tag = "latest"): Promise<string | null> {
    // Null results use a short cooldown; success uses the full TTL.
    // The applicable window is tracked per-entry in `freshMs`.
    const entry = this.cache.get(tag);
    const fresh = entry !== undefined && Date.now() - entry.at < entry.freshMs;
    if (!force && fresh) return entry.value;

    // Coalesce concurrent calls for the same tag to a single in-flight request.
    const existing = this.inflight.get(tag);
    if (existing) return existing;

    const p = this.fetchTag(tag)
      .then((v) => this.remember(tag, v))
      .finally(() => {
        this.inflight.delete(tag);
      });
    this.inflight.set(tag, p);
    return p;
  }

  /** Fetch a specific dist-tag without touching the cache. */
  private fetchTag(tag: string): Promise<string | null> {
    return fetchLatestVersion({
      timeoutMs: this.timeoutMs,
      tag,
      registryUrl: this.registryUrl,
      logger: this.logger,
    });
  }

  private remember(tag: string, value: string | null): string | null {
    // On failure, use a short retry cooldown instead of the full TTL so
    // offline startups recover quickly once the network returns.
    const freshMs = value === null ? Math.min(this.nullRetryMs, this.ttlMs) : this.ttlMs;
    const at = Date.now();
    this.cache.set(tag, { value, at, freshMs });
    // Only `latest` is persisted to the on-disk cache — that file drives
    // the CLI's update hint and is a global, user-facing signal. Other
    // tags (rc, test) are opt-in channels, so we keep them in memory
    // only to avoid confusing the CLI hint with a pre-release version.
    if (tag === "latest") {
      try {
        this.persistCache({ latestVersion: value, checkedAt: at });
      } catch (err) {
        this.logger.warn({ err }, "version-check: persisting cache failed");
      }
    }
    return value;
  }
}

function parsePositiveEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

function extractDistTag(body: unknown, tag: string): string | null {
  if (!body || typeof body !== "object") return null;
  const withDist = body as { "dist-tags"?: unknown };
  const tags = withDist["dist-tags"];
  if (!tags || typeof tags !== "object") return null;
  const version = (tags as Record<string, unknown>)[tag];
  return typeof version === "string" && version.length > 0 ? version : null;
}
