import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDatabase } from "../../src/core/database.js";
import { runDbMigrations } from "../../src/core/migrations/db.js";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";
import { NotificationsService } from "../../src/services/notifications.js";

async function freshDb(): Promise<Database> {
  const dir = mkdtempSync(join(tmpdir(), "ghost-notif-"));
  const db = initDatabase(join(dir, "test.db"));
  await runDbMigrations(db, DB_MIGRATIONS);
  return db;
}

describe("NotificationsService", () => {
  let db: Database;
  let svc: NotificationsService;

  beforeEach(async () => {
    db = await freshDb();
    svc = new NotificationsService(db);
  });

  test("insert() persists and returns the new row", () => {
    const n = svc.insert("price_target", "BTC crossed 70k", { symbol: "BTC" });
    expect(n.kind).toBe("price_target");
    expect(n.body).toBe("BTC crossed 70k");
    expect(n.symbol).toBe("BTC");
    expect(n.dismissedAt).toBeUndefined();
  });

  test("list() returns active rows newest-first", () => {
    svc.insert("price_target", "first", { tsUnix: 1_700_000_000 });
    svc.insert("liquidation_risk", "second", { tsUnix: 1_700_000_060 });
    const all = svc.list();
    expect(all[0]!.body).toBe("second");
    expect(all[1]!.body).toBe("first");
  });

  test("dismiss() flags row + excludes from active list", () => {
    const n = svc.insert("tp_hit", "BTC TP", {});
    expect(svc.list()).toHaveLength(1);
    expect(svc.dismiss(n.id)).toBe(true);
    expect(svc.list()).toHaveLength(0);
    expect(svc.list({ includeDismissed: true })).toHaveLength(1);
  });

  test("dismiss() is idempotent — second call returns false", () => {
    const n = svc.insert("tp_hit", "BTC TP", {});
    expect(svc.dismiss(n.id)).toBe(true);
    expect(svc.dismiss(n.id)).toBe(false);
  });

  test("get() returns the row by id", () => {
    const n = svc.insert("position_closed", "ETH closed +$10", { symbol: "ETH" });
    const fetched = svc.get(n.id);
    expect(fetched?.kind).toBe("position_closed");
    expect(fetched?.symbol).toBe("ETH");
  });

  test("payload round-trips through JSON serialization", () => {
    const n = svc.insert("sl_hit", "BTC SL", {
      payload: { realizedPnl: -42.5, side: "long", nested: { a: 1 } },
    });
    const fetched = svc.get(n.id);
    expect(fetched?.payload).toEqual({ realizedPnl: -42.5, side: "long", nested: { a: 1 } });
  });

  test("unknown kind in DB coerces to 'proactive' (forward-compat)", () => {
    db.run(`INSERT INTO notifications (id, kind, body, ts) VALUES ('legacy-1', 'made_up_kind', 'x', 0)`);
    const fetched = svc.get("legacy-1");
    expect(fetched?.kind).toBe("proactive");
  });

  test("list() respects limit", () => {
    for (let i = 0; i < 10; i++) svc.insert("proactive", `m${i}`, {});
    expect(svc.list({ limit: 3 })).toHaveLength(3);
  });
});
