/**
 * Pure math helpers for technical indicator computation.
 * No side effects, no external dependencies — only arithmetic.
 */

import type { Kline } from "./interfaces/trading-types.js";
import type { IchimokuData, BollingerData, KeltnerData } from "./ta-indicators.js";

// ---------------------------------------------------------------------------
// Core primitives
// ---------------------------------------------------------------------------

export function sma(data: number[], period: number): number {
  if (data.length < period) return NaN;
  return data.slice(-period).reduce((s, v) => s + v, 0) / period;
}

export function emaValue(data: number[], period: number): number {
  if (data.length < period) return NaN;
  const k = 2 / (period + 1);
  let value = sma(data.slice(0, period), period);
  for (let i = period; i < data.length; i++) value = data[i] * k + value * (1 - k);
  return value;
}

export function emaSeries(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let value = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result.push(value);
  for (let i = period; i < data.length; i++) {
    value = data[i] * k + value * (1 - k);
    result.push(value);
  }
  return result;
}

export function wilderSmooth(data: number[], period: number): number[] {
  if (data.length < period) return [];
  let value = data.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const result = [value];
  for (let i = period; i < data.length; i++) {
    value = (value * (period - 1) + data[i]) / period;
    result.push(value);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------------

export function computeVwap(highs: number[], lows: number[], closes: number[], volumes: number[]): number {
  let tpvSum = 0, volSum = 0;
  for (let i = 0; i < closes.length; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    tpvSum += tp * volumes[i];
    volSum += volumes[i];
  }
  return volSum === 0 ? NaN : tpvSum / volSum;
}

export function computeAdx(highs: number[], lows: number[], closes: number[], period = 14): { adx: number; plusDI: number; minusDI: number } {
  const len = highs.length;
  if (len < period + 1) return { adx: NaN, plusDI: NaN, minusDI: NaN };
  const plusDM: number[] = [], minusDM: number[] = [], tr: number[] = [];
  for (let i = 1; i < len; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smoothTR = wilderSmooth(tr, period);
  const smoothPlusDM = wilderSmooth(plusDM, period);
  const smoothMinusDM = wilderSmooth(minusDM, period);
  const dxValues: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    const pdi = smoothTR[i] === 0 ? 0 : (smoothPlusDM[i] / smoothTR[i]) * 100;
    const mdi = smoothTR[i] === 0 ? 0 : (smoothMinusDM[i] / smoothTR[i]) * 100;
    const sum = pdi + mdi;
    dxValues.push(sum === 0 ? 0 : (Math.abs(pdi - mdi) / sum) * 100);
  }
  const adxSmoothed = wilderSmooth(dxValues, period);
  const lastADX = adxSmoothed.length > 0 ? adxSmoothed[adxSmoothed.length - 1] : NaN;
  const lastIdx = smoothTR.length - 1;
  const lastPlusDI = lastIdx >= 0 && smoothTR[lastIdx] !== 0 ? (smoothPlusDM[lastIdx] / smoothTR[lastIdx]) * 100 : NaN;
  const lastMinusDI = lastIdx >= 0 && smoothTR[lastIdx] !== 0 ? (smoothMinusDM[lastIdx] / smoothTR[lastIdx]) * 100 : NaN;
  return { adx: lastADX, plusDI: lastPlusDI, minusDI: lastMinusDI };
}

export function computeIchimoku(highs: number[], lows: number[], closes: number[], price: number, klines: Kline[]): IchimokuData {
  const midHL = (h: number[], l: number[], start: number, end: number) =>
    (Math.max(...h.slice(start, end)) + Math.min(...l.slice(start, end))) / 2;
  const len = highs.length;
  const tenkan = len >= 9 ? midHL(highs, lows, len - 9, len) : NaN;
  const kijun = len >= 26 ? midHL(highs, lows, len - 26, len) : NaN;
  const senkouA = !isNaN(tenkan) && !isNaN(kijun) ? (tenkan + kijun) / 2 : NaN;
  const senkouB = len >= 52 ? midHL(highs, lows, len - 52, len) : NaN;
  const chikou = len >= 26 ? closes[len - 1] : NaN;

  let cloudPosition: IchimokuData["cloudPosition"] = "unknown";
  if (!isNaN(senkouA) && !isNaN(senkouB)) {
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBottom = Math.min(senkouA, senkouB);
    if (price > cloudTop) cloudPosition = "above";
    else if (price < cloudBottom) cloudPosition = "below";
    else cloudPosition = "inside";
  }
  let tenkanKijun: IchimokuData["tenkanKijun"] = "unknown";
  if (!isNaN(tenkan) && !isNaN(kijun)) {
    tenkanKijun = tenkan > kijun ? "bullish" : "bearish";
  }
  let chikouSignal: IchimokuData["chikouSignal"] = "unknown";
  if (!isNaN(chikou) && klines.length >= 27) {
    const pastClose = klines[klines.length - 27].close;
    chikouSignal = chikou > pastClose ? "bullish" : "bearish";
  }
  return { tenkan, kijun, senkouA, senkouB, chikou, cloudPosition, tenkanKijun, chikouSignal };
}

export function computeRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN;
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  const avgGain = wilderSmooth(gains, period);
  const avgLoss = wilderSmooth(losses, period);
  const lastL = avgLoss[avgLoss.length - 1];
  if (lastL === 0) return 100;
  return 100 - 100 / (1 + avgGain[avgGain.length - 1] / lastL);
}

export function computeStochRsi(closes: number[], rsiPeriod = 14, stochPeriod = 14, kSmooth = 3, dSmooth = 3): { k: number; d: number } {
  if (closes.length < rsiPeriod + stochPeriod + 1) return { k: NaN, d: NaN };
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
  }
  const avgGainArr = wilderSmooth(gains, rsiPeriod);
  const avgLossArr = wilderSmooth(losses, rsiPeriod);
  const rsiArr: number[] = [];
  for (let i = 0; i < avgGainArr.length; i++) {
    if (avgLossArr[i] === 0) { rsiArr.push(100); continue; }
    rsiArr.push(100 - 100 / (1 + avgGainArr[i] / avgLossArr[i]));
  }
  const stochValues: number[] = [];
  for (let i = stochPeriod - 1; i < rsiArr.length; i++) {
    const window = rsiArr.slice(i - stochPeriod + 1, i + 1);
    const hi = Math.max(...window), lo = Math.min(...window);
    stochValues.push(hi === lo ? 50 : ((rsiArr[i] - lo) / (hi - lo)) * 100);
  }
  const kValues: number[] = [];
  for (let i = kSmooth - 1; i < stochValues.length; i++) {
    kValues.push(stochValues.slice(i - kSmooth + 1, i + 1).reduce((s, v) => s + v, 0) / kSmooth);
  }
  const dValues: number[] = [];
  for (let i = dSmooth - 1; i < kValues.length; i++) {
    dValues.push(kValues.slice(i - dSmooth + 1, i + 1).reduce((s, v) => s + v, 0) / dSmooth);
  }
  return {
    k: kValues.length > 0 ? kValues[kValues.length - 1] : NaN,
    d: dValues.length > 0 ? dValues[dValues.length - 1] : NaN,
  };
}

