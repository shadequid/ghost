/**
 * Chart series computation service.
 * Produces full time-series arrays for TradingView chart indicators.
 * Reuses ta-math.ts primitives — no duplicate math.
 */

import type { ITradingClient } from "./interfaces/trading-client.js";
import type { Kline } from "./interfaces/trading-types.js";
import type {
  ChartDataResponse, ChartCandle, ChartVolume, ChartLineOverlay,
  ChartBandOverlay, ChartLevel, ChartSubPane,
} from "./interfaces/chart-types.js";
import type { LevelsResult } from "./ta-levels.js";
import { emaSeries, wilderSmooth, extractOhlcv } from "./ta-math.js";

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------

const COLOR_EMA21 = "#f7c948";
const COLOR_EMA50 = "#4dabf7";
const COLOR_EMA200 = "#ffffff";
const COLOR_VOL_UP = "rgba(38,166,154,0.5)";
const COLOR_VOL_DOWN = "rgba(239,83,80,0.5)";
const COLOR_HIST_UP = "rgba(38,166,154,0.8)";
const COLOR_HIST_DOWN = "rgba(239,83,80,0.8)";
const COLOR_BB = "#4dabf7";
const COLOR_ICHI = "rgba(76,175,80,0.3)";
const COLOR_KC = "rgba(255,152,0,0.4)";
const COLOR_RSI = "#e040fb";
const COLOR_MACD = "#4dabf7";
const COLOR_ADX = "#ff7043";

export type ChartIndicator =
  | "bb"
  | "ichimoku"
  | "keltner"
  | "rsi"
  | "macd"
  | "adx"
  | "stochrsi"
  | "obv"
  | "williamsr"
  | "atr"
  | "cci"
  | "vwap";

// ---------------------------------------------------------------------------
// Pure series helpers (not in ta-math — rolling window variants)
// ---------------------------------------------------------------------------

/** Rolling SMA series using O(n) sliding window. Returns array aligned to end of klines. */
function smaSeries(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += data[i];
  result.push(sum / period);
  for (let i = period; i < data.length; i++) {
    sum += data[i] - data[i - period];
    result.push(sum / period);
  }
  return result;
}

/** Rolling standard deviation series (population) using O(n) sliding window. */
function stddevSeries(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const result: number[] = [];
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
    sumSq += data[i] * data[i];
  }
  result.push(Math.sqrt(sumSq / period - (sum / period) ** 2));
  for (let i = period; i < data.length; i++) {
    const old = data[i - period];
    sum += data[i] - old;
    sumSq += data[i] * data[i] - old * old;
    result.push(Math.sqrt(Math.max(0, sumSq / period - (sum / period) ** 2)));
  }
  return result;
}

/** Bollinger Bands series. Returns {upper, middle, lower} arrays of equal length. */
function bollingerSeries(
  closes: number[], period = 20, multiplier = 2,
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = smaSeries(closes, period);
  const stddevs = stddevSeries(closes, period);
  const upper = middle.map((m, i) => m + multiplier * stddevs[i]);
  const lower = middle.map((m, i) => m - multiplier * stddevs[i]);
  return { upper, middle, lower };
}

/** Rolling midpoint of highest-high and lowest-low. */
function donchianMidSeries(highs: number[], lows: number[], period: number): number[] {
  if (highs.length < period) return [];
  const result: number[] = [];
  for (let i = period - 1; i < highs.length; i++) {
    const hSlice = highs.slice(i - period + 1, i + 1);
    const lSlice = lows.slice(i - period + 1, i + 1);
    result.push((Math.max(...hSlice) + Math.min(...lSlice)) / 2);
  }
  return result;
}

/** ATR series using Wilder smoothing. Length = closes.length - period. */
function atrSeries(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];
  const tr: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  return wilderSmooth(tr, period);
}

