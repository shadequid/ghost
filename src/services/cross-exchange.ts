/**
 * Cross-exchange funding comparison service.
 * Aggregates funding rates from CEX providers (Binance, Bybit, OKX) via
 * their public REST APIs, then compares the average against Hyperliquid's rate.
 */

import type { Logger } from "pino";
import type { FundingProvider } from "./funding/index.js";
import { toCexSymbol } from "./funding/symbol-mapping.js";

export interface CexFundingDatum {
  exchange: string;
  symbol: string;
  rate: number;
  rateText: string;
  fetchedAt: number;
  nextFundingAt?: number;
}

export interface CrossExchangeResult {
  hlRate: number;
  hlRateText: string;
  cexData: CexFundingDatum[];
  /** Pre-computed average CEX rate. null when cexData is empty. */
  avgCexRate: number | null;
  avgCexRateText: string | null;
  /** HL minus avg CEX, in percentage points (e.g. 0.0123 = HL is 0.0123% higher). null when cexData is empty. */
  deltaPct: number | null;
  degraded: boolean;
  degradedReason: string | null;
}

export class CrossExchangeService {
  constructor(
    private readonly providers: FundingProvider[],
    private readonly logger?: Logger,
  ) {}

  async getCrossExchangeFunding(
    hlSymbol: string,
    hlFundingRate: number,
  ): Promise<CrossExchangeResult> {
    const hlRateText = `${(hlFundingRate * 100).toFixed(4)}%`;

    const results = await Promise.allSettled(
      this.providers.map(async (p) => {
        const rate = await p.fetchFundingRate(hlSymbol);
        return rate ? { provider: p, rate } : null;
      }),
    );

    // Warn once when one or more providers are rejected.
    // Per-provider debug logs are emitted inside each provider's catch block.
    const rejectedProviders = this.providers
      .map((p, i) => ({ p, r: results[i] }))
      .filter(({ r }) => r.status === "rejected")
      .map(({ p }) => p.name);
    if (rejectedProviders.length > 0) {
      this.logger?.warn(
        { providers: rejectedProviders, count: rejectedProviders.length },
        "cross-exchange: some funding providers threw — partial degradation",
      );
    }

    const cexData: CexFundingDatum[] = [];
    for (const r of results) {
      if (r.status !== "fulfilled" || r.value === null) continue;
      const { provider, rate } = r.value;
      const symbol = toCexSymbolForDisplay(hlSymbol, provider.key);
      cexData.push({
        exchange: provider.name,
        symbol,
        rate: rate.rate,
        rateText: `${(rate.rate * 100).toFixed(4)}%`,
        fetchedAt: rate.fetchedAt,
        nextFundingAt: rate.nextFundingAt,
      });
    }

    let avgCexRate: number | null = null;
    let avgCexRateText: string | null = null;
    let deltaPct: number | null = null;
    if (cexData.length > 0) {
      avgCexRate = cexData.reduce((s, d) => s + d.rate, 0) / cexData.length;
      avgCexRateText = `${(avgCexRate * 100).toFixed(4)}%`;
      deltaPct = (hlFundingRate - avgCexRate) * 100;
    }

    return {
      hlRate: hlFundingRate,
      hlRateText,
      cexData,
      avgCexRate,
      avgCexRateText,
      deltaPct,
      degraded: cexData.length === 0,
      degradedReason: cexData.length === 0
        ? "No CEX funding data available (all providers failed or symbol not listed)."
        : null,
    };
  }
}

// Local helper — keeps cross-exchange.ts independent from the full symbol-mapping
// module signature. Falls back to uppercased HL symbol when mapping is null.
function toCexSymbolForDisplay(hlSymbol: string, key: FundingProvider["key"]): string {
  return toCexSymbol(hlSymbol, key) ?? hlSymbol.toUpperCase();
}
