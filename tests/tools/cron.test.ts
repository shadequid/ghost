import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronService } from "../../src/scheduler/service.js";
import { CronTool } from "../../src/tools/cron.js";

let tmpDir: string;
let storePath: string;
let service: CronService;
let tool: CronTool;

beforeEach(() => {
  tmpDir = join(tmpdir(), `ghost-cron-tool-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  storePath = join(tmpDir, "cron", "jobs.json");
  service = new CronService(storePath);
  service.setOnJob(async () => null);
  service.start({ defaults: [] });
  tool = new CronTool(service, "UTC");
});

afterEach(() => {
  service.stop();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// add action
// ---------------------------------------------------------------------------

describe("CronTool — add action", () => {
  test("creates job with every_seconds", async () => {
    const result = await tool.execute("call-1", {
      action: "add",
      message: "check prices",
      every_seconds: 60,
    });
    const text = result.content[0];
    expect(text.type).toBe("text");
    expect((text as { type: "text"; text: string }).text).toContain("Scheduled");
    expect(service.listJobs()).toHaveLength(1);
    expect(service.listJobs()[0].schedule.kind).toBe("every");
  });

  test("creates job with cron_expr", async () => {
    const result = await tool.execute("call-2", {
      action: "add",
      message: "daily check",
      cron_expr: "0 9 * * *",
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Scheduled");
    const jobs = service.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule.kind).toBe("cron");
    expect(jobs[0].schedule.expr).toBe("0 9 * * *");
  });

  test("creates one-time job with at", async () => {
    const futureDate = new Date(Date.now() + 3600_000).toISOString();
    const result = await tool.execute("call-3", {
      action: "add",
      message: "remind me",
      at: futureDate,
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Scheduled");
    const jobs = service.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule.kind).toBe("at");
    expect(jobs[0].deleteAfterRun).toBe(true);
  });

  test("rejects add without message", async () => {
    const result = await tool.execute("call-4", {
      action: "add",
      every_seconds: 60,
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Error");
    expect(text).toContain("Message is required");
  });

  test("rejects add without schedule params", async () => {
    const result = await tool.execute("call-5", {
      action: "add",
      message: "no schedule",
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Error");
    expect(text).toContain("every_seconds, cron_expr, or at");
  });

  test("rejects at in the past", async () => {
    const pastDate = new Date(Date.now() - 3600_000).toISOString();
    const result = await tool.execute("call-6", {
      action: "add",
      message: "too late",
      at: pastDate,
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Error");
    expect(text).toContain("future");
  });

  test("rejects at with invalid datetime", async () => {
    const result = await tool.execute("call-7", {
      action: "add",
      message: "bad date",
      at: "not-a-date",
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Error");
    expect(text).toContain("Invalid datetime");
  });
});

// ---------------------------------------------------------------------------
// list action
// ---------------------------------------------------------------------------

describe("CronTool — list action", () => {
  test("returns 'No scheduled tasks' when empty", async () => {
    const result = await tool.execute("call-8", { action: "list" });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("No scheduled tasks");
  });

  test("returns formatted job list", async () => {
    await tool.execute("call-9", {
      action: "add",
      message: "my task",
      every_seconds: 120,
    });
    const result = await tool.execute("call-10", { action: "list" });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("my task");
    expect(text).toContain("every");
  });
});

// ---------------------------------------------------------------------------
// remove action
// ---------------------------------------------------------------------------

describe("CronTool — remove action", () => {
  test("removes existing job", async () => {
    await tool.execute("call-11", {
      action: "add",
      message: "to remove",
      every_seconds: 60,
    });
    const jobId = service.listJobs()[0].id;
    const result = await tool.execute("call-12", {
      action: "remove",
      job_id: jobId,
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Removed");
    expect(service.listJobs()).toHaveLength(0);
  });

  test("rejects remove without job_id", async () => {
    const result = await tool.execute("call-13", { action: "remove" });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Error");
    expect(text).toContain("job_id is required");
  });

  test("returns error for nonexistent job_id", async () => {
    const result = await tool.execute("call-14", {
      action: "remove",
      job_id: "nonexistent",
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// recursive scheduling prevention
// ---------------------------------------------------------------------------

describe("CronTool — recursive scheduling prevention", () => {
  test("blocks add when enterCron()", async () => {
    tool.enterCron();
    const result = await tool.execute("call-15", {
      action: "add",
      message: "recursive attempt",
      every_seconds: 60,
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Error");
    expect(text).toContain("Cannot schedule tasks from within a cron job");
    expect(service.listJobs()).toHaveLength(0);
  });

  test("allows add after exitCron()", async () => {
    tool.enterCron();
    tool.exitCron();
    const result = await tool.execute("call-16", {
      action: "add",
      message: "allowed now",
      every_seconds: 60,
    });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("Scheduled");
  });

  test("list still works inside cron context", async () => {
    service.addJob({ name: "existing", schedule: { kind: "every", everyMs: 60_000 }, message: "x" });
    tool.enterCron();
    const result = await tool.execute("call-17", { action: "list" });
    const text = (result.content[0] as { type: "text"; text: string }).text;
    expect(text).toContain("existing");
  });
});

// ---------------------------------------------------------------------------
// setContext
// ---------------------------------------------------------------------------

describe("CronTool — setOrigin", () => {
  test("sets channel and chatId for job delivery", async () => {
    tool.setOrigin("telegram", "12345");
    await tool.execute("call-18", {
      action: "add",
      message: "deliver me",
      every_seconds: 60,
    });
    const job = service.listJobs()[0];
    expect(job.payload.channel).toBe("telegram");
    expect(job.payload.to).toBe("12345");
  });
});
