/**
 * Observer events — typed union emitted by the unified observer loop.
 *
 * Source of truth for "what happened in the trader's account since last tick".
 * Every event carries enough data for the mechanical notification formatter
 * AND the judge skill to reason about it without further round-trips.
 */

export type ObserverEventType =
  | "position_closed"
  | "tp_hit"
  | "sl_hit"
  | "position_liquidated"
  | "order_filled"
  | "order_canceled"
  | "liquidation_risk"
  | "pnl_snapshot"
  | "price_alert";

interface BaseEvent {
  type: ObserverEventType;
  /** Wall-clock ms when the observer detected the event. */
  detectedAt: number;
}

export interface PositionClosedEvent extends BaseEvent {
  type: "position_closed";
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  exitPrice: number;
  realizedPnl: number;
  /** PnL as a percentage of the margin used by the closed position. */
  realizedPnlPct: number;
  holdDurationMs: number;
  /** Fill id that closed the position (last fill matching this coin). */
  fillId: string;
}

export interface TpHitEvent extends BaseEvent {
  type: "tp_hit";
  symbol: string;
  side: "long" | "short";
  size: number;
  exitPrice: number;
  realizedPnl: number;
  fillId: string;
}

export interface SlHitEvent extends BaseEvent {
  type: "sl_hit";
  symbol: string;
  side: "long" | "short";
  size: number;
  exitPrice: number;
  realizedPnl: number;
  fillId: string;
}

export interface PositionLiquidatedEvent extends BaseEvent {
  type: "position_liquidated";
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  liquidationPrice: number;
  /** Negative number — the realized loss reported on the liquidation fill. */
  realizedPnl: number;
  holdDurationMs: number;
  fillId: string;
}

export interface OrderFilledEvent extends BaseEvent {
  type: "order_filled";
  symbol: string;
  side: "buy" | "sell";
  size: number;
  fillPrice: number;
  fillId: string;
}

export interface OrderCanceledEvent extends BaseEvent {
  type: "order_canceled";
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  /** Limit price or trigger price on the canceled order. */
  price: number;
  size: number;
  reduceOnly: boolean;
  /**
   * Why HL marked the order canceled. Drives skill tone — a `marginCanceled`
   * or `liquidatedCanceled` indicates the account just had a margin event,
   * which is much more interesting than a user-initiated cancel.
   *
   * Engine-driven `scheduledCancel` is filtered out upstream — it is HL
   * housekeeping (e.g. expiring time-in-force orders) and would otherwise
   * flood the buffer.
   */
  reason: "user" | "margin" | "liquidation" | "selfTrade";
}

export interface LiquidationRiskEvent extends BaseEvent {
  type: "liquidation_risk";
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  /** Fraction of entry→liq distance the mark has traveled toward liq. */
  progress: number;
  leverage: number;
  margin: number;
  unrealizedPnl: number;
}

export interface PnlSnapshotEvent extends BaseEvent {
  type: "pnl_snapshot";
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number;
  /** mark vs entry, signed percentage. */
  priceMovePct: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  margin: number;
  leverage: number;
  holdDurationMs: number;
  /** High-water mark of unrealizedPnl since position opened. */
  peakPnl: number;
  /** Low-water mark of unrealizedPnl since position opened. */
  troughPnl: number;
}

export interface PriceAlertEvent extends BaseEvent {
  type: "price_alert";
  alertId: string;
  symbol: string;
  condition: "above" | "below";
  targetPrice: number;
  currentPrice: number;
  note?: string;
}

export type ObserverEvent =
  | PositionClosedEvent
  | TpHitEvent
  | SlHitEvent
  | PositionLiquidatedEvent
  | OrderFilledEvent
  | OrderCanceledEvent
  | LiquidationRiskEvent
  | PnlSnapshotEvent
  | PriceAlertEvent;
