import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CronService } from "../../src/scheduler/service.js";
import {
  BUILT_IN_JOBS,
  BRIEFING_PROMPT,
  RECAP_PROMPT,
  detectUserTimezone,
  type DefaultJobSpec,
} from "../../src/scheduler/defaults.js";

let tmpDir: string;
let storePath: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `ghost-cron-defaults-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  storePath = join(tmpDir, "cron", "jobs.json");
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// detectUserTimezone
// ---------------------------------------------------------------------------

describe("detectUserTimezone", () => {
  test("returns a non-empty string under normal conditions", () => {
    const tz = detectUserTimezone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });

  test("falls back to UTC when Intl.DateTimeFormat throws", () => {
    // Temporarily break Intl.DateTimeFormat to simulate exotic env.
    // Cast through unknown to avoid fighting the full DateTimeFormatConstructor shape.
    const original = globalThis.Intl;
    try {
      globalThis.Intl = {
        ...original,
        DateTimeFormat: (() => { throw new Error("no Intl support"); }) as unknown as typeof Intl.DateTimeFormat,
      };
      const tz = detectUserTimezone();
      expect(tz).toBe("UTC");
    } finally {
      globalThis.Intl = original;
    }
  });

  test("falls back to UTC when resolvedOptions().timeZone is empty", () => {
    const original = globalThis.Intl;
    try {
      globalThis.Intl = {
        ...original,
        DateTimeFormat: (() => ({
          resolvedOptions: () => ({ timeZone: "" } as Intl.ResolvedDateTimeFormatOptions),
          format: () => "",
          formatToParts: () => [],
          formatRange: () => "",
          formatRangeToParts: () => [],
        })) as unknown as typeof Intl.DateTimeFormat,
      };
      const tz = detectUserTimezone();
      expect(tz).toBe("UTC");
    } finally {
      globalThis.Intl = original;
    }
  });
});

// ---------------------------------------------------------------------------
// BUILT_IN_JOBS shape
// ---------------------------------------------------------------------------

describe("BUILT_IN_JOBS", () => {
  test("first entry is morning-briefing", () => {
    expect(BUILT_IN_JOBS[0].name).toBe("morning-briefing");
  });

  test("morning-briefing uses BRIEFING_PROMPT", () => {
    expect(BUILT_IN_JOBS[0].message).toBe(BRIEFING_PROMPT);
  });

  test("BRIEFING_PROMPT is non-empty and mentions morning briefing", () => {
    expect(BRIEFING_PROMPT.length).toBeGreaterThan(0);
    expect(BRIEFING_PROMPT.toLowerCase()).toContain("morning briefing");
  });

  test("morning-briefing schedule is cron at 08:00", () => {
    const spec = BUILT_IN_JOBS[0];
    expect(spec.schedule.kind).toBe("cron");
    expect(spec.schedule.expr).toBe("0 8 * * *");
    expect(spec.schedule.tz).toBeTruthy();
  });

  test("morning-briefing has deliver=true", () => {
    expect(BUILT_IN_JOBS[0].deliver).toBe(true);
  });

  test("second entry is evening-recap", () => {
    expect(BUILT_IN_JOBS[1].name).toBe("evening-recap");
  });

  test("evening-recap uses RECAP_PROMPT", () => {
    expect(BUILT_IN_JOBS[1].message).toBe(RECAP_PROMPT);
  });

  test("RECAP_PROMPT is non-empty and mentions recap", () => {
    expect(RECAP_PROMPT.length).toBeGreaterThan(0);
    expect(RECAP_PROMPT.toLowerCase()).toContain("recap");
  });

  test("evening-recap schedule is cron at 21:00", () => {
    const spec = BUILT_IN_JOBS[1];
    expect(spec.schedule.kind).toBe("cron");
    expect(spec.schedule.expr).toBe("0 21 * * *");
    expect(spec.schedule.tz).toBeTruthy();
  });

  test("evening-recap has deliver=true", () => {
    expect(BUILT_IN_JOBS[1].deliver).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CronService.start({ defaults }) — seeding behaviour
// ---------------------------------------------------------------------------

describe("CronService seeding", () => {
  test("seeds morning-briefing on first start", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: BUILT_IN_JOBS });
    const jobs = svc.listJobs(true);
    const briefing = jobs.find((j) => j.name === "morning-briefing");
    expect(briefing).toBeDefined();
    expect(briefing!.enabled).toBe(true);
    svc.stop();
  });

  test("seeding is idempotent — stop/start does not duplicate", () => {
    const svc1 = new CronService(storePath);
    svc1.start({ defaults: BUILT_IN_JOBS });
    svc1.stop();

    const svc2 = new CronService(storePath);
    svc2.start({ defaults: BUILT_IN_JOBS });
    const jobs = svc2.listJobs(true).filter((j) => j.name === "morning-briefing");
    expect(jobs).toHaveLength(1);
    svc2.stop();
  });

  test("pre-existing user-customised morning-briefing is preserved", () => {
    const svc1 = new CronService(storePath);
    svc1.start({ defaults: [] });
    // User sets a custom time: 09:30
    svc1.addJob({
      name: "morning-briefing",
      schedule: { kind: "cron", expr: "30 9 * * *", tz: "Asia/Tokyo" },
      message: "custom briefing prompt",
    });
    svc1.stop();

    // Second start with BUILT_IN_JOBS — must not overwrite the custom entry
    const svc2 = new CronService(storePath);
    svc2.start({ defaults: BUILT_IN_JOBS });
    const briefings = svc2.listJobs(true).filter((j) => j.name === "morning-briefing");
    expect(briefings).toHaveLength(1);
    expect(briefings[0].schedule.expr).toBe("30 9 * * *");
    expect(briefings[0].schedule.tz).toBe("Asia/Tokyo");
    svc2.stop();
  });

  test("start with empty defaults seeds nothing", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: [] });
    expect(svc.listJobs(true)).toHaveLength(0);
    svc.stop();
  });

  test("custom DefaultJobSpec is seeded correctly", () => {
    const custom: DefaultJobSpec = {
      name: "test-job",
      schedule: { kind: "cron", expr: "0 12 * * *", tz: "UTC" },
      message: "test message",
      deliver: true,
    };
    const svc = new CronService(storePath);
    svc.start({ defaults: [custom] });
    const job = svc.listJobs(true).find((j) => j.name === "test-job");
    expect(job).toBeDefined();
    expect(job!.payload.message).toBe("test message");
    svc.stop();
  });

  test("seeds evening-recap on first start", () => {
    const svc = new CronService(storePath);
    svc.start({ defaults: BUILT_IN_JOBS });
    const jobs = svc.listJobs(true);
    const recap = jobs.find((j) => j.name === "evening-recap");
    expect(recap).toBeDefined();
    expect(recap!.enabled).toBe(true);
    expect(recap!.schedule.expr).toBe("0 21 * * *");
    svc.stop();
  });

  test("seeding evening-recap is idempotent — stop/start does not duplicate", () => {
    const svc1 = new CronService(storePath);
    svc1.start({ defaults: BUILT_IN_JOBS });
    svc1.stop();

    const svc2 = new CronService(storePath);
    svc2.start({ defaults: BUILT_IN_JOBS });
    const jobs = svc2.listJobs(true).filter((j) => j.name === "evening-recap");
    expect(jobs).toHaveLength(1);
    svc2.stop();
  });

  test("disabled morning-briefing is not re-enabled on restart", () => {
    const svc1 = new CronService(storePath);
    svc1.start({ defaults: BUILT_IN_JOBS });
    const job = svc1.listJobs(true).find((j) => j.name === "morning-briefing");
    expect(job).toBeDefined();
    svc1.enableJob(job!.id, false);
    svc1.stop();

    // Restart — seedDefaultJobs finds the name, skips it
    const svc2 = new CronService(storePath);
    svc2.start({ defaults: BUILT_IN_JOBS });
    const briefings = svc2.listJobs(true).filter((j) => j.name === "morning-briefing");
    expect(briefings).toHaveLength(1);
    expect(briefings[0].enabled).toBe(false);
    svc2.stop();
  });
});
