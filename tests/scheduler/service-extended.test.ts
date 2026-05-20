import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { CronService } from "../../src/scheduler/service.js";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  // CronService only needs cron_jobs — run that migration directly.
  const m = DB_MIGRATIONS.find((x) => x.version === 10)!;
  (m.up as (db: Database) => void)(db);
  return db;
}

// ---------------------------------------------------------------------------
// Cron expression parsing
// ---------------------------------------------------------------------------

describe("CronService — cron expression parsing", () => {
  test("valid cron expression computes future nextRunAtMs", () => {
    const svc = new CronService(makeDb());
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "daily",
      schedule: { kind: "cron", expr: "0 9 * * *" },
      message: "daily report",
    });
    expect(job.state.nextRunAtMs).not.toBeNull();
    expect(job.state.nextRunAtMs!).toBeGreaterThan(Date.now());
    svc.stop();
  });

  test("invalid cron expression results in null nextRunAtMs", () => {
    const svc = new CronService(makeDb());
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "bad-cron",
      schedule: { kind: "cron", expr: "not-a-valid-cron" },
      message: "will fail",
    });
    expect(job.state.nextRunAtMs).toBeNull();
    svc.stop();
  });

  test("cron expression with timezone", () => {
    const svc = new CronService(makeDb());
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "tz-cron",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "America/New_York" },
      message: "tz report",
    });
    expect(job.state.nextRunAtMs).not.toBeNull();
    expect(job.state.nextRunAtMs!).toBeGreaterThan(Date.now());
    svc.stop();
  });
});

// ---------------------------------------------------------------------------
// Minimum interval enforcement
// ---------------------------------------------------------------------------

describe("CronService — minimum interval enforcement", () => {
  test("every interval below 10s is clamped to 10s", () => {
    const svc = new CronService(makeDb());
    svc.start({ defaults: [] });
    const now = Date.now();
    const job = svc.addJob({
      name: "fast",
      schedule: { kind: "every", everyMs: 1000 },
      message: "too fast",
    });
    expect(job.state.nextRunAtMs).not.toBeNull();
    expect(job.state.nextRunAtMs! - now).toBeGreaterThanOrEqual(9_900);
    svc.stop();
  });

  test("every interval at or above 10s is respected", () => {
    const svc = new CronService(makeDb());
    svc.start({ defaults: [] });
    const now = Date.now();
    const job = svc.addJob({
      name: "normal",
      schedule: { kind: "every", everyMs: 30_000 },
      message: "normal speed",
    });
    expect(job.state.nextRunAtMs).not.toBeNull();
    const diff = job.state.nextRunAtMs! - now;
    expect(diff).toBeGreaterThanOrEqual(29_000);
    expect(diff).toBeLessThanOrEqual(31_000);
    svc.stop();
  });
});

// ---------------------------------------------------------------------------
// Error handling in executeJob
// ---------------------------------------------------------------------------

describe("CronService — error handling", () => {
  test("runJob records error on callback failure", async () => {
    const svc = new CronService(makeDb());
    svc.setOnJob(async () => {
      throw new Error("callback failed");
    });
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "fail",
      schedule: { kind: "every", everyMs: 60_000 },
      message: "will fail",
    });
    await svc.runJob(job.id, true);
    const updated = svc.getJob(job.id)!;
    expect(updated.state.lastStatus).toBe("error");
    expect(updated.state.lastError).toBe("callback failed");
    expect(updated.state.runHistory).toHaveLength(1);
    expect(updated.state.runHistory[0]!.status).toBe("error");
    svc.stop();
  });

  test("runJob does nothing for disabled job without force", async () => {
    let called = false;
    const svc = new CronService(makeDb());
    svc.setOnJob(async () => { called = true; return null; });
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "disabled",
      schedule: { kind: "every", everyMs: 60_000 },
      message: "disabled",
    });
    svc.enableJob(job.id, false);
    await svc.runJob(job.id);
    expect(called).toBe(false);
    svc.stop();
  });

  test("runJob with force=true runs disabled job", async () => {
    let called = false;
    const svc = new CronService(makeDb());
    svc.setOnJob(async () => { called = true; return null; });
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "force-run",
      schedule: { kind: "every", everyMs: 60_000 },
      message: "force",
    });
    svc.enableJob(job.id, false);
    await svc.runJob(job.id, true);
    expect(called).toBe(true);
    svc.stop();
  });
});

// ---------------------------------------------------------------------------
// Status method
// ---------------------------------------------------------------------------

