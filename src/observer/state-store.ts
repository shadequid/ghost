/**
 * Observer state store — SQLite-backed persistence for the observer loop.
 *
 * Holds the snapshot of "what the world looked like last tick" so the loop
 * can diff against it on the next tick. Without persistence, a daemon
 * restart would treat the first post-restart tick as if every open position
 * had just appeared — emitting fake events.
 *
 * Stores three logical chunks under three keys in the `observer_state`
 * table (created by migration v7). All values are JSON.
 */

import type { Database } from "bun:sqlite";

export interface PositionSnapshot {
  symbol: string;
  side: "long" | "short";
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  unrealizedPnl: number;
  margin: number;
  leverage: number;
  /** When this snapshot first saw the position non-zero. Used for hold-duration math. */
  openedAtMs: number;
  /** Highest unrealizedPnl seen for this position. */
  peakPnl: number;
  /** Lowest unrealizedPnl seen for this position. */
  troughPnl: number;
  /** True once a liquidation_risk event has fired for this position; reset on close. */
  liqRiskFired: boolean;
  /**
   * Last unrealized PnL (USDC) we ACTUALLY surfaced to the user via a
   * `pnl_snapshot`-driven proactive message. Used by the inter-tick gate in
   * `loop.ts` to silence near-identical PnL chatter. `null` means "never
   * fired" — pass-through. Reset on position close (key drops from map).
   */
  lastFiredPnl: number | null;
  /** Pct-of-margin at last fire. Paired with `lastFiredPnl`. */
  lastFiredPnlPct: number | null;
  /** Mark price at last fire. Paired with `lastFiredPnl`. */
  lastFiredMarkPrice: number | null;
  /** Wall-clock ms at last fire. Paired with `lastFiredPnl`. */
  lastFiredAtMs: number | null;
}

export interface ObserverSnapshot {
  /** Map keyed by `${symbol}|${side}`. Captures last-tick view of every position. */
  positions: Record<string, PositionSnapshot>;
  /** Latest fill timestamp (ms) we've already classified. New fills must have time > this. */
  lastFillTimestamp: number;
  /** Set of open order ids last tick — used for filter-passes-LLM open-order-change check. */
  openOrderIds: string[];
  /**
   * Wall-clock (ms) when REST sync last refreshed positions/orders/fills.
   * Drives the age-aware fetcher inside the eval loop: eval runs every
   * `tickMs` (5s) but REST polling is throttled to `syncIntervalMs` (60s).
   */
  lastRestSyncAtMs: number;
  /**
   * Recently emitted `order_canceled` event oids — dedup window for the
   * cancel detector. `getHistoricalOrders` is anchored on `lastFillTimestamp`
   * (which only advances on new fills), so without this list every sync
   * between fills would re-emit the same cancels. Bounded to
   * `RECENT_CANCEL_OIDS_CAP` newest entries; older oids drop out.
   */
  recentCancelOids: string[];
  /**
   * Recently emitted fill `tradeId`s — dedup window for the fills detector.
   * Without this, every eval tick between REST syncs re-walks the same
   * `cachedRest.newFills` array and re-emits the same `order_filled` /
   * `tp_hit` / `sl_hit` / `position_liquidated` / `position_closed` events,
   * burning ~12 LLM calls per 60s window for one already-acknowledged fill.
   * Bounded to `RECENT_FILL_IDS_CAP` newest entries.
   */
  recentEmittedFillIds: string[];
  /**
   * Recently emitted news `articleId`s — dedup window for the news detector.
   * Same shape and rationale as `recentEmittedFillIds`. Bounded to
   * `RECENT_NEWS_IDS_CAP`.
   */
  recentEmittedNewsIds: string[];
  /** Unix seconds floor for the next news query (caller applies a 30-min sliding cap when stale). */
  lastNewsScanTs: number;
}

/** Cap for the rolling `recentCancelOids` dedup window. Large enough to cover
 *  a typical bursty cancel session; small enough that the snapshot row stays
 *  cheap to JSON-encode each tick. */
export const RECENT_CANCEL_OIDS_CAP = 500;

/** Cap for the rolling `recentEmittedFillIds` dedup window. Same shape and
 *  rationale as `RECENT_CANCEL_OIDS_CAP`. */
export const RECENT_FILL_IDS_CAP = 500;

/** Cap for the rolling `recentEmittedNewsIds` dedup window. News volume
 *  (~10-30/hr peak) is lower than fills, so 200 covers many hours. */
export const RECENT_NEWS_IDS_CAP = 200;

const KEY_SNAPSHOT = "snapshot";

/**
 * Defensive-parse for `parsed.positions` so older persisted rows that
 * predate the `lastFired*` fields deserialise with explicit
 * `null` values. Without this, those positions would carry `undefined`
 * and the gate's null-checks would silently pass (which is the correct
 * behaviour — but the typed shape is cleaner if we materialise null).
 */
