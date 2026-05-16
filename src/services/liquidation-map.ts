/**
 * Liquidation map service — estimates liquidation concentration zones
 * based on current price and common leverage tiers.
 */

import type { ITradingClient } from "./interfaces/trading-client.js";

// ─── Types ───

export interface LiquidationZone {
  price: number;
  leverage: number;
  side: "long" | "short";
  magnitude: "low" | "medium" | "high";
  distancePct: number;
}

export interface LiquidationMapResult {
  symbol: string;
  currentPrice: number;
  zones: LiquidationZone[];
}

// ─── Service ───

/**
 * Leverage tiers with relative OI weight.
 * Higher leverage = closer liquidation, but less typical OI.
 * Lower leverage = further liquidation, but more institutional OI.
 */
const LEVERAGE_TIERS: { leverage: number; weight: "high" | "medium" | "low" }[] = [
  { leverage: 2, weight: "high" },
  { leverage: 3, weight: "high" },
  { leverage: 5, weight: "high" },
  { leverage: 10, weight: "medium" },
  { leverage: 20, weight: "medium" },
  { leverage: 25, weight: "medium" },
  { leverage: 50, weight: "low" },
  { leverage: 100, weight: "low" },
];

/**
 * Maintenance margin rates by leverage (approximate for perps).
 * Higher leverage = higher maintenance margin requirement.
 */
function getMaintenanceMarginRate(leverage: number): number {
  if (leverage <= 5) return 0.005;
  if (leverage <= 10) return 0.01;
  if (leverage <= 25) return 0.02;
  if (leverage <= 50) return 0.025;
  return 0.05;
}

export class LiquidationMapService {
  constructor(private readonly hl: ITradingClient) {}

  /** Estimate liquidation concentration zones for a symbol. */
  async getLiquidationZones(symbol: string): Promise<LiquidationMapResult> {
    const ticker = await this.hl.getTicker(symbol);
    const resolved = this.hl.resolveSymbol(symbol);
    const currentPrice = ticker.markPrice;

    const zones: LiquidationZone[] = [];

    for (const tier of LEVERAGE_TIERS) {
      const mmr = getMaintenanceMarginRate(tier.leverage);

      // Long liquidation price (below current price)
      // Liq = Entry * (1 - 1/leverage + mmr)
      const longLiqFactor = 1 - (1 / tier.leverage) + mmr;
      const longLiqPrice = currentPrice * longLiqFactor;
      const longDistPct = ((currentPrice - longLiqPrice) / currentPrice) * 100;

      if (longLiqPrice > 0 && longDistPct > 0) {
        zones.push({
          price: roundPrice(longLiqPrice),
          leverage: tier.leverage,
          side: "long",
          magnitude: tier.weight,
          distancePct: roundPct(longDistPct),
        });
      }

      // Short liquidation price (above current price)
      // Liq = Entry * (1 + 1/leverage - mmr)
      const shortLiqFactor = 1 + (1 / tier.leverage) - mmr;
      const shortLiqPrice = currentPrice * shortLiqFactor;
      const shortDistPct = ((shortLiqPrice - currentPrice) / currentPrice) * 100;

      if (shortDistPct > 0) {
        zones.push({
          price: roundPrice(shortLiqPrice),
          leverage: tier.leverage,
          side: "short",
          magnitude: tier.weight,
          distancePct: roundPct(shortDistPct),
        });
      }
    }

    // Sort by distance from current price
    zones.sort((a, b) => a.distancePct - b.distancePct);

    return { symbol: resolved, currentPrice, zones };
  }
}

// ─── Helpers ───

function roundPrice(price: number): number {
  if (price >= 1000) return Math.round(price * 100) / 100;
  if (price >= 1) return Math.round(price * 1000) / 1000;
  return Math.round(price * 100000) / 100000;
}

function roundPct(pct: number): number {
  return Math.round(pct * 100) / 100;
}
