/**
 * Fill detector — classifies each new fill row from HL trade history into
 * one of: tp_hit / sl_hit / position_liquidated / order_filled (entry) /
 * position_closed (user-initiated full close).
 *
 * Source of truth for close-style events is the fill list, not order-book
 * deltas — an order disappearing from the open list can mean cancel,
 * dedup, or partial fill, none of which are unambiguous "the trade
 * happened" signals. Fills are.
 *
 * Pure function — no I/O.
 */

import type { Fill } from "../../services/interfaces/trading-types.js";
import type {
  OrderFilledEvent,
  PositionClosedEvent,
  PositionLiquidatedEvent,
  SlHitEvent,
  TpHitEvent,
} from "../events.js";
import type { ObserverSnapshot } from "../state-store.js";

export interface FillsInput {
  fills: ReadonlyArray<Fill>;
  prior: ObserverSnapshot;
  /** Keys (`${symbol}|${side}`) of positions seen in the current tick — used to
   *  decide if a `close` fill fully flattens the position (key absent) or only
   *  reduces it (key still present). */
  currentlyOpenKeys: ReadonlySet<string>;
  /**
   * Fill `tradeId`s already emitted on a prior tick — skipped here. Without
   * this, the cached `newFills` array re-emits the same events every eval
   * tick between 60s REST syncs. Caller passes
   * `new Set(prior.recentEmittedFillIds)`.
   */
  priorEmittedFillIds: ReadonlySet<string>;
  nowMs: number;
}

export interface FillsResult {
  events: (
    | OrderFilledEvent
    | TpHitEvent
    | SlHitEvent
    | PositionLiquidatedEvent
    | PositionClosedEvent
  )[];
  /** Keys this detector emitted a close-style event for — closed-fallback
   *  detector skips these to avoid double-counting. */
  classifiedCloseKeys: Set<string>;
  /** `tradeId`s emitted this tick — caller merges into the snapshot dedup window. */
  emittedFillIds: string[];
}

type FillKind = "open" | "close" | "liquidation" | "tp" | "sl";

function posKey(symbol: string, side: "long" | "short"): string {
  return `${symbol.toUpperCase()}|${side}`;
}

function sideFromFill(fill: Fill, opening: boolean): "long" | "short" {
  // HL fill side B=buy, A=sell. For opening fills: buy→long / sell→short.
  // For closing fills, position side is the opposite of the fill side.
  if (opening) return fill.side === "buy" ? "long" : "short";
  return fill.side === "buy" ? "short" : "long";
}

/**
 * Classify a fill by inspecting HL `dir` + `liquidation`. Returns null when
 * we cannot determine the affected side — caller skips rather than guesses.
 */
function classifyFill(fill: Fill): { kind: FillKind; side: "long" | "short" | null } | null {
  const dir = (fill.dir ?? "").toLowerCase();

  if (fill.liquidation) {
    const side: "long" | "short" | null = dir.includes("long")
      ? "long"
      : dir.includes("short")
        ? "short"
        : null;
    return { kind: "liquidation", side };
  }

  if (dir.includes(" tp") || dir.endsWith("tp")) {
    const side: "long" | "short" | null = dir.includes("long")
      ? "long"
      : dir.includes("short")
        ? "short"
        : null;
    return { kind: "tp", side };
  }
  if (dir.includes(" sl") || dir.endsWith("sl")) {
    const side: "long" | "short" | null = dir.includes("long")
      ? "long"
      : dir.includes("short")
        ? "short"
        : null;
    return { kind: "sl", side };
  }

  if (dir.includes("open")) {
    return { kind: "open", side: sideFromFill(fill, true) };
  }
  if (dir.includes("close")) {
    const side: "long" | "short" | null = dir.includes("long")
      ? "long"
      : dir.includes("short")
        ? "short"
        : sideFromFill(fill, false);
    return { kind: "close", side };
  }

  // Fallback: realized PnL non-zero → fill closed something.
  if (Math.abs(fill.realizedPnl) > 0) {
    return { kind: "close", side: sideFromFill(fill, false) };
  }
  return { kind: "open", side: sideFromFill(fill, true) };
}

export function detectFills(input: FillsInput): FillsResult {
  const events: FillsResult["events"] = [];
  const classifiedCloseKeys = new Set<string>();
  const emittedFillIds: string[] = [];
  const seenThisTick = new Set<string>();

  for (const fill of input.fills) {
    // Dedup across ticks (rolling window in snapshot) and within this tick
    // (HL pagination has been known to return the same row twice on edges).
    if (input.priorEmittedFillIds.has(fill.tradeId)) continue;
    if (seenThisTick.has(fill.tradeId)) continue;
    seenThisTick.add(fill.tradeId);
    emittedFillIds.push(fill.tradeId);

    const classified = classifyFill(fill);
    if (!classified) continue;
    const { kind, side } = classified;
    if (!side && kind !== "open") continue;

    if (kind === "open") {
      events.push({
        type: "order_filled",
        detectedAt: input.nowMs,
        symbol: fill.symbol,
        side: fill.side,
        size: fill.size,
        fillPrice: fill.price,
        fillId: fill.tradeId,
      });
      continue;
    }

    const fillSide = side as "long" | "short";
    const key = posKey(fill.symbol, fillSide);
    const prior = input.prior.positions[key];

    if (kind === "liquidation") {
      events.push({
        type: "position_liquidated",
        detectedAt: input.nowMs,
        symbol: fill.symbol,
        side: fillSide,
        size: fill.size,
        entryPrice: prior?.entryPrice ?? fill.price,
        liquidationPrice: prior?.liquidationPrice ?? fill.price,
        realizedPnl: fill.realizedPnl,
        holdDurationMs: prior ? input.nowMs - prior.openedAtMs : 0,
        fillId: fill.tradeId,
      });
      classifiedCloseKeys.add(key);
      continue;
    }

    if (kind === "tp") {
      events.push({
        type: "tp_hit",
        detectedAt: input.nowMs,
        symbol: fill.symbol,
        side: fillSide,
        size: fill.size,
        exitPrice: fill.price,
        realizedPnl: fill.realizedPnl,
        fillId: fill.tradeId,
      });
      classifiedCloseKeys.add(key);
      continue;
    }

    if (kind === "sl") {
      events.push({
        type: "sl_hit",
        detectedAt: input.nowMs,
        symbol: fill.symbol,
        side: fillSide,
        size: fill.size,
        exitPrice: fill.price,
        realizedPnl: fill.realizedPnl,
        fillId: fill.tradeId,
      });
      classifiedCloseKeys.add(key);
      continue;
    }

    // kind === "close" — emit only when the position is fully flattened.
    // Partial close (position still open) has no dedicated event in v1; the
    // next pnl_snapshot reflects the smaller size.
    if (!input.currentlyOpenKeys.has(key)) {
      const realizedPnlPct = prior && prior.margin > 0
        ? (fill.realizedPnl / prior.margin) * 100
        : 0;
      events.push({
        type: "position_closed",
        detectedAt: input.nowMs,
        symbol: fill.symbol,
        side: fillSide,
        size: fill.size,
        entryPrice: prior?.entryPrice ?? fill.price,
        exitPrice: fill.price,
        realizedPnl: fill.realizedPnl,
        realizedPnlPct,
        holdDurationMs: prior ? input.nowMs - prior.openedAtMs : 0,
        fillId: fill.tradeId,
      });
      classifiedCloseKeys.add(key);
    }
  }

  return { events, classifiedCloseKeys, emittedFillIds };
}
