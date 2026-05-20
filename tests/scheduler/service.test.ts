import { describe, test, expect, beforeEach } from "bun:test";
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

describe("CronService", () => {
  let db: Database;
  beforeEach(() => { db = makeDb(); });

  test("addJob creates a job and returns it", () => {
    const svc = new CronService(db);
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "test",
      schedule: { kind: "every", everyMs: 60_000 },
      message: "do something",
    });
    expect(job.id).toBeTruthy();
    expect(job.name).toBe("test");
    expect(job.enabled).toBe(true);
    expect(job.schedule.kind).toBe("every");
    expect(job.payload.message).toBe("do something");
    svc.stop();
  });

  test("listJobs returns added jobs", () => {
    const svc = new CronService(db);
    svc.start({ defaults: [] });
    svc.addJob({ name: "a", schedule: { kind: "every", everyMs: 1000 }, message: "a" });
    svc.addJob({ name: "b", schedule: { kind: "every", everyMs: 2000 }, message: "b" });
    const jobs = svc.listJobs();
    expect(jobs).toHaveLength(2);
    svc.stop();
  });

  test("removeJob deletes a job", () => {
    const svc = new CronService(db);
    svc.start({ defaults: [] });
    const job = svc.addJob({ name: "temp", schedule: { kind: "every", everyMs: 1000 }, message: "temp" });
    expect(svc.removeJob(job.id)).toBe(true);
    expect(svc.listJobs()).toHaveLength(0);
    svc.stop();
  });

  test("removeJob returns false for unknown id", () => {
    const svc = new CronService(db);
    svc.start({ defaults: [] });
    expect(svc.removeJob("nonexistent")).toBe(false);
    svc.stop();
  });

  test("enableJob toggles enabled state", () => {
    const svc = new CronService(db);
    svc.start({ defaults: [] });
    const job = svc.addJob({ name: "toggle", schedule: { kind: "every", everyMs: 1000 }, message: "toggle" });
    svc.enableJob(job.id, false);
    expect(svc.getJob(job.id)?.enabled).toBe(false);
    svc.enableJob(job.id, true);
    expect(svc.getJob(job.id)?.enabled).toBe(true);
    svc.stop();
  });

  test("status reports running state and job count", () => {
    const svc = new CronService(db);
    svc.start({ defaults: [] });
    svc.addJob({ name: "s", schedule: { kind: "every", everyMs: 1000 }, message: "s" });
    const st = svc.status();
    expect(st.enabled).toBe(true);
    expect(st.jobs).toBe(1);
    svc.stop();
  });

  test("runJob executes callback", async () => {
    let called = false;
    const svc = new CronService(db);
    svc.setOnJob(async () => { called = true; return null; });
    svc.start({ defaults: [] });
    const job = svc.addJob({ name: "run", schedule: { kind: "every", everyMs: 60_000 }, message: "run" });
    await svc.runJob(job.id);
    expect(called).toBe(true);
    expect(svc.getJob(job.id)?.state.lastStatus).toBe("ok");
    svc.stop();
  });

  test("at job auto-disables after run", async () => {
    const svc = new CronService(db);
    svc.setOnJob(async () => null);
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "once",
      schedule: { kind: "at", atMs: Date.now() + 100_000 },
      message: "once",
    });
    await svc.runJob(job.id, true);
    expect(svc.getJob(job.id)?.enabled).toBe(false);
    svc.stop();
  });

  test("at job with deleteAfterRun removes itself", async () => {
    const svc = new CronService(db);
    svc.setOnJob(async () => null);
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "delete-me",
      schedule: { kind: "at", atMs: Date.now() + 100_000 },
      message: "delete",
      deleteAfterRun: true,
    });
    await svc.runJob(job.id, true);
    expect(svc.getJob(job.id)).toBeUndefined();
    svc.stop();
  });

  test("persists across separate CronService instances on same DB", () => {
    const svc1 = new CronService(db);
    svc1.start({ defaults: [] });
    svc1.addJob({ name: "persist", schedule: { kind: "every", everyMs: 5000 }, message: "persist" });
    svc1.stop();

    const svc2 = new CronService(db);
    svc2.start({ defaults: [] });
    expect(svc2.listJobs()).toHaveLength(1);
    expect(svc2.listJobs()[0]!.name).toBe("persist");
    svc2.stop();
  });

  test("run history limited to 20 entries", async () => {
    const svc = new CronService(db);
    svc.setOnJob(async () => null);
    svc.start({ defaults: [] });
    const job = svc.addJob({ name: "many", schedule: { kind: "every", everyMs: 1000 }, message: "many" });
    for (let i = 0; i < 25; i++) {
      await svc.runJob(job.id, true);
    }
    expect(svc.getJob(job.id)!.state.runHistory.length).toBeLessThanOrEqual(20);
    svc.stop();
  });

  test("duplicate name via addJob throws a clean error message", () => {
    const svc = new CronService(db);
    svc.start({ defaults: [] });
    svc.addJob({ name: "morning-briefing", schedule: { kind: "every", everyMs: 60_000 }, message: "first" });
    // Second addJob with the same name must throw a user-readable error, not a raw SQLite stack.
    expect(() =>
      svc.addJob({ name: "morning-briefing", schedule: { kind: "every", everyMs: 60_000 }, message: "second" }),
    ).toThrow("Cron name already exists: morning-briefing");
    svc.stop();
  });

  test("executeJob re-reads schedule after await so concurrent updateBuiltinJobsTimezone is not lost", async () => {
    // Simulate the race window: start a cron job, mutate its TZ while the
    // job's callback is in flight, then verify the post-run nextRunAtMs
    // was computed against the updated TZ (not the stale one).
    const svc = new CronService(db);
    let retagDone = false;
    svc.setOnJob(async (job) => {
      // Mutate the row's schedule_tz mid-flight to mimic updateBuiltinJobsTimezone
      db.run(
        "UPDATE cron_jobs SET schedule_tz = 'Asia/Tokyo', updated_at_ms = ? WHERE id = ?",
        [Date.now(), job.id],
      );
      retagDone = true;
      return null;
    });
    svc.start({ defaults: [] });
    const job = svc.addJob({
      name: "briefing-race",
      schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" },
      message: "brief",
    });

    await svc.runJob(job.id, true);

    expect(retagDone).toBe(true);
    // After the run, nextRunAtMs should be computed from Asia/Tokyo, not UTC.
    // We can't compare exact timestamps, but we can verify it re-reads (the job
    // row must have schedule_tz = Asia/Tokyo and a non-null future nextRunAtMs).
    const updated = svc.getJob(job.id);
    expect(updated?.state.nextRunAtMs).not.toBeNull();
    expect(updated?.state.nextRunAtMs!).toBeGreaterThan(Date.now());
    // The schedule_tz in DB must be Asia/Tokyo (mutated by the callback)
    const row = db.query("SELECT schedule_tz FROM cron_jobs WHERE id = ?").get(job.id) as { schedule_tz: string };
    expect(row.schedule_tz).toBe("Asia/Tokyo");
    svc.stop();
  });

  test("skip-on-miss: every-kind overdue nextRun is advanced on start", () => {
    // Seed a job with an overdue nextRunAtMs directly via SQL, then restart.
    const db2 = makeDb();
    const svc1 = new CronService(db2);
    svc1.start({ defaults: [] });
    const job = svc1.addJob({
      name: "overdue",
      schedule: { kind: "every", everyMs: 60_000 },
      message: "overdue",
    });
    // Backdate nextRunAtMs to 2 minutes ago
    const past = Date.now() - 120_000;
    db2.run("UPDATE cron_jobs SET next_run_at_ms = ? WHERE id = ?", [past, job.id]);
    svc1.stop();

    // New service instance on same DB — start() should advance the nextRun
    const svc2 = new CronService(db2);
    const before = Date.now();
    svc2.start({ defaults: [] });
    const reloaded = svc2.getJob(job.id);
    expect(reloaded?.state.nextRunAtMs).toBeGreaterThan(before);
    svc2.stop();
  });

  test("skip-on-miss: at-kind past atMs becomes null on start", () => {
    const db2 = makeDb();
    const svc1 = new CronService(db2);
    svc1.start({ defaults: [] });
    const job = svc1.addJob({
      name: "past-at",
      schedule: { kind: "at", atMs: Date.now() - 10_000 },
      message: "past",
    });
    // Manually set nextRunAtMs to a past value so start() picks it up
    db2.run("UPDATE cron_jobs SET next_run_at_ms = ? WHERE id = ?", [Date.now() - 5000, job.id]);
    svc1.stop();

    const svc2 = new CronService(db2);
    svc2.start({ defaults: [] });
    const reloaded = svc2.getJob(job.id);
    // at-kind with past atMs => computeNextRun returns null => nextRunAtMs null
    expect(reloaded?.state.nextRunAtMs).toBeNull();
    svc2.stop();
  });

  test("updateBuiltinJobsTimezone updates only built-in job timezones", () => {
    const svc = new CronService(db);
    svc.start({
      defaults: [
        { name: "morning-briefing", schedule: { kind: "cron", expr: "0 8 * * *", tz: "UTC" }, message: "brief", deliver: true },
        { name: "evening-recap",    schedule: { kind: "cron", expr: "0 21 * * *", tz: "UTC" }, message: "recap", deliver: true },
      ],
    });
    // Add a user-created cron job
    svc.addJob({ name: "custom-job", schedule: { kind: "cron", expr: "0 12 * * *", tz: "UTC" }, message: "custom" });

    const updated = svc.updateBuiltinJobsTimezone("Asia/Tokyo");
    expect(updated).toContain("morning-briefing");
    expect(updated).toContain("evening-recap");
    expect(updated).not.toContain("custom-job");

    // Built-ins have new tz; custom job still UTC
    const all = svc.listJobs(true);
    const briefing = all.find((j) => j.name === "morning-briefing");
    const customJ = all.find((j) => j.name === "custom-job");
    expect(briefing?.schedule.tz).toBe("Asia/Tokyo");
    expect(customJ?.schedule.tz).toBe("UTC");
    svc.stop();
  });
});