export function computeMacd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): { macd: number; signal: number; histogram: number } {
  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const offset = slow - fast;
  const macdLine: number[] = [];
  for (let i = 0; i < slowEma.length; i++) macdLine.push(fastEma[i + offset] - slowEma[i]);
  const signalLine = emaSeries(macdLine, signalPeriod);
  const lastMacd = macdLine.length > 0 ? macdLine[macdLine.length - 1] : NaN;
  const lastSignal = signalLine.length > 0 ? signalLine[signalLine.length - 1] : NaN;
  return { macd: lastMacd, signal: lastSignal, histogram: lastMacd - lastSignal };
}

export function computeCci(highs: number[], lows: number[], closes: number[], period = 20): number {
  if (closes.length < period) return NaN;
  const tps: number[] = [];
  for (let i = 0; i < closes.length; i++) tps.push((highs[i] + lows[i] + closes[i]) / 3);
  const recentTps = tps.slice(-period);
  const mean = recentTps.reduce((s, v) => s + v, 0) / period;
  const meanDev = recentTps.reduce((s, v) => s + Math.abs(v - mean), 0) / period;
  if (meanDev === 0) return 0;
  return (recentTps[recentTps.length - 1] - mean) / (0.015 * meanDev);
}

export function computeWilliamsR(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < period) return NaN;
  const hh = Math.max(...highs.slice(-period));
  const ll = Math.min(...lows.slice(-period));
  if (hh === ll) return -50;
  return ((hh - closes[closes.length - 1]) / (hh - ll)) * -100;
}

export function computeBollingerBands(closes: number[], period = 20, multiplier = 2): BollingerData {
  if (closes.length < period) return { upper: NaN, middle: NaN, lower: NaN, bandwidth: NaN };
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / period;
  const stddev = Math.sqrt(slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period);
  const upper = mean + multiplier * stddev;
  const lower = mean - multiplier * stddev;
  return { upper, middle: mean, lower, bandwidth: mean === 0 ? 0 : ((upper - lower) / mean) * 100 };
}

export function computeAtr(highs: number[], lows: number[], closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN;
  const tr: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const smoothed = wilderSmooth(tr, period);
  return smoothed.length > 0 ? smoothed[smoothed.length - 1] : NaN;
}

export function computeKeltner(highs: number[], lows: number[], closes: number[], emaPeriod = 20, atrMultiplier = 1.5, atrPeriod = 14): KeltnerData {
  const mid = emaValue(closes, emaPeriod);
  const atrVal = computeAtr(highs, lows, closes, atrPeriod);
  return { upper: mid + atrMultiplier * atrVal, middle: mid, lower: mid - atrMultiplier * atrVal };
}

export function computeObv(closes: number[], volumes: number[], lookback = 10): { value: number; trend: string } {
  let cumulative = 0;
  const obvArr: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) cumulative += volumes[i];
    else if (closes[i] < closes[i - 1]) cumulative -= volumes[i];
    obvArr.push(cumulative);
  }
  const recent = obvArr.length >= lookback ? obvArr.slice(-lookback) : obvArr;
  const trend = recent.length >= 2 && recent[recent.length - 1] > recent[0]
    ? "rising" : recent.length >= 2 && recent[recent.length - 1] < recent[0]
      ? "falling" : "flat";
  return { value: cumulative, trend };
}

export function adxLabel(value: number): string {
  if (value < 20) return "weak/no trend";
  if (value < 25) return "emerging trend";
  if (value < 50) return "moderate trend";
  if (value < 75) return "strong trend";
  return "extreme trend";
}

export function extractOhlcv(klines: Kline[]): { highs: number[]; lows: number[]; closes: number[]; volumes: number[] } {
  return {
    highs: klines.map(k => k.high), lows: klines.map(k => k.low),
    closes: klines.map(k => k.close), volumes: klines.map(k => k.volume),
  };
}
