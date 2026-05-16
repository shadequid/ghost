/**
 * Whale tracking service — detects whale activity from Hyperliquid market data.
 * Analyzes OI concentration, volume spikes, extreme funding, and cluster behavior.
 */

import type { ITradingClient } from "./interfaces/trading-client.js";
import type { Ticker, Kline } from "./interfaces/trading-types.js";

// ─── Types ───

export interface WhaleOverview {
  topByOI: WhaleAsset[];
  topByVolume: WhaleAsset[];
  extremeFunding: WhaleAsset[];
  clusterSignal: ClusterSignal | null;
}

export interface WhaleAsset {
  symbol: string;
  openInterest: number;
  volume24h: number;
  fundingRate: number;
  fundingDirection: "longs pay" | "shorts pay" | "neutral";
  priceChangePct24h: number;
}

export interface WhaleDetailedView {
  symbol: string;
  openInterest: number;
  volume24h: number;
  fundingRate: number;
  fundingDirection: "longs pay" | "shorts pay" | "neutral";
  priceChangePct24h: number;
  markPrice: number;
  volumeTrend: "increasing" | "decreasing" | "stable";
  fundingTrend: "rising" | "falling" | "stable";
  volumeSpike: boolean;
  interpretation: string;
}

export interface ClusterSignal {
  direction: "long-heavy" | "short-heavy" | "mixed";
  count: number;
  assets: string[];
  description: string;
}

// ─── Service ───

const EXTREME_FUNDING_THRESHOLD = 0.0003; // 0.03% per 8h

export class WhaleTrackingService {
  constructor(private readonly hl: ITradingClient) {}

  /** Market-wide whale activity overview. */
  async getWhaleActivity(): Promise<WhaleOverview> {
    const tickers = await this.hl.getAllTickers();
    const active = tickers.filter((t) => t.openInterest > 0 && t.volume24h > 0);

    const toWhaleAsset = (t: Ticker): WhaleAsset => ({
      symbol: t.symbol,
      openInterest: t.openInterest,
      volume24h: t.volume24h,
      fundingRate: t.fundingRate,
      fundingDirection: classifyFunding(t.fundingRate),
      priceChangePct24h: t.priceChangePct24h,
    });

    const topByOI = [...active]
      .sort((a, b) => b.openInterest - a.openInterest)
      .slice(0, 10)
      .map(toWhaleAsset);

    const topByVolume = [...active]
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 10)
      .map(toWhaleAsset);

    const extremeFunding = active
      .filter((t) => Math.abs(t.fundingRate) > EXTREME_FUNDING_THRESHOLD)
      .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate))
      .slice(0, 10)
      .map(toWhaleAsset);

    const clusterSignal = detectCluster(topByOI);

    return { topByOI, topByVolume, extremeFunding, clusterSignal };
  }

  /** Detailed whale activity for a single coin. */
  async getWhaleActivityForCoin(symbol: string): Promise<WhaleDetailedView> {
    const [ticker, klines, fundingHistory] = await Promise.all([
      this.hl.getTicker(symbol),
      this.hl.getKlines(symbol, "1h", 24),
      this.hl.getFundingHistory(symbol, 20),
    ]);

    const resolved = this.hl.resolveSymbol(symbol);
    const volumeTrend = analyzeVolumeTrend(klines);
    const fundingTrend = analyzeFundingTrend(fundingHistory);
    const volumeSpike = detectVolumeSpike(klines);
    const fundingDirection = classifyFunding(ticker.fundingRate);

    const interpretation = buildInterpretation(
      resolved, fundingDirection, volumeTrend, volumeSpike, ticker.fundingRate,
    );

    return {
      symbol: resolved,
      openInterest: ticker.openInterest,
      volume24h: ticker.volume24h,
      fundingRate: ticker.fundingRate,
      fundingDirection,
      priceChangePct24h: ticker.priceChangePct24h,
      markPrice: ticker.markPrice,
      volumeTrend,
      fundingTrend,
      volumeSpike,
      interpretation,
    };
  }
}

// ─── Helpers ───

