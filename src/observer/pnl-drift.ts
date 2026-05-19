/**
 * Portfolio-level PnL drift detector.
 *
 * Wakes the event-judge when the account's total unrealized PnL has moved
 * materially while the user has been idle for hours. Exists because the
 * per-position `pnl_snapshot` floor (price-pct + per-position cooldown) is
 * deliberately conservative to avoid spam during active trading, which means
 * it under-fires for the "user is away from chat, account drifts $20+" case.
 *
 * Pure decision helper — `ObserverLoop` owns the state and the event emission.
 */
import type { PortfolioPnlDriftEvent } from "./events.js";

/** Minimum |Δ| (fraction) vs prior baseline before we even consider firing. */
export const PNL_DRIFT_THRESHOLD_PCT = 0.15;

/** User must have been silent for at least this long. */
export const PNL_DRIFT_IDLE_GATE_MS = 2 * 60 * 60 * 1000;

/** Don't re-fire drift events more often than this. */
export const PNL_DRIFT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Floor on the denominator so near-zero baselines don't produce huge pct
 * deltas from rounding-scale moves. 10 USDC matches the minimum trade size
 * users realistically open with.
 */
export const PNL_DRIFT_MIN_BASE = 10;

/**
 * Idle sentinel for `idleMs` when the user has never chatted in this session.
 * Must be finite (JSON-serialisable) yet large enough that downstream
 * consumers reading the event payload unambiguously treat it as "maximally
 * idle" rather than "active". One week is well past every product cooldown
 * we care about.
 */
const SENTINEL_MAX_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PnlDriftState {
  /** Account total unrealized PnL at the last drift evaluation. */
  lastSnapshotPnl: number | null;
  /** Wall-clock ms of the last drift event we emitted. */
  lastSentAtMs: number | null;
}

export type PnlDriftDecision =
  | { fire: false; nextSnapshotPnl: number; reason: string }
  | { fire: true; event: PortfolioPnlDriftEvent; nextSnapshotPnl: number };

export interface PnlDriftInput {
  state: PnlDriftState;
  /** Current account unrealized PnL summed across all open positions. */
  currentPnl: number;
  /** Wall-clock ms of the most recent user message, or null if never. */
  lastUserActivityMs: number | null;
  nowMs: number;
}

/**
 * Decide whether to emit a `portfolio_pnl_drift` event this tick.
 *
 * State machine:
 *   1. First call: seed baseline, do not fire.
 *   2. Subsequent: fire iff |Δpct| ≥ threshold AND idle ≥ gate AND cooldown elapsed.
 *
 * `nextSnapshotPnl` advances to `currentPnl` on the seed call AND on fire. In
 * the suppressed branches (below_threshold, user_active, cooldown) it mirrors
 * `state.lastSnapshotPnl` so accumulated drift can still trip the gate on a
 * later tick. The caller is responsible for stashing `nextSnapshotPnl` and
 * `lastSentAtMs` back into `PnlDriftState`.
 */
export function decidePnlDrift(input: PnlDriftInput): PnlDriftDecision {
  const { state, currentPnl, lastUserActivityMs, nowMs } = input;

  if (state.lastSnapshotPnl === null) {
    return { fire: false, nextSnapshotPnl: currentPnl, reason: "seed_baseline" };
  }

  const base = Math.max(Math.abs(state.lastSnapshotPnl), PNL_DRIFT_MIN_BASE);
  const deltaPct = (currentPnl - state.lastSnapshotPnl) / base;
  const absDeltaPct = Math.abs(deltaPct);

  if (absDeltaPct < PNL_DRIFT_THRESHOLD_PCT) {
    return { fire: false, nextSnapshotPnl: state.lastSnapshotPnl, reason: "below_threshold" };
  }

  const idleMs = lastUserActivityMs === null
    ? SENTINEL_MAX_IDLE_MS
    : nowMs - lastUserActivityMs;
  if (idleMs < PNL_DRIFT_IDLE_GATE_MS) {
    return { fire: false, nextSnapshotPnl: state.lastSnapshotPnl, reason: "user_active" };
  }

  if (state.lastSentAtMs !== null && nowMs - state.lastSentAtMs < PNL_DRIFT_COOLDOWN_MS) {
    return { fire: false, nextSnapshotPnl: state.lastSnapshotPnl, reason: "cooldown" };
  }

  const event: PortfolioPnlDriftEvent = {
    type: "portfolio_pnl_drift",
    detectedAt: nowMs,
    fromPnl: state.lastSnapshotPnl,
    toPnl: currentPnl,
    deltaPct,
    idleMs,
  };
  return { fire: true, event, nextSnapshotPnl: currentPnl };
}
