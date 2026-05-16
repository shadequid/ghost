/**
 * Background-job wrapper for the unified observer loop.
 *
 * Thin adapter — registration glue between the BackgroundJobRunner and the
 * `ObserverLoop` instance constructed in runtime.ts. The real work lives in
 * `src/observer/loop.ts`. Keep this file boring.
 *
 * Schedule: 60s fixed interval (configurable via `observer.tickMs`). Defers
 * the first tick so the daemon can fully boot before the first HL call.
 */

import type { BackgroundJob, JobContext } from "./types.js";

/**
 * Static fallback used when this module is imported in a context where the
 * config is not yet known (job registration). Runtime reads
 * `config.observer.tickMs` and adjusts the actual interval — see the
 * BackgroundJobRunner schedule overrides; jobs read their schedule at
 * registration time, so we expose a factory below for the few callers that
 * need a config-bound instance.
 */
const DEFAULT_TICK_MS = 60_000;

export const observerJob: BackgroundJob = {
  name: "observer",
  schedule: { type: "interval", ms: DEFAULT_TICK_MS },
  enabled: (config) => config.observer.enabled,
  // Fire immediately at startup so operators see one observer tick log right
  // away. The first tick after a fresh boot seeds the baseline snapshot;
  // any LLM call it generates is the regular per-tick cost (capped at one
  // call) so the early signal is worth it.
  kickAtStart: true,

  async run({ runtime }: JobContext): Promise<void> {
    await runtime.observerLoop.tick();
  },
};

/**
 * Factory that returns the observer job bound to `config.observer.tickMs`.
 * Use this when the caller has the live Config in hand (job registration in
 * daemon startup); falls back to the static export if cadence is irrelevant.
 */
export function buildObserverJob(tickMs: number): BackgroundJob {
  return {
    ...observerJob,
    schedule: { type: "interval", ms: tickMs > 0 ? tickMs : DEFAULT_TICK_MS },
  };
}
