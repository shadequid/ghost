import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initDatabase } from "../../src/core/database.js";
import { runDbMigrations } from "../../src/core/migrations/db.js";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";
import { ObserverStateStore } from "../../src/observer/state-store.js";

async function freshDb(): Promise<Database> {
  const dir = mkdtempSync(join(tmpdir(), "ghost-observer-state-"));
  const db = initDatabase(join(dir, "test.db"));
  await runDbMigrations(db, DB_MIGRATIONS);
  return db;
}

describe("ObserverStateStore", () => {
  let db: Database;
  beforeEach(async () => {
    db = await freshDb();
  });

  test("load() returns an empty snapshot on first call", () => {
    const store = new ObserverStateStore(db);
    const snap = store.load();
    expect(snap.positions).toEqual({});
    expect(snap.lastFillTimestamp).toBe(0);
    expect(snap.openOrderIds).toEqual([]);
    expect(snap.lastRestSyncAtMs).toBe(0);
    expect(snap.recentCancelOids).toEqual([]);
    expect(snap.recentEmittedFillIds).toEqual([]);
    expect(snap.recentEmittedNewsIds).toEqual([]);
    expect(snap.lastNewsScanTs).toBe(0);
  });

  test("save() / load() round-trip preserves all fields", () => {
    const store = new ObserverStateStore(db);
    store.save({
      positions: {
        "BTC|long": {
          symbol: "BTC",
          side: "long",
          size: 0.1,
          entryPrice: 70_000,
          markPrice: 71_000,
          liquidationPrice: 60_000,
          unrealizedPnl: 100,
          margin: 700,
          leverage: 10,
          openedAtMs: 1_700_000_000_000,
          peakPnl: 150,
          troughPnl: -10,
          liqRiskFired: false,
          lastFiredPnl: 80,
          lastFiredPnlPct: 11.4,
          lastFiredMarkPrice: 70_900,
          lastFiredAtMs: 1_700_000_050_000,
        },
      },
      lastFillTimestamp: 1_700_000_060_000,
      openOrderIds: ["o1", "o2"],
      lastRestSyncAtMs: 1_700_000_000_000,
      recentCancelOids: ["c1", "c2", "c3"],
      recentEmittedFillIds: ["f1", "f2"],
      recentEmittedNewsIds: ["n1", "n2", "n3"],
      lastNewsScanTs: 1_700_000_055,
    });
    const back = store.load();
    expect(back.lastFillTimestamp).toBe(1_700_000_060_000);
    expect(back.openOrderIds).toEqual(["o1", "o2"]);
    expect(back.positions["BTC|long"]?.peakPnl).toBe(150);
    expect(back.positions["BTC|long"]?.lastFiredPnl).toBe(80);
    expect(back.positions["BTC|long"]?.lastFiredPnlPct).toBe(11.4);
    expect(back.positions["BTC|long"]?.lastFiredMarkPrice).toBe(70_900);
    expect(back.positions["BTC|long"]?.lastFiredAtMs).toBe(1_700_000_050_000);
    expect(back.recentCancelOids).toEqual(["c1", "c2", "c3"]);
    expect(back.recentEmittedFillIds).toEqual(["f1", "f2"]);
    expect(back.recentEmittedNewsIds).toEqual(["n1", "n2", "n3"]);
    expect(back.lastNewsScanTs).toBe(1_700_000_055);
  });

  test("load() returns recentEmittedNewsIds default [] for legacy rows", () => {
    db.run(
      `INSERT INTO observer_state (key, value) VALUES ('snapshot', '{"recentCancelOids":["a"]}')`,
    );
    const store = new ObserverStateStore(db);
    expect(store.load().recentEmittedNewsIds).toEqual([]);
    expect(store.load().lastNewsScanTs).toBe(0);
  });

  test("load() returns recentEmittedFillIds default [] for legacy rows", () => {
    db.run(
      `INSERT INTO observer_state (key, value) VALUES ('snapshot', '{"recentCancelOids":["a"]}')`,
    );
    const store = new ObserverStateStore(db);
    expect(store.load().recentEmittedFillIds).toEqual([]);
  });

  test("load() defensively backfills lastFired* fields with null on legacy rows", () => {
    // Legacy row: no lastFiredPnl quad, just the original shape.
    db.run(
      `INSERT INTO observer_state (key, value) VALUES ('snapshot', '${JSON.stringify({
        positions: {
          "BTC|long": {
            symbol: "BTC",
            side: "long",
            size: 0.1,
            entryPrice: 70_000,
            markPrice: 71_000,
            liquidationPrice: 60_000,
            unrealizedPnl: 100,
            margin: 700,
            leverage: 10,
            openedAtMs: 1_700_000_000_000,
            peakPnl: 150,
            troughPnl: -10,
            liqRiskFired: false,
          },
        },
        lastFillTimestamp: 0,
        openOrderIds: [],
        lastRestSyncAtMs: 0,
        recentCancelOids: [],
        recentEmittedFillIds: [],
      })}')`,
    );
    const store = new ObserverStateStore(db);
    const p = store.load().positions["BTC|long"];
    expect(p?.lastFiredPnl).toBeNull();
    expect(p?.lastFiredPnlPct).toBeNull();
    expect(p?.lastFiredMarkPrice).toBeNull();
    expect(p?.lastFiredAtMs).toBeNull();
  });

  test("save() overwrites prior snapshot (single-row semantics)", () => {
    const store = new ObserverStateStore(db);
    store.save({ positions: {}, lastFillTimestamp: 100, openOrderIds: [], lastRestSyncAtMs: 0, recentCancelOids: [], recentEmittedFillIds: [], recentEmittedNewsIds: [], lastNewsScanTs: 0 });
    store.save({ positions: {}, lastFillTimestamp: 200, openOrderIds: [], lastRestSyncAtMs: 0, recentCancelOids: [], recentEmittedFillIds: [], recentEmittedNewsIds: [], lastNewsScanTs: 0 });
    expect(store.load().lastFillTimestamp).toBe(200);
  });

  test("malformed JSON → returns empty snapshot rather than throw", () => {
    db.run(`INSERT INTO observer_state (key, value) VALUES ('snapshot', 'not json')`);
    const store = new ObserverStateStore(db);
    const snap = store.load();
    expect(snap.lastFillTimestamp).toBe(0);
    expect(snap.positions).toEqual({});
  });

  test("clear() resets to empty", () => {
    const store = new ObserverStateStore(db);
    store.save({ positions: {}, lastFillTimestamp: 500, openOrderIds: ["x"], lastRestSyncAtMs: 0, recentCancelOids: ["dropMe"], recentEmittedFillIds: ["dropMe2"], recentEmittedNewsIds: ["dropMe3"], lastNewsScanTs: 999 });
    store.clear();
    const snap = store.load();
    expect(snap.lastFillTimestamp).toBe(0);
    expect(snap.openOrderIds).toEqual([]);
    expect(snap.recentCancelOids).toEqual([]);
    expect(snap.recentEmittedFillIds).toEqual([]);
    expect(snap.recentEmittedNewsIds).toEqual([]);
    expect(snap.lastNewsScanTs).toBe(0);
  });
});
