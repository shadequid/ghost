/**
 * Structured data view payload for the Wizard card.
 *
 * Doctrine: card mirrors what the LLM proposed in the chat advisory. Backend
 * never derives display values (margin, liq, $-risk/$-reward, RR) — those
 * must come from the agent or stay off the card. Only fields that map
 * directly to tool params land here.
 */

export type WizardCardSide = "long" | "short";
export type WizardCardOrderType = "market" | "limit";
export type WizardRowTone = "risk" | "reward" | "muted";

export interface WizardOpenPosition {
  kind: "open_position";
  symbol: string;
  side: WizardCardSide;
  leverage: number;
  size: number;
  orderType: WizardCardOrderType;
  /** Present only when the tool params carry a limit price. */
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface WizardGenericRow {
  label: string;
  value: string;
  tone?: WizardRowTone;
}

export interface WizardGenericGroup {
  label?: string;
  rows: WizardGenericRow[];
}

export interface WizardGeneric {
  kind: "generic";
  groups: WizardGenericGroup[];
}

export type WizardCardData = WizardOpenPosition | WizardGeneric;

export function composeOpenPositionWizard(input: {
  symbol: string;
  side: "buy" | "sell" | string;
  size: number;
  leverage?: number;
  orderType?: string;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
}): WizardOpenPosition | undefined {
  const symbol = input.symbol?.toUpperCase();
  if (!symbol) return undefined;
  if (typeof input.size !== "number" || !Number.isFinite(input.size)) return undefined;
  const side: WizardCardSide =
    input.side === "buy" || input.side === "long" ? "long" : "short";
  const leverage = input.leverage && input.leverage > 0 ? input.leverage : 1;
  const orderType: WizardCardOrderType =
    input.orderType === "limit" ? "limit" : "market";
  const hasEntry =
    typeof input.entryPrice === "number" &&
    Number.isFinite(input.entryPrice) &&
    input.entryPrice > 0;
  const entryPrice = hasEntry ? (input.entryPrice as number) : undefined;

  return {
    kind: "open_position",
    symbol,
    side,
    leverage,
    size: input.size,
    orderType,
    entryPrice,
    stopLoss: input.stopLoss,
    takeProfit: input.takeProfit,
  };
}

export function composeGenericWizard(
  groups: Array<{ label?: string; rows: WizardGenericRow[] }>,
): WizardGeneric {
  return { kind: "generic", groups };
}
