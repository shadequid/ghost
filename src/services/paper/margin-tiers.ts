/**
 * Per-asset max leverage and maintenance margin rates.
 * Models Hyperliquid's margin tier system for paper trading.
 */

interface MarginTier {
  maxLeverage: number;
  maintenanceMarginRate: number;
}

/** Major assets with known Hyperliquid-like tier limits. */
const ASSET_TIERS: Record<string, MarginTier> = {
  BTC:  { maxLeverage: 40, maintenanceMarginRate: 0.005 },
  ETH:  { maxLeverage: 25, maintenanceMarginRate: 0.01 },
  SOL:  { maxLeverage: 20, maintenanceMarginRate: 0.015 },
  // Mid-cap assets
  DOGE: { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  AVAX: { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  LINK: { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  ARB:  { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  OP:   { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  SUI:  { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  MATIC: { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  APT:  { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  INJ:  { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  NEAR: { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  ATOM: { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  FTM:  { maxLeverage: 10, maintenanceMarginRate: 0.025 },
  TIA:  { maxLeverage: 10, maintenanceMarginRate: 0.025 },
};

const DEFAULT_TIER: MarginTier = { maxLeverage: 5, maintenanceMarginRate: 0.05 };

/** Returns the max leverage for a given asset symbol. */
export function getMaxLeverage(symbol: string): number {
  return (ASSET_TIERS[symbol.toUpperCase()] ?? DEFAULT_TIER).maxLeverage;
}

/** Returns the maintenance margin rate for a given asset symbol. */
export function getMaintenanceMarginRate(symbol: string): number {
  return (ASSET_TIERS[symbol.toUpperCase()] ?? DEFAULT_TIER).maintenanceMarginRate;
}

/**
 * Validates that the requested leverage does not exceed the asset's max.
 * Throws a descriptive error if it does.
 */
export function validateLeverage(symbol: string, leverage: number): void {
  const max = getMaxLeverage(symbol);
  if (leverage > max) {
    throw new Error(`Leverage ${leverage}x exceeds max ${max}x for ${symbol.toUpperCase()}`);
  }
}
