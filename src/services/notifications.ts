/**
 * NotificationsService — fired-event log that powers the bell-dropdown.
 *
 * One row per dispatched proactive notification (judge.fire + notify=true).
 * Survives daemon restarts so the user opens the dropdown after a reboot
 * and sees recent badges.
 *
 * Schema separation from `alert_rules`:
 *   - alert_rules: "user wants to be told when BTC ≥ 80k" (CONFIG)
 *   - notifications: "BTC crossed 80k at 14:23 UTC, here's the line we
 *     showed them" (EVENT LOG)
 *
 * These have different lifecycles, different readers, different update
 * patterns — the legacy `alerts` table conflated them and the schema rot
 * showed up as `condition: "below"` / `price: 0` sentinels on non-price
 * kinds.
 */

import type { Database } from "bun:sqlite";

/**
 * Notification kind discriminator. Drives renderer selection (bell-dropdown
 * icon, color, click action). Add new kinds here as the observer grows
 * new event types — keep the union closed so callers can exhaustive-match.
 */
export type NotificationKind =
  | "price_target"           // user-set rule crossed
  | "liquidation_risk"       // observer detected progress ≥ threshold
  | "position_closed"
  | "tp_hit"
  | "sl_hit"
  | "order_filled"
  | "order_canceled"
  | "proactive";             // generic observer chatter, no specific kind

export interface Notification {
  id: string;
  kind: NotificationKind;
  symbol?: string;
  body: string;
  payload?: Record<string, unknown>;
  ts: string;
  dismissedAt?: string;
}

export interface InsertOptions {
  /** Optional deterministic id (defaults to crypto.randomUUID()). */
  id?: string;
  symbol?: string;
  payload?: Record<string, unknown>;
  /** Unix seconds for the event timestamp. Defaults to now. */
  tsUnix?: number;
}

export interface ListOptions {
  /** When true, includes dismissed rows. Default false. */
  includeDismissed?: boolean;
  /** Max rows. Default 100. */
  limit?: number;
}

interface NotificationRow {
  id: string;
  kind: string;
  symbol: string | null;
  body: string;
  payload: string | null;
  ts: number;
  dismissed_at: number | null;
}

function isKind(raw: string): raw is NotificationKind {
  return (
    raw === "price_target" ||
    raw === "liquidation_risk" ||
    raw === "position_closed" ||
    raw === "tp_hit" ||
    raw === "sl_hit" ||
    raw === "order_filled" ||
    raw === "order_canceled" ||
    raw === "proactive"
  );
}

function rowToNotification(r: NotificationRow): Notification {
  let payload: Record<string, unknown> | undefined;
  if (r.payload) {
    try { payload = JSON.parse(r.payload) as Record<string, unknown>; } catch { /* ignore */ }
  }
  return {
    id: r.id,
    kind: isKind(r.kind) ? r.kind : "proactive",
    symbol: r.symbol ?? undefined,
    body: r.body,
    payload,
    ts: new Date(r.ts * 1000).toISOString(),
    dismissedAt: r.dismissed_at === null ? undefined : new Date(r.dismissed_at * 1000).toISOString(),
  };
}

export class NotificationsService {
  private readonly stmts;

  constructor(private readonly db: Database) {
    this.stmts = {
      insert: db.prepare(
        `INSERT INTO notifications (id, kind, symbol, body, payload, ts) VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      dismiss: db.prepare(
        `UPDATE notifications SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL`,
      ),
      listActive: db.prepare(
        `SELECT id, kind, symbol, body, payload, ts, dismissed_at
         FROM notifications WHERE dismissed_at IS NULL
         ORDER BY ts DESC LIMIT ?`,
      ),
      listAll: db.prepare(
        `SELECT id, kind, symbol, body, payload, ts, dismissed_at
         FROM notifications ORDER BY ts DESC LIMIT ?`,
      ),
      get: db.prepare(
        `SELECT id, kind, symbol, body, payload, ts, dismissed_at
         FROM notifications WHERE id = ?`,
      ),
    };
  }

  /**
   * Append a fired notification. Called from the observer's dispatch path
   * when the judge returns `notify: true`.
   */
  insert(kind: NotificationKind, body: string, opts: InsertOptions = {}): Notification {
    const id = opts.id ?? crypto.randomUUID();
    const tsUnix = opts.tsUnix ?? Math.floor(Date.now() / 1000);
    const payloadStr = opts.payload ? JSON.stringify(opts.payload) : null;
    this.stmts.insert.run(id, kind, opts.symbol ?? null, body, payloadStr, tsUnix);
    return {
      id,
      kind,
      symbol: opts.symbol,
      body,
      payload: opts.payload,
      ts: new Date(tsUnix * 1000).toISOString(),
    };
  }

  /**
   * Mark a notification dismissed (× on the bell-dropdown row). Idempotent —
   * second call returns false. The row stays in the table; pruning happens
   * outside.
   */
  dismiss(id: string, dismissedAtUnix: number = Math.floor(Date.now() / 1000)): boolean {
    const result = this.stmts.dismiss.run(dismissedAtUnix, id);
    return result.changes > 0;
  }

  /** Active (not dismissed) by default. `includeDismissed: true` for history. */
  list(opts: ListOptions = {}): Notification[] {
    const limit = opts.limit ?? 100;
    const stmt = opts.includeDismissed ? this.stmts.listAll : this.stmts.listActive;
    const rows = stmt.all(limit) as NotificationRow[];
    return rows.map(rowToNotification);
  }

  get(id: string): Notification | undefined {
    const row = this.stmts.get.get(id) as NotificationRow | undefined;
    return row ? rowToNotification(row) : undefined;
  }
}
