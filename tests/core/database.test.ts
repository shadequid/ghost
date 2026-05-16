import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { initDatabase } from "../../src/core/database.js";
import { runDbMigrations } from "../../src/core/migrations/db.js";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

let tmpDir: string;
let dbPath: string;

function freshDb() {
  return initDatabase(dbPath);
}

describe("database initialization", () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-db-test-"));
    dbPath = join(tmpDir, "test.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("creates all expected tables", () => {
    const db = freshDb();
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r) => r.name);

    const expected = [
      "alerts",
      "cost_records",
      "devices",
      "gateway_sessions",
      "response_cache",
      "wallets",
      "watchlist",
    ];
    for (const name of expected) {
      expect(tables).toContain(name);
    }
    db.close();
  });

  test("creates pairing tables", () => {
    const db = freshDb();
    const tables = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    expect(tables).toContain("channel_allowlist");
    expect(tables).toContain("pairing_requests");

    const idx = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_pairing_expires'",
      )
      .all();
    expect(idx).toHaveLength(1);
    db.close();
  });

  test("enables WAL mode", () => {
    const db = freshDb();
    const result = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
    expect(result?.journal_mode).toBe("wal");
    db.close();
  });

  test("leaves user_version at 0 until migrations run", () => {
    // initDatabase no longer owns user_version — that's the migration runner.
    const db = freshDb();
    const result = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
    expect(result?.user_version).toBe(0);
    db.close();
  });

  test("runDbMigrations bumps user_version to the latest registered version", async () => {
    const db = freshDb();
    await runDbMigrations(db, DB_MIGRATIONS);
    const result = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
    const latest = DB_MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
    expect(result?.user_version).toBe(latest);
    db.close();
  });


  test("re-initializing an existing database is idempotent", () => {
    // First init
    const db1 = freshDb();
    db1.run(`INSERT INTO response_cache (cache_key, response, model) VALUES ('k1', 'resp', 'test')`);
    db1.close();

    // Second init should not wipe data
    const db2 = freshDb();
    const row = db2
      .query<{ response: string }, [string]>(
        "SELECT response FROM response_cache WHERE cache_key = ?"
      )
      .get("k1");
    expect(row?.response).toBe("resp");
    db2.close();
  });

  test("sets busy_timeout to 5000ms", () => {
    const db = freshDb();
    const result = db
      .query<{ timeout: number }, []>("PRAGMA busy_timeout")
      .get();
    expect(result?.timeout).toBe(5000);
    db.close();
  });

  test("busy_timeout absorbs SQLITE_BUSY when another writer holds the reserved lock", async () => {
    const dbInit = freshDb();
    dbInit.run("CREATE TABLE IF NOT EXISTS t (k INTEGER PRIMARY KEY)");
    dbInit.close();

    const dbB = freshDb();

    // Spawn a child process that holds an IMMEDIATE write lock for ~600ms,
    // then commits. While that lock is held, our in-process write should
    // wait via busy_timeout instead of throwing SQLITE_BUSY immediately.
    const holderScript = `
      import { Database } from "bun:sqlite";
      const db = new Database(${JSON.stringify(dbPath)});
      db.run("PRAGMA busy_timeout = 5000");
      db.run("BEGIN IMMEDIATE");
      db.run("INSERT INTO t VALUES (1)");
      process.stdout.write("LOCKED\\n");
      await new Promise((r) => setTimeout(r, 600));
      db.run("COMMIT");
      db.close();
    `;
    const holderPath = join(tmpDir, "holder.ts");
    await Bun.write(holderPath, holderScript);

    const proc = Bun.spawn(["bun", "run", holderPath], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (!buf.includes("LOCKED")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    reader.releaseLock();

    const start = Date.now();
    dbB.run("INSERT INTO t VALUES (2)");
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(elapsed).toBeLessThan(5000);

    await proc.exited;
    dbB.close();
  }, 15000);
});
