import type { Logger } from "pino";
import { toCexSymbol } from "./symbol-mapping.js";
import type { FundingProvider, FundingRate } from "./types.js";
import type { FundingRateCache } from "./cache.js";

const BASE_URL = "https://fapi.binance.com";
const TIMEOUT_MS = 3000;

interface PremiumIndexResponse {
  lastFundingRate: string;     // e.g. "0.00010000"
  nextFundingTime: number;     // ms timestamp
}

export class BinanceFundingProvider implements FundingProvider {
  readonly name = "Binance";
  readonly key = "binance" as const;

  constructor(
    private readonly cache: FundingRateCache,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async fetchFundingRate(hlSymbol: string): Promise<FundingRate | null> {
    const symbol = toCexSymbol(hlSymbol, this.key);
    if (!symbol) return null;

    const cacheKey = `${this.key}:${symbol}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    try {
      const resp = await this.fetchFn(
        `${BASE_URL}/fapi/v1/premiumIndex?symbol=${symbol}`,
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      // Non-200 paths: 400 returns before consuming body (socket closed by server);
      // other non-ok statuses throw before body read — Bun GC collects the socket.
      // OK path always reaches `await resp.json()` which drains the body.
      if (resp.status === 400) return null;       // Symbol not listed
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as PremiumIndexResponse;
      const parsedRate = parseFloat(data.lastFundingRate);
      if (!Number.isFinite(parsedRate)) return null;
      const rate: FundingRate = {
        rate: parsedRate,
        fetchedAt: Date.now(),
        nextFundingAt: Number.isFinite(data.nextFundingTime) ? data.nextFundingTime : undefined,
      };
      this.cache.set(cacheKey, rate);
      return rate;
    } catch (err) {
      this.logger.debug({ err, hlSymbol, symbol }, "binance funding fetch failed");
      return null;
    }
  }
}
