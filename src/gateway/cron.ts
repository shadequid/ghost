
import type { MethodHandler } from "./method-registry.js";
import type { CronService } from "../scheduler/service.js";
import type { CronJob, CronSchedule } from "../scheduler/types.js";

function formatJob(job: CronJob): Record<string, unknown> {
  const schedule = job.schedule.kind === "every"
    ? `every:${job.schedule.everyMs}ms`
    : job.schedule.kind === "cron"
      ? job.schedule.expr ?? ""
      : `at:${job.schedule.atMs ? new Date(job.schedule.atMs).toISOString() : ""}`;
  return {
    id: job.id,
    name: job.name,
    schedule,
    command: job.payload.message,
    enabled: job.enabled,
    last_run: job.state.lastRunAtMs ? new Date(job.state.lastRunAtMs).toISOString() : null,
    next_run: job.state.nextRunAtMs ? new Date(job.state.nextRunAtMs).toISOString() : null,
    last_status: job.state.lastStatus,
  };
}

function parseSchedule(str: string): CronSchedule {
  if (str.startsWith("every:")) {
    const ms = parseInt(str.slice(6), 10);
    if (isNaN(ms) || ms <= 0) throw new Error(`Invalid interval: ${str}`);
    return { kind: "every", everyMs: ms };
  }
  if (str.startsWith("at:")) {
    const atMs = new Date(str.slice(3)).getTime();
    if (isNaN(atMs)) throw new Error(`Invalid datetime: ${str}`);
    return { kind: "at", atMs };
  }
  return { kind: "cron", expr: str };
}

export function registerCronMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: { cronService: CronService },
): void {
  register("cron.list", async () => ({
    jobs: deps.cronService.listJobs(true).map(formatJob),
  }));

  register("cron.status", async () => deps.cronService.status());

  register("cron.add", async (_ctx, payload) => {
    const p = payload as { name?: string; schedule?: string; command?: string; message?: string; enabled?: boolean };
    if (!p?.schedule?.trim()) throw new Error("schedule is required");
    // Accept both "command" and "message" field names
    const command = p.command?.trim() ?? p.message?.trim();
    if (!command) throw new Error("command is required");
    const schedule = parseSchedule(p.schedule.trim());
    const job = deps.cronService.addJob({
      name: p.name?.trim() ?? `job-${crypto.randomUUID().slice(0, 8)}`,
      schedule,
      message: command,
    });
    return { job: formatJob(job) };
  });

  register("cron.remove", async (_ctx, payload) => {
    const p = payload as { jobId?: string };
    if (!p?.jobId) throw new Error("jobId is required");
    const removed = deps.cronService.removeJob(p.jobId);
    return { removed };
  });

  register("cron.run", async (ctx, payload) => {
    const p = payload as { jobId?: string; mode?: "due" | "force" };
    if (!p?.jobId) throw new Error("jobId is required");
    const force = (p.mode ?? "force") !== "due";
    await deps.cronService.runJob(p.jobId, force);
    ctx.broadcast("cron.executed", { jobId: p.jobId });
    return { ok: true };
  });
}
