/**
 * BackgroundJobRunner — typed registry with single-flight + adaptive scheduling.
 *
 * Design:
 *   - Each registered job has exactly one in-flight slot (Map<name, Promise<void>>).
 *   - kick(name) returns the existing promise if a run is already active.
 *   - Interval jobs use setInterval; adaptive jobs chain via setTimeout.
 *   - stop() clears all timers and awaits in-flight completion (graceful shutdown).
 *     In-flight jobs are NOT forcibly aborted — they run to completion.
 */

import type { Agent } from "@earendil-works/pi-agent-core";
import type { Logger } from "pino";
import type { Runtime } from "../../runtime.js";
import type { EventBus } from "../../bus/events.js";
import type { Runner } from "../../agent/runner.js";
import type { Config } from "../../config/schema.js";
import type { BackgroundJob, JobContext, JobResult, JobStatus, Schedule } from "./types.js";

// ---------------------------------------------------------------------------
// Runner dependencies (subset of what's needed for JobContext)
// ---------------------------------------------------------------------------

export interface BackgroundJobRunnerDeps {
  taskAgent: Agent;
  runner: Runner;
  runtime: Runtime;
  eventBus: EventBus;
  logger: Logger;
  config: Config;
}

// ---------------------------------------------------------------------------
// Internal per-job tracking state
// ---------------------------------------------------------------------------

interface JobState {
  job: BackgroundJob;
  enabled: boolean;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null;
  /** Current adaptive delay (relevant for adaptive jobs only). */
  lastDelayMs: number;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: number | null;
}

// ---------------------------------------------------------------------------
// BackgroundJobRunner
// ---------------------------------------------------------------------------

export class BackgroundJobRunner {
  private readonly deps: BackgroundJobRunnerDeps;
  private readonly states = new Map<string, JobState>();
  private started = false;

