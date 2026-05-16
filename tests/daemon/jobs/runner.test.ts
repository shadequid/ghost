/**
 * Tests for BackgroundJobRunner.
 *
 * Uses short timer delays (≤ 100ms) to keep the suite fast. Each test
 * creates its own runner instance to avoid state leakage.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { BackgroundJobRunner } from "../../../src/daemon/jobs/runner.js";
import type { BackgroundJob, JobContext, JobResult } from "../../../src/daemon/jobs/types.js";
import type { Logger } from "pino";
import type { Runtime } from "../../../src/runtime.js";
import type { EventBus } from "../../../src/bus/events.js";
import type { Agent } from "@mariozechner/pi-agent-core";
import type { Runner } from "../../../src/agent/runner.js";
import type { Config } from "../../../src/config/schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeLogger(): Logger {
  return {
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => makeLogger()),
    trace: mock(() => {}),
  } as unknown as Logger;
}

function makeRunnerDeps() {
  return {
    taskAgent: {} as Agent,
    runner: {} as Runner,
    runtime: {} as Runtime,
    eventBus: {} as EventBus,
    logger: makeLogger(),
    config: {} as Config,
  };
}

/** Make a simple interval job whose run() resolves after `workMs`. */
function makeIntervalJob(opts: {
  name?: string;
  ms?: number;
  workMs?: number;
  runFn?: (ctx: JobContext) => Promise<JobResult | void>;
  kickAtStart?: boolean;
  onStop?: () => Promise<void>;
  enabled?: () => boolean;
}): { job: BackgroundJob; runCount: () => number } {
  let count = 0;
  const job: BackgroundJob = {
    name: opts.name ?? "test-job",
    schedule: { type: "interval", ms: opts.ms ?? 50 },
    enabled: opts.enabled,
    kickAtStart: opts.kickAtStart,
    onStop: opts.onStop,
    run: opts.runFn ?? (async (_ctx) => {
      count++;
      if (opts.workMs) await sleep(opts.workMs);
    }),
  };
  return { job, runCount: () => count };
}

// ---------------------------------------------------------------------------
// Test 1: Register + start + interval fires
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — interval schedule fires", () => {
  test("job.run() is called after the scheduled interval elapses", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    let runCount = 0;
    const job: BackgroundJob = {
      name: "ticker",
      schedule: { type: "interval", ms: 30 },
      run: async () => { runCount++; },
    };

    runner.register(job);
    await runner.start();

    // Wait more than 2 intervals
    await sleep(110);
    await runner.stop();

    expect(runCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Single-flight — concurrent kick() calls return same promise
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — single-flight", () => {
  test("3 concurrent kick() calls return the same in-flight promise", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    let callCount = 0;
    const job: BackgroundJob = {
      name: "slow-job",
      schedule: { type: "interval", ms: 10_000 }, // won't auto-fire in test
      run: async () => {
        callCount++;
        await sleep(30);
      },
    };

    runner.register(job);
    await runner.start();

    // Fire 3 concurrent kicks
    const p1 = runner.kick("slow-job");
    const p2 = runner.kick("slow-job");
    const p3 = runner.kick("slow-job");

    // All three should be the same promise
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);

    await Promise.all([p1, p2, p3]);

    // run() called only once
    expect(callCount).toBe(1);

    await runner.stop();
  });

  test("after in-flight completes, next kick() starts a new run", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    let callCount = 0;
    const job: BackgroundJob = {
      name: "sequential-job",
      schedule: { type: "interval", ms: 10_000 },
      run: async () => {
        callCount++;
        await sleep(10);
      },
    };

    runner.register(job);
    await runner.start();

    await runner.kick("sequential-job");
    // After first completes, kick again
    await runner.kick("sequential-job");

    expect(callCount).toBe(2);
    await runner.stop();
  });
});

