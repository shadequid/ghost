/**
 * Unit tests for the morning briefing tool.
 *
 * Verifies:
 * - BRIEFING_PROMPT is exported and well-formed.
 * - disable action calls enableJob(id, false) instead of removeJob.
 * - enable action re-creates the job (no duplicate).
 * - status action reports correctly after disable.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { CronService } from "../../../src/scheduler/service.js";
import { createMorningBriefingTool } from "../../../src/tools/trading/intel-briefing.js";
import { BRIEFING_PROMPT } from "../../../src/scheduler/defaults.js";
import { DB_MIGRATIONS } from "../../../src/core/migrations/registry.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  // CronService only needs cron_jobs — run that migration directly.
  const m = DB_MIGRATIONS.find((x) => x.version === 10)!;
  (m.up as (db: Database) => void)(db);
  return db;
}

let cronService: CronService;

beforeEach(() => {
  cronService = new CronService(makeDb());
  // Isolated — no default seeding so tool is sole source of jobs
  cronService.start({ defaults: [] });
});

afterEach(() => {
  cronService.stop();
});

// ---------------------------------------------------------------------------
// BRIEFING_PROMPT export
// ---------------------------------------------------------------------------

describe("BRIEFING_PROMPT constant", () => {
  test("is exported and non-empty", () => {
    expect(typeof BRIEFING_PROMPT).toBe("string");
    expect(BRIEFING_PROMPT.length).toBeGreaterThan(0);
  });

  test("mentions morning briefing (case-insensitive)", () => {
    expect(BRIEFING_PROMPT.toLowerCase()).toContain("morning briefing");
  });

  test("tool uses the same constant as defaults.ts", async () => {
    const tool = createMorningBriefingTool(cronService);
    await tool.execute("tc1", { action: "enable", time: "08:00", timezone: "UTC" });
    const jobs = cronService.listJobs(true);
    const briefing = jobs.find((j) => j.name === "morning-briefing");
    expect(briefing).toBeDefined();
    expect(briefing!.payload.message).toBe(BRIEFING_PROMPT);
  });
});

// ---------------------------------------------------------------------------
// enable action
// ---------------------------------------------------------------------------

describe("ghost_morning_briefing enable", () => {
  test("creates a morning-briefing cron job", async () => {
    const tool = createMorningBriefingTool(cronService);
    const result = await tool.execute("tc1", { action: "enable", time: "08:00", timezone: "UTC" });
    expect(result.content[0]).toMatchObject({ type: "text" });
    const job = cronService.listJobs(true).find((j) => j.name === "morning-briefing");
    expect(job).toBeDefined();
    expect(job!.enabled).toBe(true);
    expect(job!.schedule.expr).toBe("0 8 * * *");
    expect(job!.schedule.tz).toBe("UTC");
  });

  test("enable after disable re-enables (no duplicate)", async () => {
    const tool = createMorningBriefingTool(cronService);
    await tool.execute("tc1", { action: "enable", time: "08:00", timezone: "UTC" });
    await tool.execute("tc2", { action: "disable" });
    await tool.execute("tc3", { action: "enable", time: "09:00", timezone: "Europe/London" });

    const jobs = cronService.listJobs(true).filter((j) => j.name === "morning-briefing");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].schedule.expr).toBe("0 9 * * *");
    expect(jobs[0].schedule.tz).toBe("Europe/London");
  });

  test("rejects invalid time format", async () => {
    const tool = createMorningBriefingTool(cronService);
    const result = await tool.execute("tc1", { action: "enable", time: "25:00" });
    expect(result.content[0]).toMatchObject({ type: "text" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Invalid time");
  });
});

// ---------------------------------------------------------------------------
// disable action — must call enableJob(id, false), NOT removeJob
// ---------------------------------------------------------------------------

describe("ghost_morning_briefing disable", () => {
  test("disables the job without removing it", async () => {
    const tool = createMorningBriefingTool(cronService);
    await tool.execute("tc1", { action: "enable", time: "08:00", timezone: "UTC" });

    await tool.execute("tc2", { action: "disable" });

    // Job must still exist in the store (not deleted)
    const job = cronService.listJobs(true).find((j) => j.name === "morning-briefing");
    expect(job).toBeDefined();
    expect(job!.enabled).toBe(false);
  });

  test("disabled job is not in the enabled-only list", async () => {
    const tool = createMorningBriefingTool(cronService);
    await tool.execute("tc1", { action: "enable", time: "08:00", timezone: "UTC" });
    await tool.execute("tc2", { action: "disable" });

    const enabledJobs = cronService.listJobs(false);
    const briefing = enabledJobs.find((j) => j.name === "morning-briefing");
    expect(briefing).toBeUndefined();
  });

  test("disable on non-existent job returns graceful message", async () => {
    const tool = createMorningBriefingTool(cronService);
    const result = await tool.execute("tc1", { action: "disable" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("not currently scheduled");
  });

  test("disabled job preserves its schedule for later re-enable", async () => {
    const tool = createMorningBriefingTool(cronService);
    await tool.execute("tc1", { action: "enable", time: "07:30", timezone: "America/New_York" });
    await tool.execute("tc2", { action: "disable" });

    const job = cronService.listJobs(true).find((j) => j.name === "morning-briefing");
    expect(job).toBeDefined();
    // Schedule is preserved even when disabled
    expect(job!.schedule.expr).toBe("30 7 * * *");
  });
});

// ---------------------------------------------------------------------------
// status action
// ---------------------------------------------------------------------------

describe("ghost_morning_briefing status", () => {
  test("status shows enabled=true after enable", async () => {
    const tool = createMorningBriefingTool(cronService);
    await tool.execute("tc1", { action: "enable", time: "08:00", timezone: "UTC" });
    const result = await tool.execute("tc2", { action: "status" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Enabled: true");
  });

  test("status shows enabled=false after disable", async () => {
    const tool = createMorningBriefingTool(cronService);
    await tool.execute("tc1", { action: "enable", time: "08:00", timezone: "UTC" });
    await tool.execute("tc2", { action: "disable" });
    const result = await tool.execute("tc3", { action: "status" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Enabled: false");
  });

  test("status reports not scheduled when no job exists", async () => {
    const tool = createMorningBriefingTool(cronService);
    const result = await tool.execute("tc1", { action: "status" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("not scheduled");
  });
});

// ---------------------------------------------------------------------------
// set_time action
// ---------------------------------------------------------------------------

describe("ghost_morning_briefing set_time", () => {
  test("updates schedule without changing the message", async () => {
    const tool = createMorningBriefingTool(cronService);
    await tool.execute("tc1", { action: "enable", time: "08:00", timezone: "UTC" });
    await tool.execute("tc2", { action: "set_time", time: "10:30", timezone: "Asia/Tokyo" });

    const job = cronService.listJobs(true).find((j) => j.name === "morning-briefing");
    expect(job).toBeDefined();
    expect(job!.schedule.expr).toBe("30 10 * * *");
    expect(job!.schedule.tz).toBe("Asia/Tokyo");
    expect(job!.payload.message).toBe(BRIEFING_PROMPT);
  });

  test("set_time on non-existent job returns error", async () => {
    const tool = createMorningBriefingTool(cronService);
    const result = await tool.execute("tc1", { action: "set_time", time: "10:00" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("not enabled");
  });
});
