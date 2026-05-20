/**
 * Gateway RPC methods for reading and updating the user's timezone.
 *
 * `config.timezone.set` also re-tags built-in default cron jobs so their
 * nextRun timestamps reflect the new timezone within the same request.
 */

import type { MethodHandler } from "./method-registry.js";
import type { TimezoneService } from "../services/timezone.js";
import type { CronService } from "../scheduler/service.js";

export interface ConfigMethodDeps {
  timezoneService: TimezoneService;
  cronService: CronService;
}

export function registerConfigMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: ConfigMethodDeps,
): void {
  register("config.timezone.get", async () => ({
    tz: deps.timezoneService.get(),
  }));

  register("config.timezone.set", async (_ctx, payload) => {
    const p = payload as { tz?: unknown };
    const result = deps.timezoneService.set(p.tz);
    if (!result.ok) {
      return { ok: false as const, error: result.error };
    }
    // Update built-in default jobs only — user-created jobs are untouched.
    const updatedJobs = deps.cronService.updateBuiltinJobsTimezone(result.tz);
    return { ok: true as const, tz: result.tz, updatedJobs };
  });
}