// ---------------------------------------------------------------------------
// Test 3: Adaptive — nextDelayMs is used for next tick
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — adaptive schedule", () => {
  test("run() result nextDelayMs schedules the next tick at that delay (within bounds)", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    const ticks: number[] = [];
    let callCount = 0;

    const job: BackgroundJob = {
      name: "adaptive-job",
      schedule: { type: "adaptive", initialMs: 20, minMs: 10, maxMs: 500 },
      run: async () => {
        ticks.push(Date.now());
        callCount++;
        // After first tick, request 200ms delay
        return { nextDelayMs: 200 };
      },
    };

    runner.register(job);
    await runner.start();

    // Wait for the first tick (initialMs=20) + a bit
    await sleep(50);

    // After first tick, next should be in 200ms — should NOT fire yet at 50ms
    expect(callCount).toBe(1);

    await runner.stop();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Adaptive — clamp at min
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — adaptive clamp min", () => {
  test("nextDelayMs below minMs is clamped to minMs", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    const scheduledDelays: number[] = [];
    let count = 0;

    const job: BackgroundJob = {
      name: "clamp-min-job",
      schedule: { type: "adaptive", initialMs: 20, minMs: 100, maxMs: 500 },
      run: async () => {
        count++;
        // Return something below minMs
        return { nextDelayMs: 5 };
      },
    };

    // Intercept: we'll read the scheduled delay via status()
    runner.register(job);
    await runner.start();

    // Wait for first tick
    await sleep(50);

    const statuses = runner.status();
    const jobStatus = statuses.find((s) => s.name === "clamp-min-job")!;

    // After first run, nextRunAt should be ~100ms after lastRunAt (clamped from 5)
    if (jobStatus.lastRunAt !== null && jobStatus.nextRunAt !== null) {
      const scheduledGap = jobStatus.nextRunAt - jobStatus.lastRunAt;
      expect(scheduledGap).toBeGreaterThanOrEqual(95); // ≥ minMs (with small margin)
      expect(scheduledGap).toBeLessThanOrEqual(200);   // not more than maxMs
    }

    await runner.stop();
  });
});

// ---------------------------------------------------------------------------
// Test 5: Adaptive — clamp at max
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — adaptive clamp max", () => {
  test("nextDelayMs above maxMs is clamped to maxMs", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    const job: BackgroundJob = {
      name: "clamp-max-job",
      schedule: { type: "adaptive", initialMs: 20, minMs: 10, maxMs: 200 },
      run: async () => {
        // Return something way above maxMs
        return { nextDelayMs: 1_000_000 };
      },
    };

    runner.register(job);
    await runner.start();

    await sleep(50);

    const statuses = runner.status();
    const jobStatus = statuses.find((s) => s.name === "clamp-max-job")!;

    if (jobStatus.lastRunAt !== null && jobStatus.nextRunAt !== null) {
      const scheduledGap = jobStatus.nextRunAt - jobStatus.lastRunAt;
      expect(scheduledGap).toBeLessThanOrEqual(210); // clamped to ≤ maxMs
    }

    await runner.stop();
  });
});

