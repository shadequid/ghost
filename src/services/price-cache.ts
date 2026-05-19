/**
 * PriceCache — single point of truth for the latest price tick per symbol.
 *
 * The gateway writes from CompositePriceFeed's onPrice callback (mark
 * price from HL `assetCtxs` / Binance USDⓈ-M `!markPrice@arr@1s`).
 * Agent tools read with a staleness check; older entries are treated as
 * cache miss so callers fall back to REST `metaAndAssetCtxs.markPx`.
 */

export interface PriceCacheEntry {
  price: number;
  /** Wall-clock when the tick landed in the cache. */
  timestamp: number;
  /** Previous-day close price for 24 h change calculation. Present only when
   *  the source that emitted this tick carries prevDayPx (HL does; Binance WS
   *  mark-price stream does not). */
  prevDayPrice?: number;
}

export class PriceCache {
  private readonly prices = new Map<string, PriceCacheEntry>();

  /** Record the latest tick for a symbol. */
  set(symbol: string, price: number, prevDayPrice?: number): void {
    this.prices.set(symbol, { price, timestamp: Date.now(), prevDayPrice });
  }

  /**
   * Latest cached price for a symbol, or undefined if missing or older
   * than `maxAgeMs`. Returning the entry shape (vs raw number) lets
   * callers report freshness in their own UX.
   */
  get(symbol: string, maxAgeMs = 30_000): PriceCacheEntry | undefined {
    const entry = this.prices.get(symbol);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > maxAgeMs) return undefined;
    return entry;
  }

  /** Snapshot of every cached symbol → price (no staleness filter). */
  snapshot(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [symbol, entry] of this.prices) out.set(symbol, entry.price);
    return out;
  }

  /** Drop all cached entries — used by gateway lifecycle teardown. */
  clear(): void {
    this.prices.clear();
  }
}
