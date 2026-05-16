import { describe, test, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase } from "../../../src/core/database";
import { runDbMigrations } from "../../../src/core/migrations/db";
import { DB_MIGRATIONS } from "../../../src/core/migrations/registry";

// initDatabase lays down the baseline x_follows schema, then v9 ALTERs the
// table to add the per-account enabled flag + source marker that powers the
// "Manage follower" multi-select UX.
function freshDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), "ghost-mig-v9-"));
  return initDatabase(join(dir, "test.db"));
}

interface ColumnInfo {
  name: string;
  type: string;
  dflt_value: unknown;
  notnull: number;
}

function columnsOf(db: Database, table: string): ColumnInfo[] {
  return db.query(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

describe("migration v9 — x_follows enabled + source + user_disabled", () => {
  test("adds enabled, source, user_disabled columns after migration runs", async () => {
    const db = freshDb();
    await runDbMigrations(db, DB_MIGRATIONS);
    const cols = columnsOf(db, "x_follows");
    const names = cols.map((c) => c.name);
    expect(names).toContain("enabled");
    expect(names).toContain("source");
    expect(names).toContain("user_disabled");
  });

  test("user_version reaches at least 9 after running all migrations", async () => {
    const db = freshDb();
    await runDbMigrations(db, DB_MIGRATIONS);
    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBeGreaterThanOrEqual(9);
  });

  test("pre-migration rows are backfilled to enabled=1, source='manual', user_disabled=0", async () => {
    const db = freshDb();
    // Stop just before v9 so we can insert legacy-shaped rows.
    const upTo8 = DB_MIGRATIONS.filter((m) => m.version <= 8);
    await runDbMigrations(db, upTo8);
    db.run(
      "INSERT INTO x_follows (username, user_id, display_name) VALUES ('cz_binance', '123', 'CZ')",
    );

    await runDbMigrations(db, DB_MIGRATIONS);
    const row = db.query("SELECT enabled, source, user_disabled FROM x_follows WHERE username = 'cz_binance'").get() as
      | { enabled: number; source: string; user_disabled: number }
      | null;
    expect(row).not.toBeNull();
    expect(row!.enabled).toBe(1);
    expect(row!.source).toBe("manual");
    expect(row!.user_disabled).toBe(0);
  });

  test("source column rejects values outside the allowed set", async () => {
    const db = freshDb();
    await runDbMigrations(db, DB_MIGRATIONS);
    expect(() => {
      db.run(
        "INSERT INTO x_follows (username, source) VALUES ('bogus', 'not_a_source')",
      );
    }).toThrow();
  });
});
