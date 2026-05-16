/**
 * Canceled-order detector — turns HL historical orders into
 * `order_canceled` events with a typed `reason` field.
 *
 * Fills cover EXECUTIONS; cancels never produce a fill row, so this is the
 * only path that surfaces "the user / engine canceled an order". Engine-
 * driven housekeeping cancels (`scheduledCancel`) are filtered out here —
 * they are HL internals, not trader signal.
 *
 * Dedup: `getHistoricalOrders` is fetched with the same `fillSince` anchor
 * as fills, but that anchor only advances on new fills. Without dedup, the
 * same cancel rows would be re-emitted every sync between fills, hammering
 * the judge LLM and re-notifying the user. We carry a bounded set of
 * recently-emitted oids in the persisted snapshot (`recentCancelOids`) and
 * skip rows whose oid is in that set.
 *
 * Pure function — no I/O.
 */

import type { OrderRecord } from "../../services/interfaces/trading-types.js";
import type { OrderCanceledEvent } from "../events.js";

/**
 * Map HL `OrderRecord.status` to a cancel reason, or null when the status
 * is not a cancellation we want to surface.
 */
function cancelReason(
  status: OrderRecord["status"],
): "user" | "margin" | "liquidation" | "selfTrade" | null {
  switch (status) {
    case "canceled":
      return "user";
    case "marginCanceled":
      return "margin";
    case "liquidatedCanceled":
      return "liquidation";
    case "selfTradeCanceled":
      return "selfTrade";
    default:
      return null;
  }
}

export interface CanceledOrdersInput {
  historicalOrders: ReadonlyArray<OrderRecord>;
  /** Oids the detector already emitted on a prior tick — skipped here. */
  priorEmittedOids: ReadonlySet<string>;
  nowMs: number;
}

export interface CanceledOrdersResult {
  events: OrderCanceledEvent[];
  /** Oids freshly emitted this tick — caller merges into the snapshot dedup window. */
  emittedOids: string[];
}

export function detectCanceledOrders(input: CanceledOrdersInput): CanceledOrdersResult {
  const events: OrderCanceledEvent[] = [];
  const emittedOids: string[] = [];
  const seenThisTick = new Set<string>();
  for (const order of input.historicalOrders) {
    const reason = cancelReason(order.status);
    if (reason === null) continue;
    if (input.priorEmittedOids.has(order.oid)) continue;
    // Defensive: HL pagination edges have been known to duplicate rows
    // within a single response. Skip in-tick repeats too.
    if (seenThisTick.has(order.oid)) continue;
    seenThisTick.add(order.oid);
    events.push({
      type: "order_canceled",
      detectedAt: input.nowMs,
      orderId: order.oid,
      symbol: order.symbol,
      side: order.side,
      price: order.price || order.triggerPrice || 0,
      size: order.size,
      reduceOnly: order.reduceOnly,
      reason,
    });
    emittedOids.push(order.oid);
  }
  return { events, emittedOids };
}
