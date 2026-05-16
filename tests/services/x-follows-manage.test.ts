/**
 * Tests for the multi-select / search additions to XFollowService:
 *   - setEnabled persists per-account flag + user_disabled override
 *   - search splits matches into followed vs notFollow
 *   - bulk setIncludeFollowing toggles enabled on `source = 'following'`
 *     rows while respecting individual user_disabled overrides
 *
 * The GraphQL paths (resolveUser, resolveFollowingList) are exercised via
 * monkey-patched private methods — the unit under test is the SQLite + flag
 * logic, not X's network surface.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initDatabase } from "../../src/core/database.js";
import { runDbMigrations } from "../../src/core/migrations/db.js";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";
import { XFollowService } from "../../src/services/x-follows.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import type { CredentialStore } from "../../src/config/credentials.js";
import type { XQueryIdCache } from "../../src/services/x-query-ids.js";

interface FollowedUserShape {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

/** Minimal in-memory CredentialStore stand-in. The async surface matches the
 *  real store closely enough for XFollowService's needs (get / set / has /
 *  delete) — XFollowService never calls `load()` or `save()` itself. */
function makeCredentialStore(): CredentialStore {
  const data = new Map<string, string>();
  const stub = {
    async get(key: string) { return data.get(key) ?? null; },
    async set(key: string, value: string) { data.set(key, value); },
    async has(key: string) { return data.has(key); },
    async delete(key: string) { data.delete(key); },
  };
  return stub as unknown as CredentialStore;
}

function makeQueryIds(): XQueryIdCache {
  return {
    async getQueryId() { return "test-qid"; },
    invalidate() {},
  } as unknown as XQueryIdCache;
}

interface TempDb { db: Database; dir: string }

function freshDb(): TempDb {
  const dir = mkdtempSync(join(tmpdir(), "ghost-xfollows-mgmt-"));
  const db = initDatabase(join(dir, "test.db"));
  return { db, dir };
}

async function migrate(db: Database) {
  await runDbMigrations(db, DB_MIGRATIONS);
}

describe("XFollowService — per-account enabled + source", () => {
  let temp: TempDb;
  let service: XFollowService;

  beforeEach(async () => {
    temp = freshDb();
    await migrate(temp.db);
    service = new XFollowService(temp.db, makeCredentialStore(), makeQueryIds(), NOOP_LOGGER);
  });

  afterEach(() => {
    temp.db.close();
    rmSync(temp.dir, { recursive: true, force: true });
  });

  test("list() returns enabled=true, source='manual' for legacy-shaped rows", () => {
    temp.db.run(
      "INSERT INTO x_follows (username, user_id, display_name) VALUES ('cz_binance', '1', 'CZ')",
    );
    const rows = service.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.username).toBe("cz_binance");
    expect(rows[0]!.enabled).toBe(true);
    expect(rows[0]!.source).toBe("manual");
  });

  test("setEnabled(false) mutes the row and records user_disabled=1", () => {
    temp.db.run(
      "INSERT INTO x_follows (username, source) VALUES ('vitalikbuterin', 'following')",
    );
    expect(service.setEnabled("vitalikbuterin", false)).toBe(true);
    const row = service.list()[0]!;
    expect(row.enabled).toBe(false);
    const raw = temp.db
      .query("SELECT user_disabled FROM x_follows WHERE username = 'vitalikbuterin'")
      .get() as { user_disabled: number };
    expect(raw.user_disabled).toBe(1);
  });

  test("setEnabled(true) clears user_disabled so bulk re-enable works again", () => {
    temp.db.run(
      "INSERT INTO x_follows (username, source, enabled, user_disabled) VALUES ('foo', 'following', 0, 1)",
    );
    expect(service.setEnabled("foo", true)).toBe(true);
    const raw = temp.db
      .query("SELECT enabled, user_disabled FROM x_follows WHERE username = 'foo'")
      .get() as { enabled: number; user_disabled: number };
    expect(raw.enabled).toBe(1);
    expect(raw.user_disabled).toBe(0);
  });

  test("setEnabled returns false for an unknown handle", () => {
    expect(service.setEnabled("nonexistent_handle", true)).toBe(false);
  });

  test("setEnabled strips a leading @ and lowercases the handle", () => {
    temp.db.run("INSERT INTO x_follows (username) VALUES ('lowercase_user')");
    expect(service.setEnabled("@Lowercase_User", false)).toBe(true);
    const row = service.list()[0]!;
    expect(row.enabled).toBe(false);
  });
});