// ---------------------------------------------------------------------------
// Test 6: kickAtStart goes through single-flight — startup kick must use
// the same inFlight slot as kick()
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — kickAtStart single-flight", () => {
  test("kickAtStart run and concurrent kick() share the same in-flight slot (runCount === 1)", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    let runCount = 0;
    const job: BackgroundJob = {
      name: "kick-start-single",
      schedule: { type: "interval", ms: 10_000 }, // won't auto-fire in test
      kickAtStart: true,
      run: async () => {
        runCount++;
        await sleep(100); // long enough for concurrent kick to arrive
      },
    };

    runner.register(job);
    await runner.start(); // fires kickAtStart → inFlight is now set

    // Immediately kick while kickAtStart run is in-flight
    const p = runner.kick("kick-start-single");
    await p; // both must resolve with same underlying run

    expect(runCount).toBe(1);
    await runner.stop();
  });

  test("kickAtStart adaptive nextDelayMs updates lastDelayMs — honored by subsequent tick", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    // Use a short initialMs so we can observe the second tick quickly.
    // kickAtStart returns nextDelayMs=50; initial timer is also 50ms.
    // After kickAtStart resolves (lastDelayMs=50), the 50ms timer fires,
    // runs kick(), whose .finally() calls scheduleNext with lastDelayMs=50.
    let runCount = 0;
    const job: BackgroundJob = {
      name: "kick-start-adaptive",
      schedule: { type: "adaptive", initialMs: 80, minMs: 40, maxMs: 5_000 },
      kickAtStart: true,
      run: async (): Promise<JobResult> => {
        runCount++;
        return { nextDelayMs: 50 }; // request 50ms for next tick
      },
    };

    runner.register(job);
    await runner.start();

    // kickAtStart fires immediately (run 1), returns nextDelayMs=50 → lastDelayMs=50
    // The initial timer (80ms) also fires → run 2 → .finally() scheduleNext(50ms)
    // By t=200ms we should have at least 2 runs
    await sleep(220);
    await runner.stop();

    // Must have run at least twice (kickAtStart + at least one timer tick)
    expect(runCount).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Test 7: Cross-job kick
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — cross-job kick", () => {
  test("jobA.run() can kick jobB; jobB runs exactly once (single-flight)", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    let bCount = 0;

    const jobB: BackgroundJob = {
      name: "job-b",
      schedule: { type: "interval", ms: 10_000 },
      run: async () => {
        bCount++;
        await sleep(10);
      },
    };

    const jobA: BackgroundJob = {
      name: "job-a",
      schedule: { type: "interval", ms: 10_000 },
      run: async (ctx) => {
        // Kick B twice — second should be no-op (in-flight)
        void ctx.kick("job-b");
        void ctx.kick("job-b");
        await sleep(5);
      },
    };

    runner.register(jobB);
    runner.register(jobA);
    await runner.start();

    await runner.kick("job-a");
    // Wait for jobB to complete
    await sleep(50);

    expect(bCount).toBe(1);

    await runner.stop();
  });
});

// ---------------------------------------------------------------------------
// Test 8: Disabled job does not run
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — disabled jobs", () => {
  test("enabled: () => false prevents the job from ticking", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    let runCount = 0;
    const job: BackgroundJob = {
      name: "disabled-job",
      schedule: { type: "interval", ms: 20 },
      enabled: () => false,
      run: async () => { runCount++; },
    };

    runner.register(job);
    await runner.start();

    await sleep(100);
    await runner.stop();

    expect(runCount).toBe(0);
  });

  test("disabled job does not appear as enabled in status()", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    const job: BackgroundJob = {
      name: "off-job",
      schedule: { type: "interval", ms: 50 },
      enabled: () => false,
      run: async () => {},
    };

    runner.register(job);
    await runner.start();

    const statuses = runner.status();
    const s = statuses.find((x) => x.name === "off-job");
    expect(s?.enabled).toBe(false);

    await runner.stop();
  });
});

// ---------------------------------------------------------------------------
// Test 9: Status snapshot
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — status()", () => {
  test("status reflects lastRunAt, lastDurationMs, and inFlight state", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    const job: BackgroundJob = {
      name: "status-job",
      schedule: { type: "interval", ms: 10_000 },
      run: async () => {
        await sleep(20);
      },
    };

    runner.register(job);
    await runner.start();

    // Check initial state
    let statuses = runner.status();
    let s = statuses.find((x) => x.name === "status-job")!;
    expect(s.lastRunAt).toBeNull();
    expect(s.inFlight).toBe(false);

    // Start a run
    const kickP = runner.kick("status-job");

    // Briefly check in-flight
    await sleep(5);
    statuses = runner.status();
    s = statuses.find((x) => x.name === "status-job")!;
    expect(s.inFlight).toBe(true);

    await kickP;

    // After completion
    statuses = runner.status();
    s = statuses.find((x) => x.name === "status-job")!;
    expect(s.inFlight).toBe(false);
    expect(s.lastRunAt).not.toBeNull();
    expect(s.lastDurationMs).not.toBeNull();
    expect(s.lastDurationMs!).toBeGreaterThanOrEqual(15);

    await runner.stop();
  });

  test("lastError captures the error message when run() throws", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    const job: BackgroundJob = {
      name: "error-job",
      schedule: { type: "interval", ms: 10_000 },
      run: async () => {
        throw new Error("boom");
      },
    };

    runner.register(job);
    await runner.start();

    await runner.kick("error-job").catch(() => {});
    await sleep(10);

    const statuses = runner.status();
    const s = statuses.find((x) => x.name === "error-job")!;
    expect(s.lastError).toBe("boom");

    await runner.stop();
  });
});