describe("CronService — status", () => {
  test("status returns nextTickAtMs based on earliest job", () => {
    const svc = new CronService(makeDb());
    svc.start({ defaults: [] });
    svc.addJob({ name: "far", schedule: { kind: "every", everyMs: 600_000 }, message: "far" });
    svc.addJob({ name: "near", schedule: { kind: "every", everyMs: 10_000 }, message: "near" });
    const st = svc.status();
    expect(st.nextTickAtMs).not.toBeNull();
    const diff = st.nextTickAtMs! - Date.now();
    expect(diff).toBeLessThanOrEqual(11_000);
    svc.stop();
  });

  test("status with no enabled jobs returns nextTickAtMs=null", () => {
    const svc = new CronService(makeDb());
    svc.start({ defaults: [] });
    const st = svc.status();
    expect(st.nextTickAtMs).toBeNull();
    svc.stop();
  });
});

// ---------------------------------------------------------------------------
// Skip-on-miss — missed cron/at windows do NOT fire on startup
// ---------------------------------------------------------------------------

describe("CronService — skip-on-miss", () => {
  test("cron job with past nextRunAtMs is advanced to future without firing", async () => {
    const db = makeDb();
    const now = Date.now();
    const pastMs = now - 60 * 60 * 1000;

    // Pre-insert a cron job with a past nextRunAtMs
    const svc0 = new CronService(db);
    svc0.start({ defaults: [] });
    const job = svc0.addJob({
      name: "morning-recap",
      schedule: { kind: "cron", expr: "0 8 * * *" },
      message: "recap",
    });
    // Backdate nextRunAtMs
    db.run("UPDATE cron_jobs SET next_run_at_ms = ? WHERE id = ?", [pastMs, job.id]);
    svc0.stop();

    let fired = 0;
    const svc = new CronService(db);
    svc.setOnJob(async () => { fired++; return null; });
    svc.start({ defaults: [] });

    await new Promise((r) => setTimeout(r, 10));

    const jobs = svc.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.state.nextRunAtMs).not.toBeNull();
    expect(jobs[0]!.state.nextRunAtMs!).toBeGreaterThan(now);
    expect(fired).toBe(0);
    svc.stop();
  });

  test("at job with past nextRunAtMs becomes null without firing", async () => {
    const db = makeDb();
    const now = Date.now();
    const pastMs = now - 60 * 60 * 1000;

    const svc0 = new CronService(db);
    svc0.start({ defaults: [] });
    const job = svc0.addJob({
      name: "one-shot",
      schedule: { kind: "at", atMs: pastMs },
      message: "remind",
    });
    db.run("UPDATE cron_jobs SET next_run_at_ms = ? WHERE id = ?", [pastMs, job.id]);
    svc0.stop();

    let fired = 0;
    const svc = new CronService(db);
    svc.setOnJob(async () => { fired++; return null; });
    svc.start({ defaults: [] });
    await new Promise((r) => setTimeout(r, 10));

    const jobs = svc.listJobs(true);
    expect(jobs[0]!.state.nextRunAtMs).toBeNull();
    expect(fired).toBe(0);
    svc.stop();
  });

  test("cron job with future nextRunAtMs is left untouched", () => {
    const db = makeDb();
    const now = Date.now();
    const futureMs = now + 60 * 60 * 1000;

    const svc0 = new CronService(db);
    svc0.start({ defaults: [] });
    const job = svc0.addJob({
      name: "later",
      schedule: { kind: "cron", expr: "0 8 * * *" },
      message: "later",
    });
    db.run("UPDATE cron_jobs SET next_run_at_ms = ? WHERE id = ?", [futureMs, job.id]);
    svc0.stop();

    const svc = new CronService(db);
    svc.start({ defaults: [] });
    const jobs = svc.listJobs();
    expect(jobs[0]!.state.nextRunAtMs).toBe(futureMs);
    svc.stop();
  });

  test("every-kind job with past nextRunAtMs is advanced (bug fix: no immediate fire)", async () => {
    const db = makeDb();
    const now = Date.now();
    const pastMs = now - 60 * 60 * 1000;

    const svc0 = new CronService(db);
    svc0.start({ defaults: [] });
    const job = svc0.addJob({
      name: "interval",
      schedule: { kind: "every", everyMs: 30_000 },
      message: "interval",
    });
    db.run("UPDATE cron_jobs SET next_run_at_ms = ? WHERE id = ?", [pastMs, job.id]);
    svc0.stop();

    let fired = 0;
    const svc = new CronService(db);
    svc.setOnJob(async () => { fired++; return null; });
    svc.start({ defaults: [] });
    await new Promise((r) => setTimeout(r, 50));

    // After the fix, every-kind overdue jobs are advanced to now+everyMs, not fired immediately.
    expect(fired).toBe(0);
    const reloaded = svc.getJob(job.id)!;
    expect(reloaded.state.nextRunAtMs!).toBeGreaterThan(now);
    svc.stop();
  });
});
