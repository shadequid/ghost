import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase } from "../../src/core/database";
import { runDbMigrations } from "../../src/core/migrations/db";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry";
import { PairingStore } from "../../src/pairing/store";
import { NOOP_LOGGER } from "../../src/logger.js";

function fresh(): PairingStore {
  const dir = mkdtempSync(join(tmpdir(), "ghost-pairing-test-"));
  const db = initDatabase(join(dir, "test.db"));
  runDbMigrations(db, DB_MIGRATIONS);
  // The pairing tables are created by initDatabase, not the migration framework.
  // Create them manually for these unit tests.
  db.run(`
    CREATE TABLE IF NOT EXISTS channel_allowlist (
      channel       TEXT NOT NULL,
      identity      TEXT NOT NULL,
      identity_kind TEXT NOT NULL,
      display_name  TEXT,
      added_at      INTEGER NOT NULL,
      PRIMARY KEY (channel, identity)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS pairing_requests (
      channel      TEXT NOT NULL,
      sender_id    TEXT NOT NULL,
      code         TEXT NOT NULL UNIQUE,
      username     TEXT,
      created_at   INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      expires_at   INTEGER NOT NULL,
      PRIMARY KEY (channel, sender_id)
    )
  `);
  return new PairingStore(db, NOOP_LOGGER);
}

describe("PairingStore.getPrimaryChatId", () => {
  test("returns null when no entries", () => {
    expect(fresh().getPrimaryChatId("telegram")).toBeNull();
  });

  test("returns null when only username entries (no numeric)", () => {
    const store = fresh();
    store.setAllowlist("telegram", ["alice"]);
    expect(store.getPrimaryChatId("telegram")).toBeNull();
  });

  test("returns the most recent numeric entry", () => {
    const store = fresh();
    store.setAllowlist("telegram", ["111", "222"]);
    expect(store.getPrimaryChatId("telegram")).toBe("222");
  });

  test("ignores entries from a different channel", () => {
    const store = fresh();
    store.setAllowlist("telegram", ["111"]);
    expect(store.getPrimaryChatId("discord")).toBeNull();
  });
});
