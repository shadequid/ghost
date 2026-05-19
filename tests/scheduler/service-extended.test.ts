import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronService } from "../../src/scheduler/service.js";

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `ghost-cron-ext-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  storePath = join(tmpDir, "cron", "jobs.json");
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Cron expression parsing (TC-W41-09)
// ---------------------------------------------------------------------------

describe("CronService — cron expression parsing", () => {
  test("valid cron expression computes future nextRunAtMs", () => {
    const svc = new CronService(storePath);
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
    const svc = new CronService(storePath);
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
    const svc = new CronService(storePath);
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
// Minimum interval enforcement (TC-W41-10)
// ---------------------------------------------------------------------------

describe("CronService — minimum interval enforcement", () => {
  test("every interval below 10s is clamped to 10s", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    const now = Date.now();
    const job = svc.addJob({
      name: "fast",
      schedule: { kind: "every", everyMs: 1000 },
      message: "too fast",
    });
    // MIN_INTERVAL_MS is 10_000, so nextRun should be at least ~10s from now
    expect(job.state.nextRunAtMs).not.toBeNull();
    expect(job.state.nextRunAtMs! - now).toBeGreaterThanOrEqual(9_900); // small tolerance
    svc.stop();
  });

  test("every interval at or above 10s is respected", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    const now = Date.now();
    const job = svc.addJob({
      name: "normal",
      schedule: { kind: "every", everyMs: 30_000 },
      message: "normal speed",
    });
    expect(job.state.nextRunAtMs).not.toBeNull();
    // Should be ~30s from now, not clamped
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
    const svc = new CronService(storePath);
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
    expect(updated.state.runHistory[0].status).toBe("error");
    svc.stop();
  });

  test("runJob does nothing for disabled job without force", async () => {
    let called = false;
    const svc = new CronService(storePath);
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
    const svc = new CronService(storePath);
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
// JSON persistence details
// ---------------------------------------------------------------------------

describe("CronService — JSON persistence details", () => {
  test("store file contains version and jobs array", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    svc.addJob({ name: "persist-test", schedule: { kind: "every", everyMs: 60_000 }, message: "test" });
    svc.stop();

    const raw = readFileSync(storePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.jobs)).toBe(true);
    expect(parsed.jobs).toHaveLength(1);
    expect(parsed.jobs[0].name).toBe("persist-test");
  });

  test("external file modification detected on next loadStore", () => {
    const svc1 = new CronService(storePath);
    svc1.start({ defaults: [] });
    svc1.addJob({ name: "original", schedule: { kind: "every", everyMs: 60_000 }, message: "orig" });
    svc1.stop();

    // Simulate external modification by creating second service
    const svc2 = new CronService(storePath);
    svc2.start({ defaults: [] });
    svc2.addJob({ name: "external-add", schedule: { kind: "every", everyMs: 60_000 }, message: "ext" });
    svc2.stop();

    // Reload original store path from a new instance — should see both jobs
    const svc3 = new CronService(storePath);
    svc3.start({ defaults: [] });
    expect(svc3.listJobs()).toHaveLength(2);
    svc3.stop();
  });
});

// ---------------------------------------------------------------------------
// Status method
// ---------------------------------------------------------------------------

describe("CronService — status", () => {
  test("status returns nextWakeAtMs based on earliest job", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    svc.addJob({ name: "far", schedule: { kind: "every", everyMs: 600_000 }, message: "far" });
    svc.addJob({ name: "near", schedule: { kind: "every", everyMs: 10_000 }, message: "near" });
    const st = svc.status();
    // nextWakeAtMs should match the nearest job
    expect(st.nextWakeAtMs).not.toBeNull();
    // near job has 10s interval, far has 600s — nextWake should be close to 10s from now
    const diff = st.nextWakeAtMs! - Date.now();
    expect(diff).toBeLessThanOrEqual(11_000);
    svc.stop();
  });

  test("status with no enabled jobs returns nextWakeAtMs=null", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    const st = svc.status();
    expect(st.nextWakeAtMs).toBeNull();
    svc.stop();
  });
});

// ---------------------------------------------------------------------------
// Skip-on-miss (BUG-0150) — missed cron/at windows do NOT fire on startup
// ---------------------------------------------------------------------------

function seedStore(path: string, jobs: unknown[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, jobs }, null, 2));
}

describe("CronService — skip-on-miss", () => {
  test("cron job with past nextRunAtMs is advanced to future without firing", async () => {
    const now = Date.now();
    const pastMs = now - 60 * 60 * 1000;
    seedStore(storePath, [{
      id: "test1",
      name: "morning-recap",
      enabled: true,
      schedule: { kind: "cron", expr: "0 8 * * *" },
      payload: { kind: "agent_turn", message: "recap", deliver: true },
      state: { nextRunAtMs: pastMs, lastRunAtMs: null, lastStatus: null, lastError: null, runHistory: [] },
      createdAtMs: now - 1_000_000,
      updatedAtMs: now - 1_000_000,
      deleteAfterRun: false,
    }]);

    let fired = 0;
    const svc = new CronService(storePath);
    svc.setOnJob(async () => { fired++; return null; });
    svc.start({ defaults: [] });

    // Give the timer a tick to settle. Skip-on-miss runs synchronously inside
    // start(); fire would happen via the armed setTimeout with delay=0.
    await new Promise((r) => setTimeout(r, 10));

    const jobs = svc.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.state.nextRunAtMs).not.toBeNull();
    expect(jobs[0]!.state.nextRunAtMs!).toBeGreaterThan(now);
    expect(fired).toBe(0);
    svc.stop();
  });

  test("at job with past nextRunAtMs is dropped (nextRunAtMs becomes null) without firing", async () => {
    const now = Date.now();
    const pastMs = now - 60 * 60 * 1000;
    seedStore(storePath, [{
      id: "test2",
      name: "one-shot",
      enabled: true,
      schedule: { kind: "at", atMs: pastMs },
      payload: { kind: "agent_turn", message: "remind", deliver: true },
      state: { nextRunAtMs: pastMs, lastRunAtMs: null, lastStatus: null, lastError: null, runHistory: [] },
      createdAtMs: now - 1_000_000,
      updatedAtMs: now - 1_000_000,
      deleteAfterRun: false,
    }]);

    let fired = 0;
    const svc = new CronService(storePath);
    svc.setOnJob(async () => { fired++; return null; });
    svc.start({ defaults: [] });
    await new Promise((r) => setTimeout(r, 10));

    const jobs = svc.listJobs();
    expect(jobs[0]!.state.nextRunAtMs).toBeNull();
    expect(fired).toBe(0);
    svc.stop();
  });

  test("cron job with future nextRunAtMs is left untouched", () => {
    const now = Date.now();
    const futureMs = now + 60 * 60 * 1000;
    seedStore(storePath, [{
      id: "test3",
      name: "later",
      enabled: true,
      schedule: { kind: "cron", expr: "0 8 * * *" },
      payload: { kind: "agent_turn", message: "later", deliver: true },
      state: { nextRunAtMs: futureMs, lastRunAtMs: null, lastStatus: null, lastError: null, runHistory: [] },
      createdAtMs: now - 1_000_000,
      updatedAtMs: now - 1_000_000,
      deleteAfterRun: false,
    }]);

    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    const jobs = svc.listJobs();
    expect(jobs[0]!.state.nextRunAtMs).toBe(futureMs);
    svc.stop();
  });

  test("both built-in cron jobs (morning-briefing and evening-recap) skip on miss", async () => {
    const now = Date.now();
    const pastMs = now - 60 * 60 * 1000;
    const baseJob = (name: string, expr: string) => ({
      id: name,
      name,
      enabled: true,
      schedule: { kind: "cron", expr, tz: "UTC" },
      payload: { kind: "agent_turn", message: `${name} prompt`, deliver: true },
      state: { nextRunAtMs: pastMs, lastRunAtMs: null, lastStatus: null, lastError: null, runHistory: [] },
      createdAtMs: now - 1_000_000,
      updatedAtMs: now - 1_000_000,
      deleteAfterRun: false,
    });
    seedStore(storePath, [
      baseJob("morning-briefing", "0 8 * * *"),
      baseJob("evening-recap", "0 21 * * *"),
    ]);

    const firedNames: string[] = [];
    const svc = new CronService(storePath);
    svc.setOnJob(async (job) => { firedNames.push(job.name); return null; });
    svc.start({ defaults: [] });
    await new Promise((r) => setTimeout(r, 10));

    expect(firedNames).toEqual([]);
    const jobs = svc.listJobs();
    expect(jobs.every((j) => j.state.nextRunAtMs! > now)).toBe(true);
    svc.stop();
  });

  test("every-kind job with past nextRunAtMs is NOT skipped (legacy behavior)", async () => {
    const now = Date.now();
    const pastMs = now - 60 * 60 * 1000;
    seedStore(storePath, [{
      id: "test4",
      name: "interval",
      enabled: true,
      schedule: { kind: "every", everyMs: 30_000 },
      payload: { kind: "agent_turn", message: "interval", deliver: true },
      state: { nextRunAtMs: pastMs, lastRunAtMs: null, lastStatus: null, lastError: null, runHistory: [] },
      createdAtMs: now - 1_000_000,
      updatedAtMs: now - 1_000_000,
      deleteAfterRun: false,
    }]);

    let fired = 0;
    const svc = new CronService(storePath);
    svc.setOnJob(async () => { fired++; return null; });
    svc.start({ defaults: [] });
    // Wait long enough for the delay=0 timer to fire the missed interval.
    await new Promise((r) => setTimeout(r, 50));
    expect(fired).toBeGreaterThanOrEqual(1);
    svc.stop();
  });
});
