/**
 * Diff composer — wraps the per-domain detect modules and combines their
 * outputs into a single event list + next-snapshot map.
 *
 * The actual detection logic lives in `detect/*` as pure functions. This
 * file is thin orchestration: call each detector in the right order, merge
 * their results, return.
 *
 * Pure function — no I/O.
 */

import type {
  Fill,
  OpenOrder,
  OrderRecord,
  Position,
} from "../services/interfaces/trading-types.js";
import type { AlertRule } from "../services/alert-rules.js";
import type { ObserverEvent } from "./events.js";
import type { ObserverSnapshot, PositionSnapshot } from "./state-store.js";

import { detectPositions, liquidationProgress } from "./detect/positions.js";
import { detectFills } from "./detect/fills.js";
import { detectClosedFallback } from "./detect/closed-fallback.js";
import { detectCanceledOrders } from "./detect/canceled-orders.js";
import { detectPriceTargetCrossings } from "./detect/price-target.js";

export { liquidationProgress };

export interface DiffInput {
  prior: ObserverSnapshot;
  positions: Position[];
  openOrders: OpenOrder[];
  newFills: Fill[];
  newHistoricalOrders: OrderRecord[];
  /** Active price-target rules — observer fetches from AlertRulesService each eval. */
  alertRules: ReadonlyArray<AlertRule>;
  /** Latest per-symbol marks from PriceCache. */
  prices: ReadonlyMap<string, number>;
  /** Liquidation progress threshold (e.g. 0.8). */
  liqProgressThreshold: number;
  nowMs: number;
}

export interface DiffResult {
  events: ObserverEvent[];
  /** Next position snapshot to persist. Caller stamps lastFillTimestamp + openOrderIds. */
  nextPositions: Record<string, PositionSnapshot>;
  /** Alert-rule ids that crossed this tick — caller marks them fired in storage. */
  firedAlertIds: string[];
  /** Cancel oids emitted this tick — caller merges into the snapshot dedup window. */
  emittedCancelOids: string[];
  /** Fill `tradeId`s processed this tick — caller merges into the snapshot dedup window. */
  emittedFillIds: string[];
}

export function diffSnapshot(input: DiffInput): DiffResult {
  // 1. Open positions → pnl_snapshot + liquidation_risk.
  const positionsR = detectPositions({
    positions: input.positions,
    prior: input.prior,
    liqProgressThreshold: input.liqProgressThreshold,
    nowMs: input.nowMs,
  });

  // 2. Fills → tp/sl/liquidation/order_filled/position_closed.
  const fillsR = detectFills({
    fills: input.newFills,
    prior: input.prior,
    currentlyOpenKeys: positionsR.seenKeys,
    priorEmittedFillIds: new Set(input.prior.recentEmittedFillIds),
    nowMs: input.nowMs,
  });

  // 3. Disappeared positions without a matching fill → synthetic close.
  const fallbackEvents = detectClosedFallback({
    prior: input.prior,
    currentlyOpenKeys: positionsR.seenKeys,
    classifiedCloseKeys: fillsR.classifiedCloseKeys,
    nowMs: input.nowMs,
  });

  // 4. Historical orders → order_canceled (dedup against the snapshot's
  //    rolling oid window so the same cancel doesn't re-emit every sync).
  const cancelR = detectCanceledOrders({
    historicalOrders: input.newHistoricalOrders,
    priorEmittedOids: new Set(input.prior.recentCancelOids),
    nowMs: input.nowMs,
  });

  // 5. Active alert rules × current prices → price_alert.
  const priceTargetR = detectPriceTargetCrossings({
    rules: input.alertRules,
    prices: input.prices,
    nowMs: input.nowMs,
  });

  return {
    events: [
      ...positionsR.events,
      ...fillsR.events,
      ...fallbackEvents,
      ...cancelR.events,
      ...priceTargetR.events,
    ],
    nextPositions: positionsR.nextPositions,
    firedAlertIds: priceTargetR.firedIds,
    emittedCancelOids: cancelR.emittedOids,
    emittedFillIds: fillsR.emittedFillIds,
  };
}
