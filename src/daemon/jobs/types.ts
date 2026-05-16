/**
 * BackgroundJob registry types.
 *
 * A BackgroundJob is a named, self-contained polling unit with an explicit
 * schedule (fixed-interval or adaptive) and optional lifecycle hooks.
 * The runner enforces single-flight per job and supports cross-job triggering
 * via ctx.kick(name).
 */

import type { Agent } from "@mariozechner/pi-agent-core";
import type { Logger } from "pino";
import type { Runtime } from "../../runtime.js";
import type { EventBus } from "../../bus/events.js";
import type { Config } from "../../config/schema.js";
import type { Runner } from "../../agent/runner.js";

// ---------------------------------------------------------------------------
// Schedule variants
// ---------------------------------------------------------------------------

export type Schedule =
  | { type: "interval"; ms: number }
  | { type: "adaptive"; initialMs: number; minMs: number; maxMs: number };

// ---------------------------------------------------------------------------
// Job context — injected per run by the runner
// ---------------------------------------------------------------------------

export interface JobContext {
  taskAgent: Agent;
  runner: Runner;
  runtime: Runtime;
  eventBus: EventBus;
  logger: Logger;
  /**
   * Trigger another registered job to run immediately.
   * No-op (returns existing in-flight promise) if the job is already running.
   */
  kick: (jobName: string) => Promise<void>;
  /**
   * For adaptive jobs: the delay that was used for the previous tick.
   * Useful for exponential-backoff math when run() wants to double the interval.
   */
  lastDelayMs?: number;
}

// ---------------------------------------------------------------------------
// Job result
// ---------------------------------------------------------------------------

export interface JobResult {
  /**
   * For adaptive schedule only — override the delay until the next run.
   * Runner clamps to [minMs, maxMs]. Omitting this reuses the last delay.
   */
  nextDelayMs?: number;
}

// ---------------------------------------------------------------------------
// Job definition
// ---------------------------------------------------------------------------

export interface BackgroundJob {
  name: string;
  schedule: Schedule;
  /** Return false to skip registration (evaluated once at start). */
  enabled?: (config: Config) => boolean;
  /**
   * When true, the runner calls kick(name) immediately at start() — before the
   * first scheduled tick fires. The kick goes through the standard single-flight
   * machinery so concurrent timer-driven runs wait for it rather than racing it.
   * For adaptive jobs, the result (nextDelayMs) from the startup kick is honored.
   */
  kickAtStart?: boolean;
  /**
   * Periodic execution. Each job owns its own try/catch — the runner
   * schedules but does NOT wrap run() in a try/catch (to keep error handling
   * intent explicit).
   * Cancellation is graceful: stop() awaits in-flight completion; jobs are
   * not required to check any abort signal.
   */
  run: (ctx: JobContext) => Promise<JobResult | void>;
  /** Optional cleanup called during runner.stop(). */
  onStop?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Status snapshot
// ---------------------------------------------------------------------------

export interface JobStatus {
  name: string;
  enabled: boolean;
  inFlight: boolean;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: number | null;
}
