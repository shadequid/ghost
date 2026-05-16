import { describe, test, expect } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase } from "../../../src/core/database";
import { runDbMigrations } from "../../../src/core/migrations/db";
import { DB_MIGRATIONS } from "../../../src/core/migrations/registry";

// initDatabase lays down the baseline schema (alerts table etc.) before the
// migrations run — v4 ALTERs alerts and requires the table to exist.
function freshDb(): Database {
  const dir = mkdtempSync(join(tmpdir(), "ghost-mig-v2v3-"));
  return initDatabase(join(dir, "test.db"));
}

describe("migration v2→v3 — proactive_cooldowns lifecycle", () => {
  test("proactive_cooldowns table is absent after full migration run (v3 drops it)", async () => {
    const db = freshDb();
    await runDbMigrations(db, DB_MIGRATIONS);
    const cols = db.query("PRAGMA table_info(proactive_cooldowns)").all();
    expect(cols).toHaveLength(0);
  });

  test("idx_proactive_cooldowns_fired index is absent after full migration run", async () => {
    const db = freshDb();
    await runDbMigrations(db, DB_MIGRATIONS);
    const idx = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_proactive_cooldowns_fired'").all();
    expect(idx).toHaveLength(0);
  });

  test("user_version bumps to at least 4 after running all migrations", async () => {
    const db = freshDb();
    await runDbMigrations(db, DB_MIGRATIONS);
    const row = db.query("PRAGMA user_version").get() as { user_version: number };
    expect(row.user_version).toBeGreaterThanOrEqual(4);
  });
});
