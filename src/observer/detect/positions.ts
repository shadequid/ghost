/**
 * Open-position detector — emits `pnl_snapshot` and `liquidation_risk` events
 * plus the next position snapshot needed for baseline persistence.
 *
 * Two responsibilities bundled because they share the same walk over the
 * current positions list and the prior snapshot:
 *   1. One `pnl_snapshot` per open position per tick (judge always has a
 *      stake in every position it sees).
 *   2. Fire-once-per-lifecycle `liquidation_risk` event when progress from
 *      entry toward liq crosses the configured threshold. Reset on close
 *      (handled by absence of the key in `next` map).
 *
 * Liquidation math is leverage-agnostic:
 *   progress = |mark - entry| / |liq - entry|
 *
 * Pure function — no I/O, no DB writes.
 */

import type { Position } from "../../services/interfaces/trading-types.js";
import type { LiquidationRiskEvent, PnlSnapshotEvent } from "../events.js";
import type { ObserverSnapshot, PositionSnapshot } from "../state-store.js";

export interface PositionsInput {
  positions: ReadonlyArray<Position>;
  prior: ObserverSnapshot;
  liqProgressThreshold: number;
  nowMs: number;
}

export interface PositionsResult {
  events: (PnlSnapshotEvent | LiquidationRiskEvent)[];
  /** Keyed by `${symbol}|${side}`. Caller merges with other detectors' contributions. */
  nextPositions: Record<string, PositionSnapshot>;
  /** Keys this detector walked — used by the closed-fallback detector to find disappeared positions. */
  seenKeys: Set<string>;
}

function posKey(symbol: string, side: "long" | "short"): string {
  return `${symbol.toUpperCase()}|${side}`;
}

/**
 * Compute liquidation progress. Returns null when liq price is missing or
 * coincident with entry (degenerate case where progress is undefined).
 */
export function liquidationProgress(
  entry: number,
  mark: number,
  liq: number | null,
): number | null {
  if (liq === null || liq === 0) return null;
  const denom = Math.abs(liq - entry);
  if (denom === 0) return null;
  return Math.abs(mark - entry) / denom;
}

export function detectPositions(input: PositionsInput): PositionsResult {
  const events: (PnlSnapshotEvent | LiquidationRiskEvent)[] = [];
  const next: Record<string, PositionSnapshot> = {};
  const seenKeys = new Set<string>();

  for (const pos of input.positions) {
    if (pos.size === 0) continue;
    const key = posKey(pos.symbol, pos.side);
    seenKeys.add(key);
    const prior = input.prior.positions[key];

    const openedAtMs = prior?.openedAtMs ?? input.nowMs;
    const peakPnl = prior ? Math.max(prior.peakPnl, pos.unrealizedPnl) : pos.unrealizedPnl;
    const troughPnl = prior ? Math.min(prior.troughPnl, pos.unrealizedPnl) : pos.unrealizedPnl;
    let liqRiskFired = prior?.liqRiskFired ?? false;

    const priceMovePct = pos.entryPrice > 0
      ? ((pos.markPrice - pos.entryPrice) / pos.entryPrice) * 100
      : 0;
    events.push({
      type: "pnl_snapshot",
      detectedAt: input.nowMs,
      symbol: pos.symbol,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      markPrice: pos.markPrice,
      priceMovePct,
      unrealizedPnl: pos.unrealizedPnl,
      unrealizedPnlPct: pos.unrealizedPnlPct,
      margin: pos.margin,
      leverage: pos.leverage,
      holdDurationMs: input.nowMs - openedAtMs,
      peakPnl,
      troughPnl,
    });

    const progress = liquidationProgress(pos.entryPrice, pos.markPrice, pos.liquidationPrice);
    if (
      !liqRiskFired &&
      progress !== null &&
      progress >= input.liqProgressThreshold &&
      pos.liquidationPrice !== null
    ) {
      events.push({
        type: "liquidation_risk",
        detectedAt: input.nowMs,
        symbol: pos.symbol,
        side: pos.side,
        entryPrice: pos.entryPrice,
        markPrice: pos.markPrice,
        liquidationPrice: pos.liquidationPrice,
        progress,
        leverage: pos.leverage,
        margin: pos.margin,
        unrealizedPnl: pos.unrealizedPnl,
      });
      liqRiskFired = true;
    }

    next[key] = {
      symbol: pos.symbol,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      markPrice: pos.markPrice,
      liquidationPrice: pos.liquidationPrice,
      unrealizedPnl: pos.unrealizedPnl,
      margin: pos.margin,
      leverage: pos.leverage,
      openedAtMs,
      peakPnl,
      troughPnl,
      liqRiskFired,
      // Carry forward the pnl-fire dedup quad. Detector is pure;
      // the loop overwrites this entry after a judge `fire` decision tagged
      // with `primaryEventType === "pnl_snapshot"`. Reset to null on close
      // (key drops from this map naturally).
      lastFiredPnl: prior?.lastFiredPnl ?? null,
      lastFiredPnlPct: prior?.lastFiredPnlPct ?? null,
      lastFiredMarkPrice: prior?.lastFiredMarkPrice ?? null,
      lastFiredAtMs: prior?.lastFiredAtMs ?? null,
    };
  }

  return { events, nextPositions: next, seenKeys };
}
