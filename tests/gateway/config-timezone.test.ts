import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { registerConfigMethods } from "../../src/gateway/config.js";
import { createTimezoneService } from "../../src/services/timezone.js";
import { PreferenceStore } from "../../src/services/preferences.js";
import { CronService } from "../../src/scheduler/service.js";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";
import type { Logger } from "pino";

function makeDb(): Database {
  const db = new Database(":memory:");
  // CronService and PreferenceStore need cron_jobs + settings_kv — run those migrations directly.
  for (const ver of [5, 10]) {
    const m = DB_MIGRATIONS.find((x) => x.version === ver)!;
    (m.up as (db: Database) => void)(db);
  }
  return db;
}

function silentLogger(): Logger {
  return { debug: () => {}, warn: () => {}, info: () => {}, error: () => {} } as unknown as Logger;
}

type MethodHandler = (ctx: { broadcast: (e: string, p: unknown) => void }, payload?: unknown) => Promise<unknown>;

function buildRegistry(db: Database) {
  const prefs = new PreferenceStore(db, silentLogger());
  const tzService = createTimezoneService(prefs);
  const cronService = new CronService(db);
  cronService.start({ defaults: [] });

  const handlers = new Map<string, MethodHandler>();
  registerConfigMethods(
    (method, handler) => handlers.set(method, handler as MethodHandler),
    { timezoneService: tzService, cronService },
  );

  const ctx = { broadcast: () => {} };
  const call = async (method: string, payload?: unknown) => {
    const fn = handlers.get(method);
    if (!fn) throw new Error(`Method not registered: ${method}`);
    return fn(ctx, payload);
  };

  return { call, tzService, cronService, prefs };
}

describe("config.timezone.get", () => {
  test("returns UTC when no timezone stored", async () => {
    const { call } = buildRegistry(makeDb());
    const result = await call("config.timezone.get") as { tz: string };
    expect(result.tz).toBe("UTC");
  });

  test("returns stored value after set", async () => {
    const db = makeDb();
    const { call, tzService } = buildRegistry(db);
    tzService.set("Asia/Tokyo");
    const result = await call("config.timezone.get") as { tz: string };
    expect(result.tz).toBe("Asia/Tokyo");
  });
});

describe("config.timezone.set", () => {
  test("valid timezone persists and returns ok", async () => {
    const { call } = buildRegistry(makeDb());
    const result = await call("config.timezone.set", { tz: "Asia/Tokyo" }) as { ok: boolean; tz: string; updatedJobs: string[] };
    expect(result.ok).toBe(true);
    expect(result.tz).toBe("Asia/Tokyo");
  });

  test("invalid timezone returns ok=false with error", async () => {
    const { call } = buildRegistry(makeDb());
    const result = await call("config.timezone.set", { tz: "Mars/Olympus" }) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  test("non-string input returns ok=false", async () => {
    const { call } = buildRegistry(makeDb());
    const result = await call("config.timezone.set", { tz: 42 }) as { ok: boolean };
    expect(result.ok).toBe(false);
  });

  test("set with valid TZ updates tzService.get()", async () => {
    const db = makeDb();
    const { call, tzService } = buildRegistry(db);
    await call("config.timezone.set", { tz: "America/New_York" });
    expect(tzService.get()).toBe("America/New_York");
  });

  test("set re-tags built-in jobs but not user-created jobs", async () => {
    const db = makeDb();
    const { call, cronService } = buildRegistry(db);

    // Seed the two built-in default jobs
    cronService.start({
      defaults: [
        { name: "morning-briefing", schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" }, message: "brief", deliver: true },
        { name: "evening-recap",    schedule: { kind: "cron", expr: "0 21 * * *", tz: "UTC" }, message: "recap", deliver: true },
      ],
    });

    // Add a user-created cron job
    cronService.addJob({ name: "user-alarm", schedule: { kind: "cron", expr: "0 6 * * *", tz: "UTC" }, message: "alarm" });

    const result = await call("config.timezone.set", { tz: "Asia/Singapore" }) as {
      ok: boolean; updatedJobs: string[];
    };

    expect(result.ok).toBe(true);
    expect(result.updatedJobs).toContain("morning-briefing");
    expect(result.updatedJobs).toContain("evening-recap");
    expect(result.updatedJobs).not.toContain("user-alarm");

    // Verify the user job's tz is unchanged
    const all = cronService.listJobs(true);
    const userJob = all.find((j) => j.name === "user-alarm");
    expect(userJob?.schedule.tz).toBe("UTC");

    cronService.stop();
  });

  test("set invalid does not change existing timezone", async () => {
    const db = makeDb();
    const { call, tzService } = buildRegistry(db);
    tzService.set("Asia/Tokyo");
    await call("config.timezone.set", { tz: "Not/Valid" });
    expect(tzService.get()).toBe("Asia/Tokyo");
  });
});