describe("XFollowService.setIncludeFollowing — bulk toggle", () => {
  let temp: TempDb;
  let service: XFollowService;
  let creds: CredentialStore;

  beforeEach(async () => {
    temp = freshDb();
    await migrate(temp.db);
    creds = makeCredentialStore();
    service = new XFollowService(temp.db, creds, makeQueryIds(), NOOP_LOGGER);
  });

  afterEach(() => {
    temp.db.close();
    rmSync(temp.dir, { recursive: true, force: true });
  });

  test("bulk OFF mutes every following row but leaves manual rows alone", async () => {
    temp.db.run("INSERT INTO x_follows (username, source) VALUES ('alice', 'following')");
    temp.db.run("INSERT INTO x_follows (username, source) VALUES ('bob', 'following')");
    temp.db.run("INSERT INTO x_follows (username, source) VALUES ('manual_one', 'manual')");

    await service.setIncludeFollowing(false);

    const rows = service.list();
    const byName = new Map(rows.map((r) => [r.username, r] as const));
    expect(byName.get("alice")!.enabled).toBe(false);
    expect(byName.get("bob")!.enabled).toBe(false);
    expect(byName.get("manual_one")!.enabled).toBe(true);
  });

  test("bulk ON restores following rows, EXCEPT ones the user manually unchecked", async () => {
    temp.db.run("INSERT INTO x_follows (username, source) VALUES ('alice', 'following')");
    temp.db.run("INSERT INTO x_follows (username, source) VALUES ('bob', 'following')");

    // Bulk OFF → both go enabled=0, user_disabled untouched (still 0).
    await service.setIncludeFollowing(false);
    // User then explicitly unchecks alice while bulk is OFF — records the override.
    service.setEnabled("alice", false);
    // User re-enables bulk → bob should come back, alice should stay muted.
    await service.setIncludeFollowing(true);

    const byName = new Map(service.list().map((r) => [r.username, r] as const));
    expect(byName.get("bob")!.enabled).toBe(true);
    expect(byName.get("alice")!.enabled).toBe(false);
  });
});

describe("XFollowService.search", () => {
  let temp: TempDb;
  let service: XFollowService;
  let creds: CredentialStore;

  beforeEach(async () => {
    temp = freshDb();
    await migrate(temp.db);
    creds = makeCredentialStore();
    service = new XFollowService(temp.db, creds, makeQueryIds(), NOOP_LOGGER);
  });

  afterEach(() => {
    temp.db.close();
    rmSync(temp.dir, { recursive: true, force: true });
  });

  test("returns empty arrays for an empty query without any X call", async () => {
    const res = await service.search("   ");
    expect(res.followed).toEqual([]);
    expect(res.notFollow).toEqual([]);
  });

  test("returns notFollow=[] when X auth is missing, but still matches tracked rows", async () => {
    temp.db.run("INSERT INTO x_follows (username) VALUES ('cz_binance')");
    temp.db.run("INSERT INTO x_follows (username) VALUES ('vitalikbuterin')");

    const res = await service.search("cz");
    expect(res.followed.map((f) => f.username)).toEqual(["cz_binance"]);
    expect(res.notFollow).toEqual([]);
  });

  test("splits matches into followed + notFollow when the Following list is reachable", async () => {
    // Seed auth so the service treats us as logged-in.
    await creds.set("x_auth_token", "tok");
    await creds.set("x_ct0", "ct0");
    temp.db.run("INSERT INTO x_follows (username) VALUES ('elonmusk')");

    // Stub the private resolveFollowingList path — the unit under test is the
    // splitter, not the X parser. Cast through unknown so we can patch the
    // private method on the instance.
    (service as unknown as { resolveFollowingList: () => Promise<FollowedUserShape[]> })
      .resolveFollowingList = async () => [
        { userId: "1", username: "elonmusk", displayName: "Elon", avatarUrl: null },
        { userId: "2", username: "elonsfriend", displayName: "Friend", avatarUrl: null },
        { userId: "3", username: "vitalikbuterin", displayName: "Vitalik", avatarUrl: null },
      ];

    const res = await service.search("elon");
    expect(res.followed.map((f) => f.username)).toEqual(["elonmusk"]);
    expect(res.notFollow.map((u) => u.username)).toEqual(["elonsfriend"]);
  });

  test("strips a leading @ and is case-insensitive", async () => {
    await creds.set("x_auth_token", "tok");
    await creds.set("x_ct0", "ct0");
    temp.db.run("INSERT INTO x_follows (username) VALUES ('cz_binance')");

    (service as unknown as { resolveFollowingList: () => Promise<FollowedUserShape[]> })
      .resolveFollowingList = async () => [];

    const res = await service.search("@CZ");
    expect(res.followed.map((f) => f.username)).toEqual(["cz_binance"]);
  });

  test("returns notFollow=[] and logs when resolveFollowingList throws", async () => {
    await creds.set("x_auth_token", "tok");
    await creds.set("x_ct0", "ct0");
    temp.db.run("INSERT INTO x_follows (username) VALUES ('cz_binance')");

    (service as unknown as { resolveFollowingList: () => Promise<FollowedUserShape[]> })
      .resolveFollowingList = async () => { throw new Error("rate limited"); };

    const res = await service.search("cz");
    expect(res.followed.map((f) => f.username)).toEqual(["cz_binance"]);
    expect(res.notFollow).toEqual([]);
  });
});
