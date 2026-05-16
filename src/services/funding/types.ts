/** Funding rate datum for a single (provider, symbol) pair. */
export interface FundingRate {
  /** Numeric rate, e.g. 0.0001 = 0.01%. Signed (positive = longs pay shorts). */
  rate: number;
  /** Local clock ms when this datum was fetched (for cache + freshness display). */
  fetchedAt: number;
  /** ms timestamp of next funding event, when the provider exposes it. */
  nextFundingAt?: number;
}

export type ProviderKey = "binance" | "bybit" | "okx";

export interface FundingProvider {
  readonly name: string;       // Display name, e.g. "Binance"
  readonly key: ProviderKey;   // Stable identifier for cache + telemetry
  /** Returns null on symbol-not-listed or fetch failure. Never throws. */
  fetchFundingRate(hlSymbol: string): Promise<FundingRate | null>;
}