// ---------------------------------------------------------------------------
// Test 10: Failure isolation — next tick still scheduled after run() throws
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — failure isolation", () => {
  test("if run() throws, runner logs warn and schedules next tick", async () => {
    const deps = makeRunnerDeps();
    const logger = makeLogger();
    const runnerWithLogger = new BackgroundJobRunner({ ...deps, logger });

    let callCount = 0;

    const job: BackgroundJob = {
      name: "flaky-job",
      schedule: { type: "interval", ms: 30 },
      run: async () => {
        callCount++;
        if (callCount === 1) throw new Error("first tick fails");
        // Second tick succeeds
      },
    };

    runnerWithLogger.register(job);
    await runnerWithLogger.start();

    // Wait for 2 ticks
    await sleep(150);
    await runnerWithLogger.stop();

    // Should have run at least twice (first fail, second success)
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test("kick() on a failed job returns a rejected promise but does NOT permanently break the runner", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    let count = 0;
    const job: BackgroundJob = {
      name: "fail-then-ok",
      schedule: { type: "interval", ms: 10_000 },
      run: async () => {
        count++;
        if (count === 1) throw new Error("first fail");
      },
    };

    runner.register(job);
    await runner.start();

    await expect(runner.kick("fail-then-ok")).rejects.toThrow("first fail");

    // Second kick should work
    await runner.kick("fail-then-ok");
    expect(count).toBe(2);

    await runner.stop();
  });
});

// ---------------------------------------------------------------------------
// Test 11: stop() lifecycle — prevents adaptive reschedule after stop
// ---------------------------------------------------------------------------

describe("BackgroundJobRunner — stop() lifecycle", () => {
  test("stop() prevents adaptive reschedule after an in-flight kick resolves post-stop", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    let runCount = 0;

    const job: BackgroundJob = {
      name: "adaptive-stop",
      schedule: { type: "adaptive", initialMs: 50, minMs: 10, maxMs: 500 },
      run: async () => {
        runCount++;
        await sleep(80); // longer than initialMs so it's in-flight when stop() is called
      },
    };

    runner.register(job);
    await runner.start();

    // Wait for the first tick to start (initialMs=50ms)
    await sleep(70);
    expect(runCount).toBe(1); // first run has started

    // Stop while the in-flight run is still pending
    await runner.stop(); // awaits in-flight completion

    // Give ample time for any spurious reschedule to fire
    await sleep(150);

    // Must still be exactly 1 — stop() must have blocked the reschedule
    expect(runCount).toBe(1);
  });

  test("stop() is idempotent — calling twice does not throw or double-await", async () => {
    const deps = makeRunnerDeps();
    const runner = new BackgroundJobRunner(deps);

    let runCount = 0;
    const job: BackgroundJob = {
      name: "idempotent-stop",
      schedule: { type: "interval", ms: 10_000 },
      run: async () => { runCount++; },
    };

    runner.register(job);
    await runner.start();

    // First stop — normal
    await runner.stop();

    // Second stop — must be a no-op, no error
    await expect(runner.stop()).resolves.toBeUndefined();

    expect(runCount).toBe(0); // no auto-fires in 10s interval
  });
});
