/**
 * Row marshalling helpers and prepared-statement interface for CronService.
 *
 * Extracted here to keep service.ts under a manageable line count —
 * the prepared-statement boilerplate accounts for the bulk of the LOC.
 * Only service.ts imports these; they are not part of the scheduler's
 * public API.
 */

import type { Statement } from "bun:sqlite";
import type { CronJob, CronSchedule, CronRunRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Internal row shape from the DB
// ---------------------------------------------------------------------------

export interface Row {
  id: string;
  name: string;
  enabled: number;
  schedule_kind: string;
  schedule_at_ms: number | null;
  schedule_every_ms: number | null;
  schedule_expr: string | null;
  schedule_tz: string | null;
  payload_kind: string;
  payload_message: string;
  payload_deliver: number;
  payload_channel: string | null;
  payload_to: string | null;
  next_run_at_ms: number | null;
  last_run_at_ms: number | null;
  last_status: string | null;
  last_error: string | null;
  run_history: string;
  created_at_ms: number;
  updated_at_ms: number;
  delete_after_run: number;
}

// ---------------------------------------------------------------------------
// Prepared statement cache
// ---------------------------------------------------------------------------

export interface Stmts {
  selectAll: Statement;
  selectById: Statement;
  selectByName: Statement;
  insert: Statement;
  updateFull: Statement;
  updateNext: Statement;
  updateTzAndNext: Statement;
  updateEnabled: Statement;
  delete: Statement;
}

// ---------------------------------------------------------------------------
// Row ↔ domain type helpers
// ---------------------------------------------------------------------------

export function scheduleFromRow(row: Row): CronSchedule {
  switch (row.schedule_kind) {
    case "at":
      return { kind: "at", atMs: row.schedule_at_ms ?? undefined };
    case "every":
      return { kind: "every", everyMs: row.schedule_every_ms ?? undefined };
    case "cron":
      return {
        kind: "cron",
        expr: row.schedule_expr ?? undefined,
        tz: row.schedule_tz ?? undefined,
      };
    default:
      return { kind: "cron" };
  }
}

export function rowToJob(row: Row): CronJob {
  let runHistory: CronRunRecord[] = [];
  try {
    runHistory = JSON.parse(row.run_history) as CronRunRecord[];
  } catch {
    // Corrupted JSON — start fresh
  }
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    schedule: scheduleFromRow(row),
    payload: {
      kind: "agent_turn",
      message: row.payload_message,
      deliver: row.payload_deliver === 1,
      channel: row.payload_channel ?? undefined,
      to: row.payload_to ?? undefined,
    },
    state: {
      nextRunAtMs: row.next_run_at_ms,
      lastRunAtMs: row.last_run_at_ms,
      lastStatus: (row.last_status as "ok" | "error" | null) ?? null,
      lastError: row.last_error,
      runHistory,
    },
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    deleteAfterRun: row.delete_after_run === 1,
  };
}

export function scheduleBindings(s: CronSchedule): {
  schedule_kind: string;
  schedule_at_ms: number | null;
  schedule_every_ms: number | null;
  schedule_expr: string | null;
  schedule_tz: string | null;
} {
  return {
    schedule_kind: s.kind,
    schedule_at_ms: s.atMs ?? null,
    schedule_every_ms: s.everyMs ?? null,
    schedule_expr: s.expr ?? null,
    schedule_tz: s.tz ?? null,
  };
}
