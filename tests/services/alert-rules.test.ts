import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDatabase } from "../../src/core/database.js";
import { runDbMigrations } from "../../src/core/migrations/db.js";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";
import { AlertRulesService } from "../../src/services/alert-rules.js";
import { EventBus } from "../../src/bus/events.js";
import type { Logger } from "pino";

const noopLogger: Logger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => noopLogger,
} as unknown as Logger;

async function freshDb(): Promise<Database> {
  const dir = mkdtempSync(join(tmpdir(), "ghost-alert-rules-"));
  const db = initDatabase(join(dir, "test.db"));
  await runDbMigrations(db, DB_MIGRATIONS);
  return db;
}

describe("AlertRulesService", () => {
  let db: Database;
  let svc: AlertRulesService;

  beforeEach(async () => {
    db = await freshDb();
    svc = new AlertRulesService(db);
  });

  test("add() persists and returns a fresh rule", () => {
    const rule = svc.add("BTC", "above", 70_000, { note: "tp1", createdPrice: 65_000 });
    expect(rule.symbol).toBe("BTC");
    expect(rule.condition).toBe("above");
    expect(rule.price).toBe(70_000);
    expect(rule.note).toBe("tp1");
    expect(rule.createdPrice).toBe(65_000);
    expect(rule.firedAt).toBeUndefined();
  });

  test("add() throws on duplicate active (symbol, condition, price)", () => {
    svc.add("BTC", "above", 70_000);
    expect(() => svc.add("BTC", "above", 70_000)).toThrow(/already have an active/);
  });

  test("add() allows duplicate after the first is fired (re-arm)", () => {
    const a = svc.add("BTC", "above", 70_000);
    svc.markFired(a.id);
    expect(() => svc.add("BTC", "above", 70_000)).not.toThrow();
    expect(svc.list().length).toBe(1);
  });

  test("list() returns active by default; includeFired=true includes history", () => {
    const a = svc.add("BTC", "above", 70_000);
    svc.add("ETH", "below", 3_000);
    svc.markFired(a.id);
    expect(svc.list()).toHaveLength(1);
    expect(svc.list({ includeFired: true })).toHaveLength(2);
  });

  test("remove() hard-deletes and returns false on unknown id", () => {
    const a = svc.add("BTC", "above", 70_000);
    expect(svc.remove(a.id)).toBe(true);
    expect(svc.remove(a.id)).toBe(false);
    expect(svc.list()).toHaveLength(0);
  });

  test("getActiveSymbols() returns only symbols with active rules", () => {
    svc.add("BTC", "above", 70_000);
    const eth = svc.add("ETH", "above", 4_000);
    svc.markFired(eth.id);
    expect([...svc.getActiveSymbols()].sort()).toEqual(["BTC"]);
  });

  test("markFired() is idempotent — second call returns false", () => {
    const a = svc.add("BTC", "above", 70_000);
    expect(svc.markFired(a.id)).toBe(true);
    expect(svc.markFired(a.id)).toBe(false);
  });

  test("EventBus publishes alertSet on add and alertRemoved on remove", () => {
    const bus = new EventBus(noopLogger);
    const captured: string[] = [];
    bus.subscribe((e) => captured.push(e.type));
    const s = new AlertRulesService(db, bus);
    const a = s.add("BTC", "above", 70_000);
    s.remove(a.id);
    expect(captured).toEqual(["trading.alert.set", "trading.alert.removed"]);
  });

  test("EventBus does NOT publish on markFired (observer dispatches its own chat.proactive)", () => {
    const bus = new EventBus(noopLogger);
    const captured: string[] = [];
    bus.subscribe((e) => captured.push(e.type));
    const s = new AlertRulesService(db, bus);
    const a = s.add("BTC", "above", 70_000);
    s.markFired(a.id);
    expect(captured).toEqual(["trading.alert.set"]);
  });
});
