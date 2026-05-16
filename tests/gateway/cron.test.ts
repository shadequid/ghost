import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MethodRegistry, type MethodContext } from "../../src/gateway/method-registry.js";
import { registerCronMethods } from "../../src/gateway/cron.js";
import { CronService } from "../../src/scheduler/service.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("cron methods", () => {
  let tmpDir: string;
  let service: CronService;
  let reg: MethodRegistry;
  let broadcasts: Array<{ event: string; payload: unknown }>;

  function makeCtx(): MethodContext {
    return {
      clientId: "c1", sessionId: "s1",
      broadcast: (event, payload) => broadcasts.push({ event, payload }),
      emit: () => {},
    };
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-cron-test-"));
    service = new CronService(join(tmpDir, "cron", "jobs.json"));
    reg = new MethodRegistry();
    broadcasts = [];
    registerCronMethods(reg.register.bind(reg), { cronService: service });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("cron.list returns empty initially", async () => {
    const result = await reg.dispatch("cron.list", makeCtx(), {}) as { jobs: unknown[] };
    expect(result.jobs).toEqual([]);
  });

  test("cron.add creates a job with command field", async () => {
    const result = await reg.dispatch("cron.add", makeCtx(), {
      name: "test-job", schedule: "every:60000ms", command: "do something",
    }) as { job: { id: string; name: string; command: string } };
    expect(result.job.name).toBe("test-job");
    expect(result.job.command).toBe("do something");
    expect(typeof result.job.id).toBe("string");
  });

  test("cron.add accepts legacy message field", async () => {
    const result = await reg.dispatch("cron.add", makeCtx(), {
      name: "legacy-job", schedule: "every:60000ms", message: "legacy msg",
    }) as { job: { id: string; command: string } };
    expect(result.job.command).toBe("legacy msg");
  });

  test("cron.add prefers command over message", async () => {
    const result = await reg.dispatch("cron.add", makeCtx(), {
      schedule: "every:60000ms", command: "cmd-value", message: "msg-value",
    }) as { job: { command: string } };
    expect(result.job.command).toBe("cmd-value");
  });

  test("cron.add rejects missing command/message", async () => {
    try {
      await reg.dispatch("cron.add", makeCtx(), { schedule: "every:60000ms" });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toBe("command is required");
    }
  });

  test("cron.remove returns { removed: true } on success", async () => {
    const addResult = await reg.dispatch("cron.add", makeCtx(), {
      schedule: "every:60000ms", command: "test",
    }) as { job: { id: string } };
    const result = await reg.dispatch("cron.remove", makeCtx(), { jobId: addResult.job.id }) as { removed: boolean };
    expect(result.removed).toBe(true);
  });

  test("cron.remove returns { removed: false } for unknown job", async () => {
    const result = await reg.dispatch("cron.remove", makeCtx(), { jobId: "nonexistent" }) as { removed: boolean };
    expect(result.removed).toBe(false);
  });

  test("cron.run accepts mode param", async () => {
    const addResult = await reg.dispatch("cron.add", makeCtx(), {
      schedule: "every:60000ms", command: "test",
    }) as { job: { id: string } };
    // force mode (default)
    const result = await reg.dispatch("cron.run", makeCtx(), { jobId: addResult.job.id, mode: "force" }) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(broadcasts).toContainEqual({ event: "cron.executed", payload: { jobId: addResult.job.id } });
  });

  test("cron.status returns scheduler info", async () => {
    const result = await reg.dispatch("cron.status", makeCtx(), {}) as { enabled: boolean };
    expect(typeof result.enabled).toBe("boolean");
  });

  test("cron.add rejects missing schedule", async () => {
    try {
      await reg.dispatch("cron.add", makeCtx(), { command: "test" });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toBe("schedule is required");
    }
  });
});
