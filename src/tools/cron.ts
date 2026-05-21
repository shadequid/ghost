/** CronTool — LLM interface for scheduling tasks. */

import { Type, type Static } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { CronService } from "../scheduler/service.js";
import type { CronSchedule } from "../scheduler/types.js";
import type { OriginAware, CronAware } from "./context-aware.js";
import type { TimezoneService } from "../services/timezone.js";

const CronSchema = Type.Object({
  action: Type.Union([
    Type.Literal("add"),
    Type.Literal("list"),
    Type.Literal("remove"),
  ], { description: "Action to perform" }),
  message: Type.Optional(Type.String({ description: "Task instruction (required for add)" })),
  every_seconds: Type.Optional(Type.Number({ description: "Recurring interval in seconds", minimum: 1 })),
  cron_expr: Type.Optional(Type.String({ description: "Cron expression (e.g. '0 9 * * *')" })),
  tz: Type.Optional(Type.String({ description: "IANA timezone (e.g. 'America/New_York')" })),
  at: Type.Optional(Type.String({ description: "ISO datetime for one-time execution" })),
  job_id: Type.Optional(Type.String({ description: "Job ID (required for remove)" })),
});

export class CronTool implements AgentTool<typeof CronSchema>, OriginAware, CronAware {
  readonly name = "cron";
  readonly label = "Cron";
  readonly description = "Schedule reminders and recurring tasks. Actions: add, list, remove.";
  readonly parameters = CronSchema;

  private _channel: string | null = null;
  private _chatId: string | null = null;
  private _inCron = false;

  constructor(private readonly service: CronService, private readonly tzService: TimezoneService) {}

  setOrigin(channel: string, chatId: string): void {
    // Map empty strings to null so downstream null-checks work correctly.
    // The fields are typed `string | null` and callers may pass "" to clear.
    this._channel = channel || null;
    this._chatId = chatId || null;
  }

  enterCron(): void {
    this._inCron = true;
  }

  exitCron(): void {
    this._inCron = false;
  }

  async execute(
    _toolCallId: string,
    params: Static<typeof CronSchema>,
  ): Promise<AgentToolResult<Record<string, unknown>>> {
    switch (params.action) {
      case "add":
        return this.addJob(params);
      case "list":
        return this.listJobs();
      case "remove":
        return this.removeJob(params.job_id);
    }
  }

  private addJob(params: Static<typeof CronSchema>): AgentToolResult<Record<string, unknown>> {
    if (this._inCron) {
      return this.error("Cannot schedule tasks from within a cron job.");
    }
    if (!params.message) {
      return this.error("Message is required for add action.");
    }

    let schedule: CronSchedule;
    let deleteAfterRun = false;

    if (params.every_seconds) {
      schedule = { kind: "every", everyMs: params.every_seconds * 1000 };
    } else if (params.cron_expr) {
      // Live-read TZ so changes from the web UI take effect without daemon restart.
      schedule = { kind: "cron", expr: params.cron_expr, tz: params.tz ?? this.tzService.get() };
    } else if (params.at) {
      const atMs = new Date(params.at).getTime();
      if (isNaN(atMs)) return this.error(`Invalid datetime: ${params.at}`);
      if (atMs <= Date.now()) return this.error("Scheduled time must be in the future.");
      schedule = { kind: "at", atMs };
      deleteAfterRun = true;
    } else {
      return this.error("Provide every_seconds, cron_expr, or at.");
    }

    const job = this.service.addJob({
      name: params.message.slice(0, 50),
      schedule,
      message: params.message,
      deliver: true,
      channel: this._channel ?? undefined,
      to: this._chatId ?? undefined,
      deleteAfterRun,
    });

    return this.ok(`Scheduled: "${job.name}" (id: ${job.id})`);
  }

  private listJobs(): AgentToolResult<Record<string, unknown>> {
    const jobs = this.service.listJobs();
    if (jobs.length === 0) return this.ok("No scheduled tasks.");

    const lines = jobs.map(j => {
      const timing = j.schedule.kind === "every"
        ? `every ${(j.schedule.everyMs ?? 0) / 1000}s`
        : j.schedule.kind === "cron"
          ? `cron: ${j.schedule.expr}`
          : `at: ${new Date(j.schedule.atMs ?? 0).toISOString()}`;
      const next = j.state.nextRunAtMs
        ? `next: ${new Date(j.state.nextRunAtMs).toISOString()}`
        : "no next run";
      return `- ${j.name} (${j.id}) — ${timing} — ${next}`;
    });

    return this.ok(lines.join("\n"));
  }

  private removeJob(jobId?: string): AgentToolResult<Record<string, unknown>> {
    if (!jobId) return this.error("job_id is required for remove action.");
    const removed = this.service.removeJob(jobId);
    return removed ? this.ok(`Removed job ${jobId}.`) : this.error(`Job ${jobId} not found.`);
  }

  private ok(text: string): AgentToolResult<Record<string, unknown>> {
    return { content: [{ type: "text", text }], details: {} };
  }

  private error(text: string): AgentToolResult<Record<string, unknown>> {
    return { content: [{ type: "text", text: `Error: ${text}` }], details: {} };
  }
}