function classifyFunding(rate: number): "longs pay" | "shorts pay" | "neutral" {
  if (rate > 0.00005) return "longs pay";
  if (rate < -0.00005) return "shorts pay";
  return "neutral";
}

function detectCluster(assets: WhaleAsset[]): ClusterSignal | null {
  const longsPayCount = assets.filter((a) => a.fundingDirection === "longs pay").length;
  const shortsPayCount = assets.filter((a) => a.fundingDirection === "shorts pay").length;

  if (longsPayCount >= 7) {
    return {
      direction: "long-heavy",
      count: longsPayCount,
      assets: assets.filter((a) => a.fundingDirection === "longs pay").map((a) => a.symbol),
      description: `${longsPayCount}/10 top OI assets have positive funding — market is crowded long`,
    };
  }
  if (shortsPayCount >= 7) {
    return {
      direction: "short-heavy",
      count: shortsPayCount,
      assets: assets.filter((a) => a.fundingDirection === "shorts pay").map((a) => a.symbol),
      description: `${shortsPayCount}/10 top OI assets have negative funding — market is crowded short`,
    };
  }
  return null;
}

/** Estimate volume trend from hourly volume pattern. */
function analyzeVolumeTrend(klines: Kline[]): "increasing" | "decreasing" | "stable" {
  if (klines.length < 6) return "stable";
  const recentHalf = klines.slice(-Math.floor(klines.length / 2));
  const olderHalf = klines.slice(0, Math.floor(klines.length / 2));
  const recentAvgVol = recentHalf.reduce((s, k) => s + k.volume, 0) / recentHalf.length;
  const olderAvgVol = olderHalf.reduce((s, k) => s + k.volume, 0) / olderHalf.length;
  if (olderAvgVol === 0) return "stable";
  const ratio = recentAvgVol / olderAvgVol;
  if (ratio > 1.3) return "increasing";
  if (ratio < 0.7) return "decreasing";
  return "stable";
}

/** Analyze funding rate trend from history. */
function analyzeFundingTrend(history: unknown[]): "rising" | "falling" | "stable" {
  if (history.length < 4) return "stable";
  const rates = history
    .map((h) => {
      const entry = h as { fundingRate?: string };
      return parseFloat(entry.fundingRate ?? "0");
    })
    .filter((r) => !isNaN(r));
  if (rates.length < 4) return "stable";
  const recent = rates.slice(-Math.floor(rates.length / 2));
  const older = rates.slice(0, Math.floor(rates.length / 2));
  const recentAvg = recent.reduce((s, r) => s + r, 0) / recent.length;
  const olderAvg = older.reduce((s, r) => s + r, 0) / older.length;
  const diff = recentAvg - olderAvg;
  if (diff > 0.0001) return "rising";
  if (diff < -0.0001) return "falling";
  return "stable";
}

/** Detect volume spike: latest candle > 2x average. */
function detectVolumeSpike(klines: Kline[]): boolean {
  if (klines.length < 3) return false;
  const avgVol = klines.slice(0, -1).reduce((s, k) => s + k.volume, 0) / (klines.length - 1);
  if (avgVol === 0) return false;
  const latest = klines[klines.length - 1].volume;
  return latest > avgVol * 2;
}

function buildInterpretation(
  symbol: string,
  fundingDirection: string,
  volumeTrend: string,
  volumeSpike: boolean,
  fundingRate: number,
): string {
  const parts: string[] = [];

  if (fundingDirection === "longs pay" && Math.abs(fundingRate) > EXTREME_FUNDING_THRESHOLD) {
    parts.push(`${symbol} is crowded long with elevated funding`);
  } else if (fundingDirection === "shorts pay" && Math.abs(fundingRate) > EXTREME_FUNDING_THRESHOLD) {
    parts.push(`${symbol} is crowded short with elevated funding`);
  } else {
    parts.push(`${symbol} funding is neutral`);
  }

  if (volumeTrend === "increasing") parts.push("Volume activity is increasing");
  if (volumeTrend === "decreasing") parts.push("Volume activity is cooling");
  if (volumeSpike) parts.push("volume spike detected on latest candle");

  return parts.join("; ") + ".";
}