function normalizePositions(
  raw: Record<string, Partial<PositionSnapshot>> | undefined,
): Record<string, PositionSnapshot> {
  const out: Record<string, PositionSnapshot> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, p] of Object.entries(raw)) {
    if (!p || typeof p !== "object") continue;
    out[key] = {
      symbol: typeof p.symbol === "string" ? p.symbol : "",
      side: p.side === "short" ? "short" : "long",
      size: typeof p.size === "number" ? p.size : 0,
      entryPrice: typeof p.entryPrice === "number" ? p.entryPrice : 0,
      markPrice: typeof p.markPrice === "number" ? p.markPrice : 0,
      liquidationPrice:
        typeof p.liquidationPrice === "number" ? p.liquidationPrice : null,
      unrealizedPnl: typeof p.unrealizedPnl === "number" ? p.unrealizedPnl : 0,
      margin: typeof p.margin === "number" ? p.margin : 0,
      leverage: typeof p.leverage === "number" ? p.leverage : 1,
      openedAtMs: typeof p.openedAtMs === "number" ? p.openedAtMs : 0,
      peakPnl: typeof p.peakPnl === "number" ? p.peakPnl : 0,
      troughPnl: typeof p.troughPnl === "number" ? p.troughPnl : 0,
      liqRiskFired: p.liqRiskFired === true,
      lastFiredPnl: typeof p.lastFiredPnl === "number" ? p.lastFiredPnl : null,
      lastFiredPnlPct:
        typeof p.lastFiredPnlPct === "number" ? p.lastFiredPnlPct : null,
      lastFiredMarkPrice:
        typeof p.lastFiredMarkPrice === "number" ? p.lastFiredMarkPrice : null,
      lastFiredAtMs:
        typeof p.lastFiredAtMs === "number" ? p.lastFiredAtMs : null,
    };
  }
  return out;
}

function emptySnapshot(): ObserverSnapshot {
  return {
    positions: {},
    lastFillTimestamp: 0,
    openOrderIds: [],
    lastRestSyncAtMs: 0,
    recentCancelOids: [],
    recentEmittedFillIds: [],
    recentEmittedNewsIds: [],
    lastNewsScanTs: 0,
  };
}

export class ObserverStateStore {
  private readonly read;
  private readonly write;

  constructor(db: Database) {
    this.read = db.prepare<{ value: string }, [string]>(
      `SELECT value FROM observer_state WHERE key = ?`,
    );
    this.write = db.prepare<unknown, [string, string]>(
      `INSERT INTO observer_state (key, value, updated_at)
       VALUES (?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`,
    );
  }

  /**
   * Load the last snapshot. Returns an empty snapshot when none persisted —
   * the first tick after a fresh install diffs against this and seeds the
   * baseline. `detectPositions` will still emit `pnl_snapshot` rows for every
   * open position (its job), but those are stripped by `filterPassesLlm`
   * unless something structural also changed.
   */
  load(): ObserverSnapshot {
    const row = this.read.get(KEY_SNAPSHOT);
    if (!row) return emptySnapshot();
    try {
      const parsed = JSON.parse(row.value) as Partial<ObserverSnapshot>;
      return {
        positions: normalizePositions(parsed.positions),
        lastFillTimestamp: typeof parsed.lastFillTimestamp === "number" ? parsed.lastFillTimestamp : 0,
        openOrderIds: Array.isArray(parsed.openOrderIds) ? parsed.openOrderIds : [],
        lastRestSyncAtMs: typeof parsed.lastRestSyncAtMs === "number" ? parsed.lastRestSyncAtMs : 0,
        recentCancelOids: Array.isArray(parsed.recentCancelOids)
          ? parsed.recentCancelOids.filter((o): o is string => typeof o === "string")
          : [],
        recentEmittedFillIds: Array.isArray(parsed.recentEmittedFillIds)
          ? parsed.recentEmittedFillIds.filter((o): o is string => typeof o === "string")
          : [],
        recentEmittedNewsIds: Array.isArray(parsed.recentEmittedNewsIds)
          ? parsed.recentEmittedNewsIds.filter((o): o is string => typeof o === "string")
          : [],
        lastNewsScanTs: typeof parsed.lastNewsScanTs === "number" ? parsed.lastNewsScanTs : 0,
      };
    } catch {
      return emptySnapshot();
    }
  }

  save(snap: ObserverSnapshot): void {
    this.write.run(KEY_SNAPSHOT, JSON.stringify(snap));
  }

  /** Reset persisted state — for tests / manual recovery. */
  clear(): void {
    this.write.run(KEY_SNAPSHOT, JSON.stringify(emptySnapshot()));
  }
}
