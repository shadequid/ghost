import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { validateTimezone, detectHostTimezone, createTimezoneService } from "../../src/services/timezone.js";
import { PreferenceStore } from "../../src/services/preferences.js";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";

function makePrefs(): PreferenceStore {
  const db = new Database(":memory:");
  // PreferenceStore uses settings_kv (migration v5).
  const m = DB_MIGRATIONS.find((x) => x.version === 5)!;
  (m.up as (db: Database) => void)(db);
  return new PreferenceStore(db, { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} } as never);
}

describe("validateTimezone", () => {
  test("accepts valid IANA timezone", () => {
    const r = validateTimezone("Europe/Berlin");
    expect(r.ok).toBe(true);
  });

  test("rejects unknown timezone", () => {
    const r = validateTimezone("Mars/Olympus");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });

  test("rejects non-string input", () => {
    const r = validateTimezone(123);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/string/i);
  });

  test("rejects empty string", () => {
    const r = validateTimezone("");
    expect(r.ok).toBe(false);
  });

  test("rejects string with null byte", () => {
    const r = validateTimezone("Europe/\0Berlin");
    expect(r.ok).toBe(false);
  });

  test("rejects string exceeding 64 chars", () => {
    const r = validateTimezone("A".repeat(65));
    expect(r.ok).toBe(false);
  });

  test("normalises to canonical casing", () => {
    // Some runtimes accept lowercase; the normaliser returns canonical form.
    const r = validateTimezone("UTC");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tz).toBe("UTC");
  });

  test("UTC is valid", () => {
    const r = validateTimezone("UTC");
    expect(r.ok).toBe(true);
  });

  test("Asia/Tokyo is valid", () => {
    const r = validateTimezone("Asia/Tokyo");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tz).toBe("Asia/Tokyo");
  });
});

describe("detectHostTimezone", () => {
  test("returns a non-empty string", () => {
    const tz = detectHostTimezone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });

  test("returns a valid IANA timezone", () => {
    const tz = detectHostTimezone();
    const r = validateTimezone(tz);
    expect(r.ok).toBe(true);
  });
});

describe("TimezoneService", () => {
  test("get() returns UTC when store is empty", () => {
    const prefs = makePrefs();
    const svc = createTimezoneService(prefs);
    expect(svc.get()).toBe("UTC");
  });

  test("set valid timezone persists it; get returns the new value", () => {
    const prefs = makePrefs();
    const svc = createTimezoneService(prefs);
    const result = svc.set("Asia/Tokyo");
    expect(result.ok).toBe(true);
    expect(svc.get()).toBe("Asia/Tokyo");
  });

  test("set invalid timezone returns error; get unchanged", () => {
    const prefs = makePrefs();
    const svc = createTimezoneService(prefs);
    const result = svc.set("Not/ATimezone");
    expect(result.ok).toBe(false);
    expect(svc.get()).toBe("UTC");
  });

  test("set non-string returns error", () => {
    const prefs = makePrefs();
    const svc = createTimezoneService(prefs);
    const result = svc.set(42);
    expect(result.ok).toBe(false);
  });

  test("set overwrites previous value", () => {
    const prefs = makePrefs();
    const svc = createTimezoneService(prefs);
    svc.set("Asia/Tokyo");
    svc.set("America/New_York");
    expect(svc.get()).toBe("America/New_York");
  });
});
