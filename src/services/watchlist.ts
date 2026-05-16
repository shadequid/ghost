/**
 * Watchlist service — SQLite-backed symbol watchlist.
 *
 * Watchlist and alerts are fully independent: add/remove on either
 * surface does not touch the other.
 */

import type { Database } from "bun:sqlite";

export interface WatchlistItem {
  symbol: string;
  addedAt: string;
  notes?: string;
}

export interface RemoveResult {
  removed: boolean;
}

export const DEFAULT_WATCHLIST = ["BTC", "ETH", "HYPE"] as const;

export class WatchlistService {
  private readonly stmts;
  private readonly _changeListeners = new Set<(action: "add" | "remove", symbol: string) => void>();

  onChanged(fn: (action: "add" | "remove", symbol: string) => void) {
    this._changeListeners.add(fn);
  }

  constructor(private readonly db: Database) {
    this.stmts = {
      upsert: db.prepare(`INSERT INTO watchlist (symbol, notes) VALUES (?, ?)
        ON CONFLICT(symbol) DO UPDATE SET notes = COALESCE(excluded.notes, watchlist.notes)`),
      remove: db.prepare(`DELETE FROM watchlist WHERE symbol = ?`),
      list: db.prepare(`SELECT symbol, notes, added_at FROM watchlist ORDER BY added_at DESC`),
      get: db.prepare(`SELECT symbol, notes, added_at FROM watchlist WHERE symbol = ?`),
      count: db.prepare(`SELECT COUNT(*) as cnt FROM watchlist`),
    };
    this.seedDefaults();
  }

  private seedDefaults() {
    const { cnt } = this.stmts.count.get() as { cnt: number };
    if (cnt > 0) return;
    for (const sym of DEFAULT_WATCHLIST) {
      this.stmts.upsert.run(sym, null);
    }
  }

  has(symbol: string): boolean {
    // Symbols stored in canonical form — exact match (case-sensitive by design).
    // HIP-3 symbols like "xyz:AAPL" must NOT be uppercased here.
    return !!this.stmts.get.get(symbol);
  }

  add(symbol: string, notes?: string): WatchlistItem {
    // symbol must already be in canonical form (resolveSymbol applied by caller).
    if (this.has(symbol)) throw new Error(`${symbol} is already in your watchlist`);
    this.stmts.upsert.run(symbol, notes ?? null);
    const row = this.stmts.get.get(symbol) as { symbol: string; notes: string | null; added_at: number } | undefined;
    for (const fn of this._changeListeners) fn("add", symbol);
    return {
      symbol,
      addedAt: row ? new Date(row.added_at * 1000).toISOString() : new Date().toISOString(),
      notes: row?.notes ?? notes,
    };
  }

  remove(symbol: string): RemoveResult {
    // symbol must already be in canonical form (resolveSymbol applied by caller).
    const result = this.stmts.remove.run(symbol);
    const removed = result.changes > 0;
    if (removed) for (const fn of this._changeListeners) fn("remove", symbol);
    return { removed };
  }

  list(): WatchlistItem[] {
    const rows = this.stmts.list.all() as Array<{ symbol: string; notes: string | null; added_at: number }>;
    return rows.map((r) => ({
      symbol: r.symbol,
      addedAt: new Date(r.added_at * 1000).toISOString(),
      notes: r.notes ?? undefined,
    }));
  }
}
