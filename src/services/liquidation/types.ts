export type LiquidationTier = "attention" | "danger" | "critical";

/** Canonical low-to-high ordering used by the fire-once / escalation gate. */
export const TIER_ORDER: readonly LiquidationTier[] = ["attention", "danger", "critical"];

export function tierToKind(
  tier: LiquidationTier,
): "liquidation_attention" | "liquidation_danger" | "liquidation_critical" {
  return `liquidation_${tier}` as const;
}

export function kindToTier(kind: string): LiquidationTier | null {
  if (kind === "liquidation_attention") return "attention";
  if (kind === "liquidation_danger") return "danger";
  if (kind === "liquidation_critical") return "critical";
  return null;
}

export const LIQUIDATION_KINDS = [
  "liquidation_attention",
  "liquidation_danger",
  "liquidation_critical",
] as const;