/** Keltner Channels series. Returns {upper, middle, lower} aligned by offset. */
function keltnerSeries(
  highs: number[], lows: number[], closes: number[],
  emaPeriod = 20, atrMultiplier = 1.5, atrPeriod = 14,
): { upper: number[]; middle: number[]; lower: number[]; offset: number } {
  const middle = emaSeries(closes, emaPeriod);     // length = closes.length - emaPeriod + 1
  const atr = atrSeries(highs, lows, closes, atrPeriod); // length = closes.length - atrPeriod
  // EMA starts at index (emaPeriod - 1); ATR starts at index atrPeriod
  // We need both aligned to the same kline index
  const emaStart = emaPeriod - 1;
  const atrStart = atrPeriod;
  const alignStart = Math.max(emaStart, atrStart);
  const emaOff = alignStart - emaStart;
  const atrOff = alignStart - atrStart;
  const len = Math.min(middle.length - emaOff, atr.length - atrOff);
  if (len <= 0) return { upper: [], middle: [], lower: [], offset: alignStart };
  const upper: number[] = [], midOut: number[] = [], lower: number[] = [];
  for (let i = 0; i < len; i++) {
    const m = middle[i + emaOff];
    const a = atr[i + atrOff];
    midOut.push(m);
    upper.push(m + atrMultiplier * a);
    lower.push(m - atrMultiplier * a);
  }
  return { upper, middle: midOut, lower, offset: alignStart };
}

/**
 * RSI series (period 14). Returns values aligned to klines starting at index `period`.
 * Length = closes.length - period.
 */
function rsiSeries(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  const avgGains = wilderSmooth(gains, period);
  const avgLosses = wilderSmooth(losses, period);
  return avgGains.map((g, i) => {
    const l = avgLosses[i];
    if (l === 0) return 100;
    return 100 - 100 / (1 + g / l);
  });
}

/**
 * MACD series (fast=12, slow=26, signal=9).
 * Returns {macdLine, signalLine, histogram} arrays — all equal length, aligned to signal period end.
 * Kline offset = slow - 1 + signalPeriod - 1 = 34 for default params.
 */
function macdSeries(
  closes: number[], fast = 12, slow = 26, signalPeriod = 9,
): { macdLine: number[]; signalLine: number[]; histogram: number[]; offset: number } {
  const fastEma = emaSeries(closes, fast);   // length = closes.length - fast + 1
  const slowEma = emaSeries(closes, slow);   // length = closes.length - slow + 1
  // slowEma is shorter; macdLine is aligned to slowEma
  const macdOffset = fast - 1;               // fastEma[macdOffset] aligns with slowEma[0]
  const macdLine: number[] = slowEma.map((s, i) => fastEma[i + macdOffset] - s);
  const signalLine = emaSeries(macdLine, signalPeriod);
  const sigOff = signalPeriod - 1;
  const histogram = signalLine.map((sig, i) => macdLine[i + sigOff] - sig);
  // kline offset: slow - 1 + sigOff
  const klineOffset = (slow - 1) + sigOff;
  return { macdLine: signalLine.map((_, i) => macdLine[i + sigOff]), signalLine, histogram, offset: klineOffset };
}

/**
 * ADX series. Returns adx values aligned per window.
 * offset: first kline the adx value corresponds to = period * 2 (approx).
 */
function adxSeries(
  highs: number[], lows: number[], closes: number[], period = 14,
): { values: number[]; offset: number } {
  const len = highs.length;
  if (len < period + 1) return { values: [], offset: 0 };
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < len; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));
  }
  const smoothTR = wilderSmooth(tr, period);
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);
  const dxValues: number[] = smoothTR.map((ttr, i) => {
    const pdi = ttr === 0 ? 0 : (smoothPlusDM[i] / ttr) * 100;
    const mdi = ttr === 0 ? 0 : (smoothMinusDM[i] / ttr) * 100;
    const sum = pdi + mdi;
    return sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100;
  });
  const adxSmoothed = wilderSmooth(dxValues, period);
  // kline offset: total klines - adxSmoothed.length
  // tr/dm from i=1 → len n-1; wilderSmooth(n-1, p) → n-p; wilderSmooth(n-p, p) → n-2p+1
  // so offset = n - (n-2p+1) = 2p-1  (but safer to compute dynamically)
  const offset = highs.length - adxSmoothed.length;
  return { values: adxSmoothed, offset };
}

