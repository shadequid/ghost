import type { Logger } from "pino";
import { toCexSymbol } from "./symbol-mapping.js";
import type { FundingProvider, FundingRate } from "./types.js";
import type { FundingRateCache } from "./cache.js";

const BASE_URL = "https://www.okx.com";
const TIMEOUT_MS = 3000;

interface OkxFundingRateResponse {
  code: string;   // "0" on success
  data: Array<{
    fundingRate: string;     // e.g. "0.00010000"
    nextFundingTime: string; // ms timestamp as string
  }>;
}

export class OkxFundingProvider implements FundingProvider {
  readonly name = "OKX";
  readonly key = "okx" as const;

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
      const url = `${BASE_URL}/api/v5/public/funding-rate?instId=${symbol}`;
      const resp = await this.fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as OkxFundingRateResponse;
      // code !== "0" means error (instrument not found, etc.)
      if (data.code !== "0") return null;
      if (!data.data || data.data.length === 0) return null;

      const item = data.data[0];
      const nextFundingAt = parseInt(item.nextFundingTime, 10);

      const parsedRate = parseFloat(item.fundingRate);
      if (!Number.isFinite(parsedRate)) return null;
      const rate: FundingRate = {
        rate: parsedRate,
        fetchedAt: Date.now(),
        nextFundingAt: Number.isFinite(nextFundingAt) ? nextFundingAt : undefined,
      };
      this.cache.set(cacheKey, rate);
      return rate;
    } catch (err) {
      this.logger.debug({ err, hlSymbol, symbol }, "okx funding fetch failed");
      return null;
    }
  }
}
