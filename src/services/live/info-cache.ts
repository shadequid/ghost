/**
 * Utilities for the Hyperliquid info() layer:
 * - Short-TTL promise cache, opt-in per call (caller decides what to cache).
 * - Bounded concurrency runner (replaces unbounded Promise.allSettled fan-out).
 */

/** Cache entry: the in-flight or resolved promise plus when it was inserted. */
interface CacheEntry {
  promise: Promise<unknown>;
  insertedAt: number;
}

/**
 * InfoCache — short-TTL promise cache keyed by a caller-provided string.
 *
 * Domain-agnostic: the cache has no knowledge of which info types are safe to
 * coalesce. Callers opt in per call via `get(key, fetcher)` and stay out by
 * calling the fetcher directly. This keeps account-state reads (clearinghouseState,
 * userFills, …) fresh by default and avoids the leak where adding a new cacheable
 * type means editing two places.
 *
 * Caches the promise itself, not the resolved value, so concurrent callers
 * within the TTL window share a single in-flight request. On rejection the
 * entry is evicted immediately so the next caller retries from scratch.
 */
export class InfoCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly ttlMs: number;

  constructor(ttlMs = 3000) {
    this.ttlMs = ttlMs;
  }

  /**
   * Return a cached promise for `key` when within TTL, otherwise call
   * `fetcher`, cache its promise, and return it.
   */
  get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing !== undefined && now - existing.insertedAt < this.ttlMs) {
      return existing.promise as Promise<T>;
    }

    const promise = fetcher().catch((err: unknown) => {
      // Evict failed entries so the next caller retries.
      if (this.entries.get(key)?.promise === promise) {
        this.entries.delete(key);
      }
      throw err;
    });

    this.entries.set(key, { promise, insertedAt: now });
    return promise;
  }

  /** Remove all entries (useful in tests). */
  clear(): void {
    this.entries.clear();
  }
}

/**
 * Run `tasks` with at most `concurrency` running at the same time.
 * Returns a `PromiseSettledResult<T>[]` array in the same order as `tasks`,
 * matching the semantics of `Promise.allSettled`.
 */
export async function runWithConcurrency<T, U>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<PromiseSettledResult<U>[]> {
  const results: PromiseSettledResult<U>[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
