/**
 * Closed-fallback detector — emits a synthetic `position_closed` event for
 * any position that disappeared from the current snapshot WITHOUT a matching
 * fill being classified.
 *
 * This catches rare HL races where a position list update lands before the
 * matching fill row shows up in trade history. The skill still gets to react;
 * realized PnL is best-effort (last seen unrealized).
 *
 * Pure function — no I/O.
 */

import type { PositionClosedEvent } from "../events.js";
import type { ObserverSnapshot } from "../state-store.js";

export interface ClosedFallbackInput {
  prior: ObserverSnapshot;
  /** Keys (`${symbol}|${side}`) seen as open in the current tick. */
  currentlyOpenKeys: ReadonlySet<string>;
  /** Keys already classified as closed by the fills detector. */
  classifiedCloseKeys: ReadonlySet<string>;
  nowMs: number;
}

export function detectClosedFallback(input: ClosedFallbackInput): PositionClosedEvent[] {
  const events: PositionClosedEvent[] = [];

  for (const [key, prior] of Object.entries(input.prior.positions)) {
    if (input.currentlyOpenKeys.has(key)) continue;
    if (input.classifiedCloseKeys.has(key)) continue;

    events.push({
      type: "position_closed",
      detectedAt: input.nowMs,
      symbol: prior.symbol,
      side: prior.side,
      size: prior.size,
      entryPrice: prior.entryPrice,
      exitPrice: prior.markPrice,
      realizedPnl: prior.unrealizedPnl,
      realizedPnlPct: prior.margin > 0
        ? (prior.unrealizedPnl / prior.margin) * 100
        : 0,
      holdDurationMs: input.nowMs - prior.openedAtMs,
      fillId: `synthetic:${prior.symbol}:${prior.side}:${input.nowMs}`,
    });
  }

  return events;
}
