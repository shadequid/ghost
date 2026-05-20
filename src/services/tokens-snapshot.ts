/**
 * TokensSnapshotService — builds the token list + price snapshot for the
 * `trading.tokens.list` RPC entirely from in-memory state.
 *
 * No network calls. Data sources:
 *   - Symbol universe: `HyperliquidClient.getAllAssetNames()` — populated by
 *     ensureMeta() at daemon start, refreshed when a new HIP-3 dex appears.
 *   - Prices + prevDayPrices: `PriceCache.get()` — populated by the composite
 *     price feed (HL `allDexsAssetCtxs` WS, Binance WS, REST fallbacks).
 *   - maxLeverage: `HyperliquidClient.getMaxLeverage()` — also from ensureMeta().
 *
 * When the composite feed is live, `build()` returns a fresh snapshot on
 * every call (sub-millisecond, no I/O). On cold start before the first
 * composite tick, prices will be empty — the UI's existing prev-prices
 * fallback prevents a visible flash.
 */

import type { PriceCache } from "./price-cache.js";
import type { TokenInfo } from "./interfaces/trading-types.js";

/** Minimal trading client surface needed by TokensSnapshotService. */
export interface TokensSnapshotClientDeps {
  getAllAssets(): ReadonlyArray<TokenInfo>;
  getMaxLeverage(symbol: string): number | undefined;
}

export interface TokensSnapshot {
  tokens: TokenInfo[];
  prices: Record<string, number>;
  prevDayPrices: Record<string, number>;
  maxLeverages: Record<string, number>;
}

export class TokensSnapshotService {
  constructor(
    private readonly client: TokensSnapshotClientDeps,
    private readonly priceCache: PriceCache,
  ) {}

  /** Build a snapshot from in-memory caches. Zero network calls. */
  build(): TokensSnapshot {
    const assets = this.client.getAllAssets();
    const prices: Record<string, number> = {};
    const prevDayPrices: Record<string, number> = {};
    const maxLeverages: Record<string, number> = {};
    const tokens: TokenInfo[] = [];

    for (const { symbol, isDelisted } of assets) {
      const entry = this.priceCache.get(symbol, 30_000);
      if (entry) {
        prices[symbol] = entry.price;
        if (entry.prevDayPrice !== undefined) prevDayPrices[symbol] = entry.prevDayPrice;
      }
      const lev = this.client.getMaxLeverage(symbol);
      if (typeof lev === "number" && lev > 0) maxLeverages[symbol] = lev;
      tokens.push(isDelisted ? { symbol, isDelisted: true } : { symbol });
    }

    tokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return { tokens, prices, prevDayPrices, maxLeverages };
  }
}