/**
 * Stochastic RSI series.
 * Returns {k, d, offset} — K line and D line (smoothed K).
 * offset = rsiPeriod + stochPeriod + kSmooth - 2 for K, D is kSmooth-1 deeper.
 */
function stochRsiSeries(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): { k: number[]; d: number[]; offsetK: number; offsetD: number } {
  const rsi = rsiSeries(closes, rsiPeriod);
  if (rsi.length < stochPeriod) {
    return { k: [], d: [], offsetK: 0, offsetD: 0 };
  }
  const rawStoch: number[] = [];
  for (let i = stochPeriod - 1; i < rsi.length; i++) {
    const window = rsi.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...window);
    const max = Math.max(...window);
    const val = max === min ? 0 : ((rsi[i] - min) / (max - min)) * 100;
    rawStoch.push(val);
  }
  // Smooth K over kSmooth periods
  const k: number[] = [];
  for (let i = kSmooth - 1; i < rawStoch.length; i++) {
    let sum = 0;
    for (let j = 0; j < kSmooth; j++) sum += rawStoch[i - j];
    k.push(sum / kSmooth);
  }
  // Smooth D over dSmooth periods on K
  const d: number[] = [];
  for (let i = dSmooth - 1; i < k.length; i++) {
    let sum = 0;
    for (let j = 0; j < dSmooth; j++) sum += k[i - j];
    d.push(sum / dSmooth);
  }
  const offsetK = rsiPeriod + stochPeriod + kSmooth - 2;
  const offsetD = offsetK + dSmooth - 1;
  return { k, d, offsetK, offsetD };
}

/**
 * OBV (On-Balance Volume) cumulative series.
 * Length = closes.length, offset 0.
 */
function obvSeries(closes: number[], volumes: number[]): number[] {
  if (closes.length === 0) return [];
  const out: number[] = [volumes[0] ?? 0];
  for (let i = 1; i < closes.length; i++) {
    const prev = out[i - 1];
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) out.push(prev + volumes[i]);
    else if (diff < 0) out.push(prev - volumes[i]);
    else out.push(prev);
  }
  return out;
}

/**
 * Williams %R series. Range [-100, 0]. Oversold < -80, overbought > -20.
 * Length = closes.length - period + 1, offset = period - 1.
 */
function williamsRSeries(
  highs: number[], lows: number[], closes: number[], period = 14,
): number[] {
  if (closes.length < period) return [];
  const out: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    out.push(hh === ll ? 0 : ((hh - closes[i]) / (hh - ll)) * -100);
  }
  return out;
}

/**
 * CCI (Commodity Channel Index) series. Zones at ±100.
 * Length = closes.length - period + 1, offset = period - 1.
 */
function cciSeries(
  highs: number[], lows: number[], closes: number[], period = 20,
): number[] {
  if (closes.length < period) return [];
  const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const out: number[] = [];
  for (let i = period - 1; i < tp.length; i++) {
    const window = tp.slice(i - period + 1, i + 1);
    const sma = window.reduce((s, v) => s + v, 0) / period;
    const meanDev = window.reduce((s, v) => s + Math.abs(v - sma), 0) / period;
    out.push(meanDev === 0 ? 0 : (tp[i] - sma) / (0.015 * meanDev));
  }
  return out;
}

/**
 * VWAP rolling series (cumulative typical-price * volume / cumulative volume).
 * Length = closes.length, offset 0.
 */
