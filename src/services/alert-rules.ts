/**
 * AlertRulesService — CRUD-only storage for user-entered price-target rules.
 *
 * Replaces the old AlertService, which mixed three concerns (rule storage,
 * crossing detection, fired-notification log) in a single table and a
 * single class. The split:
 *
 *   - AlertRulesService → THIS file. User rules. add/remove/list/markFired.
 *   - NotificationsService → bell-dropdown event log.
 *   - Observer detect/price-target.ts → crossing predicate (replaces the
 *     old `checkAlerts` + AlertWatcher path).
 *
 * Lifecycle (one rule):
 *   create → active → fired
 *
 * `fired_at IS NULL`     → active, evaluated every observer tick.
 * `fired_at IS NOT NULL` → consumed; observer ignores. Kept for short-term
 *                          history; archival/pruning lives outside.
 *
 * Optional EventBus dep publishes `trading.alert.set` and
 * `trading.alert.removed` so the web UI live-refreshes the alert list and
 * the gateway re-evaluates the price-feed lifecycle gate.
 */

import type { Database } from "bun:sqlite";
import type { EventBus } from "../bus/events.js";
import { TradingEvents } from "../events/trading-events.js";

export interface AlertRule {
  id: string;
  symbol: string;
  condition: "above" | "below";
  price: number;
  note?: string;
  /** Mark price captured at create time — drives the "moved X% since you set
   *  this alert" line in the UI. Null on rows pre-dating the field. */
  createdPrice?: number;
  createdAt: string;
  /** ISO timestamp when the observer detected the crossing. Undefined while active. */
  firedAt?: string;
}

export interface AddRuleOptions {
  note?: string;
  createdPrice?: number;
  /** Defaults to `crypto.randomUUID()`. Provide a deterministic id when needed. */
  id?: string;
}

export interface ListOptions {
  /** When true, includes fired rows. Default false. */
  includeFired?: boolean;
}

interface AlertRuleRow {
  id: string;
  symbol: string;
  condition: string;
  price: number;
  note: string | null;
  created_price: number | null;
  created_at: number;
  fired_at: number | null;
}

function rowToRule(r: AlertRuleRow): AlertRule {
  return {
    id: r.id,
    symbol: r.symbol,
    condition: r.condition as "above" | "below",
    price: r.price,
    note: r.note ?? undefined,
    createdPrice: r.created_price ?? undefined,
    createdAt: new Date(r.created_at * 1000).toISOString(),
    firedAt: r.fired_at === null ? undefined : new Date(r.fired_at * 1000).toISOString(),
  };
}

export class AlertRulesService {
  private readonly stmts;

  constructor(
    private readonly db: Database,
    private readonly eventBus?: EventBus,
  ) {
    this.stmts = {
      insert: db.prepare(
        `INSERT INTO alert_rules (id, symbol, condition, price, note, created_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ),
      remove: db.prepare(`DELETE FROM alert_rules WHERE id = ?`),
      get: db.prepare(
        `SELECT id, symbol, condition, price, note, created_price, created_at, fired_at
         FROM alert_rules WHERE id = ?`,
      ),
      listActive: db.prepare(
        `SELECT id, symbol, condition, price, note, created_price, created_at, fired_at
         FROM alert_rules WHERE fired_at IS NULL ORDER BY created_at DESC`,
      ),
      listAll: db.prepare(
        `SELECT id, symbol, condition, price, note, created_price, created_at, fired_at
         FROM alert_rules ORDER BY created_at DESC`,
      ),
      activeSymbols: db.prepare(
        `SELECT DISTINCT symbol FROM alert_rules WHERE fired_at IS NULL`,
      ),
      markFired: db.prepare(
        `UPDATE alert_rules SET fired_at = ? WHERE id = ? AND fired_at IS NULL`,
      ),
    };
  }

  /**
   * Insert a new active rule. Throws on duplicate `(symbol, condition, price)`
   * active triples (enforced by `ux_alert_rules_active`).
   */
  add(
    symbol: string,
    condition: "above" | "below",
    price: number,
    opts: AddRuleOptions = {},
  ): AlertRule {
    const id = opts.id ?? crypto.randomUUID();
    const upper = symbol.toUpperCase();
    try {
      this.stmts.insert.run(
        id,
        upper,
        condition,
        price,
        opts.note ?? null,
        opts.createdPrice ?? null,
      );
    } catch (err) {
      if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
        throw new Error(
          `You already have an active ${condition} alert at ${price} for ${upper}`,
        );
      }
      throw err;
    }
    const rule: AlertRule = {
      id,
      symbol: upper,
      condition,
      price,
      note: opts.note,
      createdPrice: opts.createdPrice,
      createdAt: new Date().toISOString(),
    };
    this.eventBus?.publish(
      TradingEvents.alertSet({
        id: rule.id,
        symbol: rule.symbol,
        condition: rule.condition,
        price: rule.price,
        note: rule.note,
      }),
    );
    return rule;
  }

  /** Hard-delete a rule by id. Returns false when no row matched. */
  remove(id: string): boolean {
    const row = this.stmts.get.get(id) as AlertRuleRow | undefined;
    if (!row) return false;
    const result = this.stmts.remove.run(id);
    if (result.changes === 0) return false;
    this.eventBus?.publish(
      TradingEvents.alertRemoved({ id, symbol: row.symbol }),
    );
    return true;
  }

  /** Active rules by default. `includeFired: true` returns full history. */
  list(opts?: ListOptions): AlertRule[] {
    const stmt = opts?.includeFired ? this.stmts.listAll : this.stmts.listActive;
    const rows = stmt.all() as AlertRuleRow[];
    return rows.map(rowToRule);
  }

  /**
   * Distinct symbols that have at least one active rule. Drives the
   * price-feed lifecycle gate — the WS feed stays up whenever this set is
   * non-empty so the observer's crossing eval has fresh prices.
   */
  getActiveSymbols(): Set<string> {
    const rows = this.stmts.activeSymbols.all() as Array<{ symbol: string }>;
    return new Set(rows.map((r) => r.symbol));
  }

  /**
   * Transition a single active rule to `fired`. Idempotent — second call
   * returns false. Used by the observer's price-target detect module.
   */
  markFired(id: string, firedAtUnix: number = Math.floor(Date.now() / 1000)): boolean {
    const result = this.stmts.markFired.run(firedAtUnix, id);
    return result.changes > 0;
  }
}
