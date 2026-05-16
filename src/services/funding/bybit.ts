import type { Logger } from "pino";
import { toCexSymbol } from "./symbol-mapping.js";
import type { FundingProvider, FundingRate } from "./types.js";
import type { FundingRateCache } from "./cache.js";

const BASE_URL = "https://api.bybit.com";
const TIMEOUT_MS = 3000;
// Bybit's standard perpetual funding interval is 8 hours.
const BYBIT_FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;

interface BybitFundingHistoryResponse {
  retCode: number;
  result: {
    list: Array<{
      fundingRate: string;         // e.g. "0.0001"
      fundingRateTimestamp: string; // ms timestamp as string (last event, not next)
    }>;
  };
}

export class BybitFundingProvider implements FundingProvider {
  readonly name = "Bybit";
  readonly key = "bybit" as const;

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
      const url = `${BASE_URL}/v5/market/funding/history?category=linear&symbol=${symbol}&limit=1`;
      const resp = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as BybitFundingHistoryResponse;
      // retCode !== 0 means error (symbol not found, invalid params, etc.)
      if (data.retCode !== 0) return null;
      const list = data.result?.list;
      if (!list || list.length === 0) return null;

      const item = list[0];
      const lastEventMs = parseInt(item.fundingRateTimestamp, 10);
      // nextFundingAt derived from last event + standard 8h interval when available
      const nextFundingAt = Number.isFinite(lastEventMs)
        ? lastEventMs + BYBIT_FUNDING_INTERVAL_MS
        : undefined;

      const parsedRate = parseFloat(item.fundingRate);
      if (!Number.isFinite(parsedRate)) return null;
      const rate: FundingRate = {
        rate: parsedRate,
        fetchedAt: Date.now(),
        nextFundingAt,
      };
      this.cache.set(cacheKey, rate);
      return rate;
    } catch (err) {
      this.logger.debug({ err, hlSymbol, symbol }, "bybit funding fetch failed");
      return null;
    }
  }
}
