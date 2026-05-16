/**
 * Technical indicator computation service.
 * Fetches klines from ITradingClient, computes indicators, returns typed data.
 */

import type { ITradingClient } from "./interfaces/trading-client.js";
import {
  emaValue, computeVwap, computeAdx, computeIchimoku,
  computeRsi, computeStochRsi, computeMacd, computeCci, computeWilliamsR,
  computeBollingerBands, computeAtr, computeKeltner, computeObv,
  adxLabel, extractOhlcv,
} from "./ta-math.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface IchimokuData {
  tenkan: number;
  kijun: number;
  senkouA: number;
  senkouB: number;
  chikou: number;
  cloudPosition: "above" | "below" | "inside" | "unknown";
  tenkanKijun: "bullish" | "bearish" | "unknown";
  chikouSignal: "bullish" | "bearish" | "unknown";
}

export interface BollingerData {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
}

export interface KeltnerData {
  upper: number;
  middle: number;
  lower: number;
}

export interface IndicatorResult {
  symbol: string;
  interval: string;
  price: number;
  trend: {
    ema9: number; ema21: number; ema50: number; ema200: number;
    vwap: number; vwapDiffPct: number;
    adx: number; adxLabel: string;
    ichimoku: IchimokuData;
  };
  momentum: {
    rsi: number;
    stochRsi: { k: number; d: number };
    macd: { macd: number; signal: number; histogram: number };
    cci: number;
    williamsR: number;
  };
  volatility: {
    bb: BollingerData;
    atr: number;
    atrPct: number;
    keltner: KeltnerData;
    squeeze: boolean;
  };
  volume: {
    obv: number;
    obvTrend: string;
    priceDirection: string;
    confirming: boolean;
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TaIndicatorService {
  constructor(private readonly hl: ITradingClient) {}

  /** Compute technical indicators for a symbol. Returns typed data. */
  async getIndicators(symbol: string, interval: string, indicators?: string[]): Promise<IndicatorResult> {
    const klines = await this.hl.getKlines(symbol, interval, 250);
    if (klines.length < 30) throw new Error("Insufficient candle data (need at least 30 candles).");

    const resolved = this.hl.resolveSymbol(symbol);
    const { highs, lows, closes, volumes } = extractOhlcv(klines);
    const price = closes[closes.length - 1];
    const filter = indicators?.map(s => s.toLowerCase());
    const include = (name: string) => !filter || filter.some(f => name.toLowerCase().includes(f));

    // Trend
    const ema9 = include("ema") || include("trend") ? emaValue(closes, 9) : NaN;
    const ema21 = include("ema") || include("trend") ? emaValue(closes, 21) : NaN;
    const ema50 = include("ema") || include("trend") ? emaValue(closes, 50) : NaN;
    const ema200 = include("ema") || include("trend") ? emaValue(closes, 200) : NaN;
    const vwapVal = include("vwap") || include("trend") ? computeVwap(highs, lows, closes, volumes) : NaN;
    const adxResult = include("adx") || include("trend") ? computeAdx(highs, lows, closes, 14) : { adx: NaN, plusDI: NaN, minusDI: NaN };
    const ichiData = include("ichimoku") || include("trend")
      ? computeIchimoku(highs, lows, closes, price, klines)
      : { tenkan: NaN, kijun: NaN, senkouA: NaN, senkouB: NaN, chikou: NaN, cloudPosition: "unknown" as const, tenkanKijun: "unknown" as const, chikouSignal: "unknown" as const };

    // Momentum
    const rsiVal = include("rsi") || include("momentum") ? computeRsi(closes, 14) : NaN;
    const stochRsiVal = include("stochrsi") || include("momentum") ? computeStochRsi(closes) : { k: NaN, d: NaN };
    const macdVal = include("macd") || include("momentum") ? computeMacd(closes) : { macd: NaN, signal: NaN, histogram: NaN };
    const cciVal = include("cci") || include("momentum") ? computeCci(highs, lows, closes, 20) : NaN;
    const williamsVal = include("williams") || include("momentum") ? computeWilliamsR(highs, lows, closes, 14) : NaN;

    // Volatility
    const bbVal = include("bollinger") || include("bb") || include("volatility") ? computeBollingerBands(closes) : { upper: NaN, middle: NaN, lower: NaN, bandwidth: NaN };
    const atrVal = include("atr") || include("volatility") ? computeAtr(highs, lows, closes, 14) : NaN;
    const kcVal = include("keltner") || include("squeeze") || include("volatility") ? computeKeltner(highs, lows, closes) : { upper: NaN, middle: NaN, lower: NaN };
    const squeeze = !isNaN(bbVal.lower) && !isNaN(kcVal.lower) ? bbVal.lower > kcVal.lower && bbVal.upper < kcVal.upper : false;

    // Volume
    const obvResult = include("obv") || include("volume") ? computeObv(closes, volumes, 10) : { value: NaN, trend: "unknown" };
    const priceDir = closes[closes.length - 1] > closes[Math.max(0, closes.length - 11)] ? "uptrend" : "downtrend";
    const confirming = (obvResult.trend === "rising" && priceDir === "uptrend") || (obvResult.trend === "falling" && priceDir === "downtrend");

    return {
      symbol: resolved, interval, price,
      trend: {
        ema9, ema21, ema50, ema200,
        vwap: vwapVal, vwapDiffPct: !isNaN(vwapVal) ? ((price - vwapVal) / vwapVal) * 100 : NaN,
        adx: adxResult.adx, adxLabel: !isNaN(adxResult.adx) ? adxLabel(adxResult.adx) : "unknown",
        ichimoku: ichiData,
      },
      momentum: { rsi: rsiVal, stochRsi: stochRsiVal, macd: macdVal, cci: cciVal, williamsR: williamsVal },
      volatility: { bb: bbVal, atr: atrVal, atrPct: !isNaN(atrVal) ? (atrVal / price) * 100 : NaN, keltner: kcVal, squeeze },
      volume: { obv: obvResult.value, obvTrend: obvResult.trend, priceDirection: priceDir, confirming },
    };
  }
}