  constructor(deps: BackgroundJobRunnerDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  register(job: BackgroundJob): void {
    if (this.started) {
      throw new Error(`BackgroundJobRunner: cannot register "${job.name}" after start()`);
    }
    if (this.states.has(job.name)) {
      throw new Error(`BackgroundJobRunner: duplicate job name "${job.name}"`);
    }
    const schedule = job.schedule;
    const initialDelay = schedule.type === "adaptive" ? schedule.initialMs : schedule.ms;
    this.states.set(job.name, {
      job,
      enabled: true, // evaluated in start()
      inFlight: null,
      timer: null,
      lastDelayMs: initialDelay,
      lastRunAt: null,
      lastDurationMs: null,
      lastError: null,
      nextRunAt: null,
    });
  }

  // -------------------------------------------------------------------------
  // start
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    this.started = true;
    const config = this.deps.config;

    for (const [, state] of this.states) {
      const { job } = state;

      // Evaluate enabled predicate (default: true)
      state.enabled = job.enabled ? job.enabled(config) : true;
      this.deps.logger.info(
        { job: job.name, enabled: state.enabled },
        state.enabled ? "background job started" : "background job skipped (disabled by config)",
      );
      if (!state.enabled) continue;

      // Schedule ticks first so the timer slot is ready before any in-flight
      // kick (below) may resolve and try to re-schedule.
      this.scheduleNext(state);

      // kickAtStart: route through kick() so the startup run is tracked by
      // inFlight — concurrent timer-driven runs wait rather than racing it,
      // and adaptive nextDelayMs from the first run is honored.
      if (job.kickAtStart) {
        // kick()'s inner .catch sets state.lastError and re-throws. This outer
        // .catch catches that re-throw and logs it at startup — the two handlers
        // serve different purposes (state tracking vs startup log) and are both
        // needed. The void-expression silences the unhandled-rejection linter.
        void this.kick(job.name).catch((err: unknown) => {
          this.deps.logger.warn({ err, job: job.name }, "kickAtStart failed");
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // kick
  // -------------------------------------------------------------------------

  kick(name: string): Promise<void> {
    const state = this.states.get(name);
    if (!state) {
      return Promise.reject(new Error(`BackgroundJobRunner: unknown job "${name}"`));
    }
    if (!state.enabled) {
      return Promise.resolve();
    }

    // Single-flight: return existing in-flight if present
    if (state.inFlight) {
      return state.inFlight;
    }

    const startedAt = Date.now();
    const ctx = this.buildContext(state);

    const promise = state.job
      .run(ctx)
      .then((result) => {
        state.lastError = null;
        if (state.job.schedule.type === "adaptive" && result && result.nextDelayMs !== undefined) {
          const { minMs, maxMs } = state.job.schedule;
          state.lastDelayMs = Math.min(Math.max(result.nextDelayMs, minMs), maxMs);
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        state.lastError = msg;
        this.deps.logger.warn({ err, job: state.job.name }, "job run failed");
        throw err;
      })
      .finally(() => {
        const now = Date.now();
        state.lastRunAt = startedAt;
        state.lastDurationMs = now - startedAt;
        state.inFlight = null;
      });

    state.inFlight = promise;
    return promise;
  }

  // -------------------------------------------------------------------------
  // stop
  // -------------------------------------------------------------------------

  stop(): Promise<void> {
    // Idempotent: calling stop() twice is a no-op.
    if (!this.started) {
      return Promise.resolve();
    }

    // Set started = false FIRST so adaptive .finally() reschedule guards
    // (if (this.started) scheduleNext(state)) see the stopped state even
    // if an in-flight kick resolves after this call returns.
    this.started = false;

    // Clear all pending timers
    for (const [, state] of this.states) {
      if (state.timer !== null) {
        clearInterval(state.timer as ReturnType<typeof setInterval>);
        clearTimeout(state.timer as ReturnType<typeof setTimeout>);
        state.timer = null;
      }
    }

    // Await in-flight runs to completion — graceful, not coercive.
    const inFlight = [...this.states.values()]
      .map((s) => s.inFlight)
      .filter((p): p is Promise<void> => p !== null);

    const stopHooks = [...this.states.values()]
      .filter((s) => s.job.onStop)
      .map((s) => s.job.onStop!().catch((err: unknown) => {
        this.deps.logger.warn({ err, job: s.job.name }, "onStop failed");
      }));

    return Promise.all([
      ...inFlight.map((p) => p.catch(() => {})),
      ...stopHooks,
    ]).then(() => {});
  }

  // -------------------------------------------------------------------------
  // status
  // -------------------------------------------------------------------------

  status(): JobStatus[] {
    return [...this.states.values()].map((s) => ({
      name: s.job.name,
      enabled: s.enabled,
      inFlight: s.inFlight !== null,
      lastRunAt: s.lastRunAt,
      lastDurationMs: s.lastDurationMs,
      lastError: s.lastError,
      nextRunAt: s.nextRunAt,
    }));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildContext(state: JobState): JobContext {
    return {
      taskAgent: this.deps.taskAgent,
      runner: this.deps.runner,
      runtime: this.deps.runtime,
      eventBus: this.deps.eventBus,
      logger: this.deps.logger.child({ job: state.job.name }),
      kick: (name: string) => this.kick(name),
      lastDelayMs: state.lastDelayMs,
    };
  }

  private scheduleNext(state: JobState): void {
    const { job } = state;
    const schedule: Schedule = job.schedule;

    if (schedule.type === "interval") {
      state.timer = setInterval(() => {
        state.nextRunAt = null;
        void this.kick(job.name).catch(() => {});
      }, schedule.ms);
      state.nextRunAt = Date.now() + schedule.ms;
    } else {
      // Adaptive: chain via setTimeout
      const delay = state.lastDelayMs;
      state.nextRunAt = Date.now() + delay;
      state.timer = setTimeout(() => {
        state.timer = null;
        state.nextRunAt = null;
        this.kick(job.name)
          .catch(() => {})
          .finally(() => {
            // Reschedule only if runner hasn't been stopped
            if (state.enabled && this.started) {
              this.scheduleNext(state);
            }
          });
      }, delay);
    }
  }
}
