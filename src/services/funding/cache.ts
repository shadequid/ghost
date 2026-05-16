import type { FundingRate } from "./types.js";

const DEFAULT_TTL_MS = 60 * 1000;

interface Entry {
  rate: FundingRate;
  expiresAt: number;
}

/**
 * Tiny TTL cache for funding rates. Shared across providers so callers
 * within a single agent turn don't refetch the same (exchange, symbol).
 *
 * TTL is configurable via constructor (default 60s) so tests can inject a
 * shorter value without waiting for real-time expiry. (scout: funding cache TTL)
 */
export class FundingRateCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly clock: () => number = Date.now,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  /** key = `${providerKey}:${cexSymbol}`. Returns null if absent or expired. */
  get(key: string): FundingRate | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.expiresAt < this.clock()) {
      this.entries.delete(key);
      return null;
    }
    return e.rate;
  }

  set(key: string, rate: FundingRate): void {
    this.entries.set(key, { rate, expiresAt: this.clock() + this.ttlMs });
  }
}