function vwapSeries(
  highs: number[], lows: number[], closes: number[], volumes: number[],
): number[] {
  const out: number[] = [];
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += tp * volumes[i];
    cumV += volumes[i];
    out.push(cumV === 0 ? tp : cumPV / cumV);
  }
  return out;
}

/**
 * Ichimoku Senkou A/B series.
 * Senkou A = (Tenkan + Kijun) / 2, Tenkan = midpoint(9), Kijun = midpoint(26)
 * Senkou B = midpoint(52)
 * Both series start at kline index 51 (max(26-1, 52-1) = 51).
 */
function ichimokuCloudSeries(
  highs: number[], lows: number[],
): { senkouA: number[]; senkouB: number[]; offset: number } {
  const tenkanPeriod = 9, kijunPeriod = 26, senkouBPeriod = 52;
  const tenkan = donchianMidSeries(highs, lows, tenkanPeriod);  // starts at kline[8]
  const kijun = donchianMidSeries(highs, lows, kijunPeriod);    // starts at kline[25]
  const senkouBRaw = donchianMidSeries(highs, lows, senkouBPeriod); // starts at kline[51]
  // Align: tenkan[kijunPeriod - tenkanPeriod] aligns with kijun[0], both starting at kline[25]
  const tenkanKijunOff = kijunPeriod - tenkanPeriod; // 17
  const len = Math.min(tenkan.length - tenkanKijunOff, kijun.length);
  if (len <= 0 || senkouBRaw.length === 0) return { senkouA: [], senkouB: [], offset: senkouBPeriod - 1 };
  // Align senkouA with senkouB: senkouA starts at kline[25], senkouB at kline[51]
  const senkouAOff = senkouBPeriod - kijunPeriod; // 26
  const alignedLen = Math.min(len - senkouAOff, senkouBRaw.length);
  if (alignedLen <= 0) return { senkouA: [], senkouB: [], offset: senkouBPeriod - 1 };
  const senkouA: number[] = [];
  for (let i = 0; i < alignedLen; i++) {
    senkouA.push((tenkan[i + tenkanKijunOff + senkouAOff] + kijun[i + senkouAOff]) / 2);
  }
  return { senkouA, senkouB: senkouBRaw.slice(0, alignedLen), offset: senkouBPeriod - 1 };
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

export class ChartSeriesService {
  constructor(private readonly client: ITradingClient) {}

  /** Fetch klines from exchange and compute chart series. */
  async build(
    symbol: string,
    interval: string,
    indicators: ChartIndicator[],
    levels?: LevelsResult,
    limit = 500,
  ): Promise<ChartDataResponse> {
    const resolved = this.client.resolveSymbol(symbol);
    const klines = await this.client.getKlines(resolved, interval, limit);
    return ChartSeriesService.buildSeries(klines, symbol, interval, indicators, levels);
  }

  /** Pure computation — no I/O. Exported for testing and REST endpoints. */
  static buildSeries(
    klines: Kline[],
    symbol: string,
    interval: string,
    indicators: ChartIndicator[],
    levels?: LevelsResult,
  ): ChartDataResponse {
    const { highs, lows, closes, volumes: vols } = extractOhlcv(klines);

    // --- Candles ---
    const candles: ChartCandle[] = klines.map(k => ({
      time: Math.floor(k.openTime / 1000),
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    }));

    // --- Volumes ---
    const chartVolumes: ChartVolume[] = klines.map((k, i) => ({
      time: Math.floor(k.openTime / 1000),
      value: vols[i],
      color: k.close >= k.open ? COLOR_VOL_UP : COLOR_VOL_DOWN,
    }));

    // --- Base EMA overlays ---
    const lineOverlays: ChartLineOverlay[] = buildEmaOverlays(klines, closes);

    // --- Conditional band overlays ---
    const bandOverlays: ChartBandOverlay[] = [];

    if (indicators.includes("bb")) {
      const bb = bollingerSeries(closes, 20, 2);
      const bbOffset = 19; // period - 1
      bandOverlays.push({
        label: "BB",
        color: COLOR_BB,
        upperData: bb.upper.map((v, i) => ({ time: klines[i + bbOffset].openTime / 1000 | 0, value: v })),
        lowerData: bb.lower.map((v, i) => ({ time: klines[i + bbOffset].openTime / 1000 | 0, value: v })),
      });
    }

    if (indicators.includes("ichimoku")) {
      const ichi = ichimokuCloudSeries(highs, lows);
      const { senkouA, senkouB, offset } = ichi;
      bandOverlays.push({
        label: "Ichimoku",
        color: COLOR_ICHI,
        upperData: senkouA.map((v, i) => ({ time: klines[i + offset].openTime / 1000 | 0, value: v })),
        lowerData: senkouB.map((v, i) => ({ time: klines[i + offset].openTime / 1000 | 0, value: v })),
      });
    }

    if (indicators.includes("keltner")) {
      const kc = keltnerSeries(highs, lows, closes, 20, 1.5, 14);
      bandOverlays.push({
        label: "Keltner",
        color: COLOR_KC,
        upperData: kc.upper.map((v, i) => ({ time: klines[i + kc.offset].openTime / 1000 | 0, value: v })),
        lowerData: kc.lower.map((v, i) => ({ time: klines[i + kc.offset].openTime / 1000 | 0, value: v })),
      });
    }

    // --- Conditional sub-panes ---
    const subPanes: ChartSubPane[] = [];

    if (indicators.includes("rsi")) {
      const rsi = rsiSeries(closes, 14);
      const rsiOffset = 14; // period
      subPanes.push({
        label: "RSI",
        type: "line",
        color: COLOR_RSI,
        data: rsi.map((v, i) => ({ time: klines[i + rsiOffset].openTime / 1000 | 0, value: v })),
        zones: [
          { value: 70, color: "rgba(239,83,80,0.3)" },
          { value: 30, color: "rgba(38,166,154,0.3)" },
        ],
      });
    }

    if (indicators.includes("macd")) {
      const { macdLine, signalLine, histogram, offset } = macdSeries(closes, 12, 26, 9);
      subPanes.push({
        label: "MACD",
        type: "macd",
        color: COLOR_MACD,
        data: macdLine.map((v, i) => ({ time: klines[i + offset].openTime / 1000 | 0, value: v })),
        signalData: signalLine.map((v, i) => ({ time: klines[i + offset].openTime / 1000 | 0, value: v })),
        histogramData: histogram.map((v, i) => ({
          time: klines[i + offset].openTime / 1000 | 0,
          value: v,
          color: v >= 0 ? COLOR_HIST_UP : COLOR_HIST_DOWN,
        })),
      });
    }

    if (indicators.includes("adx")) {
      const { values, offset } = adxSeries(highs, lows, closes, 14);
      subPanes.push({
        label: "ADX",
        type: "line",
        color: COLOR_ADX,
        data: values.map((v, i) => ({ time: klines[i + offset].openTime / 1000 | 0, value: v })),
      });
    }

    if (indicators.includes("stochrsi")) {
      const { k, d, offsetK, offsetD } = stochRsiSeries(closes);
      // D is shorter than K — align both to D's start index to present cleanly.
      const alignGap = offsetD - offsetK;
      const kAligned = k.slice(alignGap);
      subPanes.push({
        label: "StochRSI",
        type: "line",
        color: "#ba68c8",
        data: kAligned.map((v, i) => ({
          time: klines[i + offsetD].openTime / 1000 | 0,
          value: v,
        })),
        signalData: d.map((v, i) => ({
          time: klines[i + offsetD].openTime / 1000 | 0,
          value: v,
        })),
        zones: [
          { value: 80, color: "rgba(239,83,80,0.3)" },
          { value: 20, color: "rgba(38,166,154,0.3)" },
        ],
      });
    }

    if (indicators.includes("obv")) {
      const values = obvSeries(closes, vols);
      subPanes.push({
        label: "OBV",
        type: "line",
        color: "#4fc3f7",
        data: values.map((v, i) => ({
          time: klines[i].openTime / 1000 | 0,
          value: v,
        })),
      });
    }

    if (indicators.includes("williamsr")) {
      const values = williamsRSeries(highs, lows, closes, 14);
      const offset = 13; // period - 1
      subPanes.push({
        label: "WilliamsR",
        type: "line",
        color: "#ec407a",
        data: values.map((v, i) => ({
          time: klines[i + offset].openTime / 1000 | 0,
          value: v,
        })),
        zones: [
          { value: -20, color: "rgba(239,83,80,0.3)" },
          { value: -80, color: "rgba(38,166,154,0.3)" },
        ],
      });
    }

    if (indicators.includes("cci")) {
      const values = cciSeries(highs, lows, closes, 20);
      const offset = 19; // period - 1
      subPanes.push({
        label: "CCI",
        type: "line",
        color: "#9ccc65",
        data: values.map((v, i) => ({
          time: klines[i + offset].openTime / 1000 | 0,
          value: v,
        })),
        zones: [
          { value: 100, color: "rgba(239,83,80,0.3)" },
          { value: -100, color: "rgba(38,166,154,0.3)" },
        ],
      });
    }

    if (indicators.includes("atr")) {
      const values = atrSeries(highs, lows, closes, 14);
      const offset = 14; // period
      subPanes.push({
        label: "ATR",
        type: "line",
        color: "#ffd54f",
        data: values.map((v, i) => ({
          time: klines[i + offset].openTime / 1000 | 0,
          value: v,
        })),
      });
    }

    if (indicators.includes("vwap")) {
      const values = vwapSeries(highs, lows, closes, vols);
      lineOverlays.push({
        label: "VWAP",
        color: "#80deea",
        data: values.map((v, i) => ({
          time: klines[i].openTime / 1000 | 0,
          value: v,
        })),
      });
    }

    // --- Levels ---
    const chartLevels: ChartLevel[] = buildLevels(levels);

    return { symbol, interval, candles, volumes: chartVolumes, lineOverlays, bandOverlays, levels: chartLevels, subPanes };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildEmaOverlays(klines: Kline[], closes: number[]): ChartLineOverlay[] {
  const periods: Array<{ period: number; label: string; color: string }> = [
    { period: 21, label: "EMA 21", color: COLOR_EMA21 },
    { period: 50, label: "EMA 50", color: COLOR_EMA50 },
    { period: 200, label: "EMA 200", color: COLOR_EMA200 },
  ];
  return periods.map(({ period, label, color }) => {
    const series = emaSeries(closes, period);
    const offset = period - 1;
    return {
      label,
      color,
      data: series.map((v, i) => ({
        time: Math.floor(klines[i + offset].openTime / 1000),
        value: v,
      })),
    };
  });
}

const MAX_LEVELS_PER_SIDE = 3;
const MIN_LEVEL_DISTANCE_PCT = 0.01; // 1% minimum gap between levels

function filterLevels(
  items: Array<{ price: number; label: string }>,
  side: "support" | "resistance",
  currentPrice: number,
): ChartLevel[] {
  // Closest to current price first — most relevant for trader
  const sorted = [...items].sort(
    (a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice),
  );
  const result: ChartLevel[] = [];
  for (const item of sorted) {
    if (result.length >= MAX_LEVELS_PER_SIDE) break;
    const tooClose = result.some(
      r => Math.abs(r.price - item.price) / currentPrice < MIN_LEVEL_DISTANCE_PCT,
    );
    if (!tooClose) {
      result.push({ price: item.price, label: item.label, side });
    }
  }
  return result;
}

function buildLevels(levels?: LevelsResult): ChartLevel[] {
  if (!levels) return [];
  return [
    ...filterLevels(levels.resistance, "resistance", levels.price),
    ...filterLevels(levels.support, "support", levels.price),
  ];
}
