import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronService } from "../../src/scheduler/service.js";

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `ghost-cron-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  storePath = join(tmpDir, "cron", "jobs.json");
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("CronService", () => {
  test("addJob creates a job and returns it", () => {
    const svc = new CronService(storePath);
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
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    svc.addJob({ name: "a", schedule: { kind: "every", everyMs: 1000 }, message: "a" });
    svc.addJob({ name: "b", schedule: { kind: "every", everyMs: 2000 }, message: "b" });
    const jobs = svc.listJobs();
    expect(jobs).toHaveLength(2);
    svc.stop();
  });

  test("removeJob deletes a job", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    const job = svc.addJob({ name: "temp", schedule: { kind: "every", everyMs: 1000 }, message: "temp" });
    expect(svc.removeJob(job.id)).toBe(true);
    expect(svc.listJobs()).toHaveLength(0);
    svc.stop();
  });

  test("removeJob returns false for unknown id", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    expect(svc.removeJob("nonexistent")).toBe(false);
    svc.stop();
  });

  test("enableJob toggles enabled state", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    const job = svc.addJob({ name: "toggle", schedule: { kind: "every", everyMs: 1000 }, message: "toggle" });
    svc.enableJob(job.id, false);
    expect(svc.getJob(job.id)?.enabled).toBe(false);
    svc.enableJob(job.id, true);
    expect(svc.getJob(job.id)?.enabled).toBe(true);
    svc.stop();
  });

  test("status reports running state and job count", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    svc.addJob({ name: "s", schedule: { kind: "every", everyMs: 1000 }, message: "s" });
    const st = svc.status();
    expect(st.enabled).toBe(true);
    expect(st.jobs).toBe(1);
    svc.stop();
  });

  test("runJob executes callback", async () => {
    let called = false;
    const svc = new CronService(storePath);
    svc.setOnJob(async () => { called = true; return null; });
    svc.start({ defaults: [] });
    const job = svc.addJob({ name: "run", schedule: { kind: "every", everyMs: 60_000 }, message: "run" });
    await svc.runJob(job.id);
    expect(called).toBe(true);
    expect(svc.getJob(job.id)?.state.lastStatus).toBe("ok");
    svc.stop();
  });

  test("at job auto-disables after run", async () => {
    const svc = new CronService(storePath);
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
    const svc = new CronService(storePath);
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

  test("persists and reloads from JSON file", () => {
    const svc1 = new CronService(storePath);
    svc1.start({ defaults: [] });
    svc1.addJob({ name: "persist", schedule: { kind: "every", everyMs: 5000 }, message: "persist" });
    svc1.stop();

    const svc2 = new CronService(storePath);
    svc2.start({ defaults: [] });
    expect(svc2.listJobs()).toHaveLength(1);
    expect(svc2.listJobs()[0].name).toBe("persist");
    svc2.stop();
  });

  test("run history limited to 20 entries", async () => {
    const svc = new CronService(storePath);
    svc.setOnJob(async () => null);
    svc.start({ defaults: [] });
    const job = svc.addJob({ name: "many", schedule: { kind: "every", everyMs: 1000 }, message: "many" });
    for (let i = 0; i < 25; i++) {
      await svc.runJob(job.id, true);
    }
    expect(svc.getJob(job.id)!.state.runHistory.length).toBeLessThanOrEqual(20);
    svc.stop();
  });
});
