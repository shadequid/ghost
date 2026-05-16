/**
 * Morning briefing tool — manage scheduled daily briefing.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import type { CronService } from "../../scheduler/service.js";
import { textResult, errorResult } from "../../helpers/result.js";
import { BRIEFING_PROMPT } from "../../scheduler/defaults.js";

const BRIEFING_JOB_NAME = "morning-briefing";

export function createMorningBriefingTool(cronService: CronService): AnyAgentTool {
  return {
    name: "ghost_morning_briefing",
    label: "Morning Briefing Schedule",
    description: "Manage scheduled morning briefing. Enable/disable/set time for daily auto-briefing.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("enable"),
        Type.Literal("disable"),
        Type.Literal("status"),
        Type.Literal("set_time"),
      ], { description: "Action: enable, disable, status, or set_time" }),
      time: Type.Optional(Type.String({ description: "Time in HH:MM format (24h). Default: 08:00" })),
      timezone: Type.Optional(Type.String({ description: "IANA timezone. Default: UTC" })),
    }),
    async execute(_toolCallId, params) {
      try {
        switch (params.action) {
          case "enable": {
            const existing = cronService.listJobs(true).find((j) => j.name === BRIEFING_JOB_NAME);
            if (existing) cronService.removeJob(existing.id);

            const time = params.time ?? "08:00";
            const tz = params.timezone ?? "UTC";
            const [hours, minutes] = time.split(":").map(Number);
            if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
              return errorResult(`Invalid time format: ${time}. Use HH:MM (24h).`);
            }
            const cronExpr = `${minutes} ${hours} * * *`;

            cronService.addJob({
              name: BRIEFING_JOB_NAME,
              schedule: { kind: "cron", expr: cronExpr, tz },
              message: BRIEFING_PROMPT,
              deliver: true,
            });

            return textResult(`Morning briefing enabled at ${time} (${tz}). I'll brief you daily.`);
          }

          case "disable": {
            const job = cronService.listJobs(true).find((j) => j.name === BRIEFING_JOB_NAME);
            if (!job) return textResult("Morning briefing is not currently scheduled.");
            // Use enableJob(false) rather than removeJob so the next daemon start
            // doesn't re-seed the job — seedDefaultJobs skips by name, not enabled state.
            cronService.enableJob(job.id, false);
            return textResult("Morning briefing disabled.");
          }

          case "status": {
            const job = cronService.listJobs(true).find((j) => j.name === BRIEFING_JOB_NAME);
            if (!job) return textResult("Morning briefing: not scheduled.");
            const next = job.state.nextRunAtMs
              ? new Date(job.state.nextRunAtMs).toISOString()
              : "none";
            return textResult([
              "Morning Briefing Status",
              "\u2500".repeat(30),
              `Enabled: ${job.enabled}`,
              `Schedule: ${job.schedule.expr ?? "unknown"}`,
              `Timezone: ${job.schedule.tz ?? "UTC"}`,
              `Next run: ${next}`,
            ].join("\n"));
          }

          case "set_time": {
            if (!params.time) return errorResult("Time is required for set_time action. Use HH:MM format.");
            const job = cronService.listJobs(true).find((j) => j.name === BRIEFING_JOB_NAME);
            if (!job) return errorResult("Morning briefing is not enabled. Enable it first.");

            const time = params.time;
            const tz = params.timezone ?? job.schedule.tz ?? "UTC";
            const [hours, minutes] = time.split(":").map(Number);
            if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
              return errorResult(`Invalid time format: ${time}. Use HH:MM (24h).`);
            }

            cronService.removeJob(job.id);
            const cronExpr = `${minutes} ${hours} * * *`;
            cronService.addJob({
              name: BRIEFING_JOB_NAME,
              schedule: { kind: "cron", expr: cronExpr, tz },
              message: job.payload.message,
              deliver: true,
            });

            return textResult(`Morning briefing time updated to ${time} (${tz}).`);
          }

          default:
            return errorResult(`Unknown action: ${params.action as string}`);
        }
      } catch (e: unknown) {
        return errorResult(e instanceof Error ? e.message : String(e));
      }
    },
  };
}
