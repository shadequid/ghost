/**
 * CronService — SQLite-backed scheduler with async timer.
 *
 * Storage: `cron_jobs` table (see migration registry). All mutations are
 * wrapped in db.transaction() for atomicity. bun:sqlite is serialized so
 * no extra locking is needed beyond the transaction boundary.
 *
 * The run-history for each job is kept as a JSON column on the job row
 * (capped at MAX_HISTORY entries). Keeping it in-row avoids joins while
 * history queries remain uncommon.
 */

import { CronExpressionParser } from "cron-parser";
import type { Database } from "bun:sqlite";
import type { CronJob, CronSchedule, CronRunRecord } from "./types.js";
import type { DefaultJobSpec } from "./defaults.js";
import {
  type Row,
  type Stmts,
  scheduleFromRow,
  rowToJob,
  scheduleBindings,
} from "./storage.js";

const MAX_HISTORY = 20;
const MIN_INTERVAL_MS = 10_000;

// ---------------------------------------------------------------------------
// computeNextRun — pure function, same semantics as the old service
// ---------------------------------------------------------------------------

export function computeNextRun(schedule: CronSchedule, nowMs: number): number | null {
  switch (schedule.kind) {
    case "at":
      return schedule.atMs && schedule.atMs > nowMs ? schedule.atMs : null;
    case "every": {
      const ms = Math.max(schedule.everyMs ?? 0, MIN_INTERVAL_MS);
      return ms > 0 ? nowMs + ms : null;
    }
    case "cron": {
      if (!schedule.expr) return null;
      try {
        const opts: { tz?: string; currentDate?: Date } = {};
        if (schedule.tz) opts.tz = schedule.tz;
        opts.currentDate = new Date(nowMs);
        const interval = CronExpressionParser.parse(schedule.expr, opts);
        return interval.next().getTime();
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// CronService
// ---------------------------------------------------------------------------

export class CronService {
  private readonly stmts: Stmts;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private _running = false;
  private onJob?: (job: CronJob) => Promise<string | null>;

  // Names that identify the two built-in default jobs.
  private static readonly DEFAULT_JOB_NAMES = ["morning-briefing", "evening-recap"];

  constructor(private readonly db: Database) {
    this.stmts = {
      selectAll: db.prepare("SELECT * FROM cron_jobs"),
      selectById: db.prepare("SELECT * FROM cron_jobs WHERE id = ?"),
      selectByName: db.prepare("SELECT * FROM cron_jobs WHERE name = ?"),
      insert: db.prepare(`
        INSERT INTO cron_jobs (
          id, name, enabled,
          schedule_kind, schedule_at_ms, schedule_every_ms, schedule_expr, schedule_tz,
          payload_kind, payload_message, payload_deliver, payload_channel, payload_to,
          next_run_at_ms, last_run_at_ms, last_status, last_error,
          run_history, created_at_ms, updated_at_ms, delete_after_run
        ) VALUES (
          $id, $name, $enabled,
          $schedule_kind, $schedule_at_ms, $schedule_every_ms, $schedule_expr, $schedule_tz,
          $payload_kind, $payload_message, $payload_deliver, $payload_channel, $payload_to,
          $next_run_at_ms, NULL, NULL, NULL,
          '[]', $created_at_ms, $updated_at_ms, $delete_after_run
        )
      `),
      updateFull: db.prepare(`
        UPDATE cron_jobs SET
          last_run_at_ms = $last_run_at_ms,
          last_status    = $last_status,
          last_error     = $last_error,
          next_run_at_ms = $next_run_at_ms,
          run_history    = $run_history,
          enabled        = $enabled,
          updated_at_ms  = $updated_at_ms
        WHERE id = $id
      `),
      updateNext: db.prepare(
        "UPDATE cron_jobs SET next_run_at_ms = ?, updated_at_ms = ? WHERE id = ?",
      ),
      updateTzAndNext: db.prepare(
        "UPDATE cron_jobs SET schedule_tz = ?, next_run_at_ms = ?, updated_at_ms = ? WHERE name = ?",
      ),
      updateEnabled: db.prepare(
        "UPDATE cron_jobs SET enabled = ?, next_run_at_ms = ?, updated_at_ms = ? WHERE id = ?",
      ),
      delete: db.prepare("DELETE FROM cron_jobs WHERE id = ?"),
    };
  }

  /** Set job execution callback (called post-construction when agent is ready). */
  setOnJob(fn: (job: CronJob) => Promise<string | null>): void {
    this.onJob = fn;
  }

  /**
   * Start the scheduler.
   *
   * `defaults` — list of built-in job specs to seed on first start.
   * Pass `[]` in tests to opt out of seeding (keeps tests hermetic).
   */
  start(opts: { defaults?: ReadonlyArray<DefaultJobSpec> } = {}): void {
    this._running = true;
    this.seedDefaultJobs(opts.defaults ?? []);

    // Skip-on-miss: advance any overdue nextRunAtMs to the next future
    // occurrence. Applies to ALL schedule kinds — including "every", which
    // was previously left untouched and caused an immediate fire on restart.
    const now = Date.now();
    const rows = this.stmts.selectAll.all() as Row[];
    this.db.transaction(() => {
      for (const row of rows) {
        if (row.enabled === 1 && row.next_run_at_ms !== null && row.next_run_at_ms <= now) {
          // Only advance enabled jobs — mutating updated_at_ms on a disabled row
          // contradicts the user's intent and would pollute audit timestamps.
          const schedule = scheduleFromRow(row);
          const next = computeNextRun(schedule, now);
          this.stmts.updateNext.run(next, now, row.id);
        } else if (row.next_run_at_ms === null && row.enabled) {
          const schedule = scheduleFromRow(row);
          const next = computeNextRun(schedule, now);
          this.stmts.updateNext.run(next, now, row.id);
        }
      }
    })();

    this.scheduleNextTick();
  }

  stop(): void {
    this._running = false;
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  listJobs(includeDisabled = false): CronJob[] {
    const rows = this.stmts.selectAll.all() as Row[];
    const jobs = includeDisabled
      ? rows.map(rowToJob)
      : rows.filter((r) => r.enabled === 1).map(rowToJob);
    return jobs.sort(
      (a, b) => (a.state.nextRunAtMs ?? Infinity) - (b.state.nextRunAtMs ?? Infinity),
    );
  }

  addJob(opts: {
    name: string;
    schedule: CronSchedule;
    message: string;
    deliver?: boolean;
    channel?: string;
    to?: string;
    deleteAfterRun?: boolean;
  }): CronJob {
    const now = Date.now();
    // 12 hex chars = 48 bits of entropy; collision-safe for normal cron volumes
    const id = crypto.randomUUID().slice(0, 12);
    const sb = scheduleBindings(opts.schedule);
    try {
      this.stmts.insert.run({
        $id: id,
        $name: opts.name,
        $enabled: 1,
        ...Object.fromEntries(Object.entries(sb).map(([k, v]) => [`$${k}`, v])),
        $payload_kind: "agent_turn",
        $payload_message: opts.message,
        $payload_deliver: (opts.deliver ?? true) ? 1 : 0,
        $payload_channel: opts.channel ?? null,
        $payload_to: opts.to ?? null,
        $next_run_at_ms: computeNextRun(opts.schedule, now),
        $created_at_ms: now,
        $updated_at_ms: now,
        $delete_after_run: (opts.deleteAfterRun ?? false) ? 1 : 0,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("UNIQUE constraint failed") || msg.includes("SQLITE_CONSTRAINT")) {
        throw new Error(`Cron name already exists: ${opts.name}`);
      }
      throw err;
    }
    this.scheduleNextTick();
    const row = this.stmts.selectById.get(id) as Row;
    return rowToJob(row);
  }

  removeJob(jobId: string): boolean {
    const row = this.stmts.selectById.get(jobId) as Row | undefined;
    if (!row) return false;
    this.stmts.delete.run(jobId);
    this.scheduleNextTick();
    return true;
  }

  enableJob(jobId: string, enabled: boolean): void {
    const now = Date.now();
    const row = this.stmts.selectById.get(jobId) as Row | undefined;
    if (!row) return;
    const nextRun = enabled
      ? computeNextRun(scheduleFromRow(row), now)
      : null;
    this.stmts.updateEnabled.run(enabled ? 1 : 0, nextRun, now, jobId);
    this.scheduleNextTick();
  }

  async runJob(jobId: string, force = false): Promise<void> {
    const row = this.stmts.selectById.get(jobId) as Row | undefined;
    if (!row) return;
    const job = rowToJob(row);
    if (!job.enabled && !force) return;
    await this.executeJob(job);
  }

  getJob(jobId: string): CronJob | undefined {
    const row = this.stmts.selectById.get(jobId) as Row | undefined;
    return row ? rowToJob(row) : undefined;
  }

  status(): { enabled: boolean; jobs: number; nextTickAtMs: number | null } {
    const rows = this.stmts.selectAll.all() as Row[];
    const enabled = rows.filter((r) => r.enabled === 1);
    return {
      enabled: this._running,
      jobs: enabled.length,
      nextTickAtMs: this.getNextTickMs(),
    };
  }

  /**
   * Apply a new timezone to built-in default jobs and recompute nextRun.
   * Only touches jobs whose names match DEFAULT_JOB_NAMES and whose schedule
   * kind is "cron". User-created jobs are left untouched.
   * Returns the list of names that were updated.
   */
  updateBuiltinJobsTimezone(tz: string): string[] {
    const updated: string[] = [];
    const now = Date.now();

    this.db.transaction(() => {
      for (const name of CronService.DEFAULT_JOB_NAMES) {
        const row = this.stmts.selectByName.get(name) as Row | undefined;
        if (!row || row.schedule_kind !== "cron") continue;
        const nextRun = computeNextRun(
          { kind: "cron", expr: row.schedule_expr ?? undefined, tz },
          now,
        );
        this.stmts.updateTzAndNext.run(tz, nextRun, now, name);
        updated.push(name);
      }
    })();

    this.scheduleNextTick();
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Seed default jobs idempotently via ON CONFLICT(name) DO NOTHING.
   * A job that exists but is disabled is intentionally left alone.
   */
  private seedDefaultJobs(specs: ReadonlyArray<DefaultJobSpec>): void {
    const now = Date.now();
    this.db.transaction(() => {
      for (const spec of specs) {
        const existing = this.stmts.selectByName.get(spec.name) as Row | undefined;
        if (existing) continue;
        // 12 hex chars = 48 bits of entropy; collision-safe for normal cron volumes
        const id = crypto.randomUUID().slice(0, 12);
        const sb = scheduleBindings(spec.schedule);
        this.stmts.insert.run({
          $id: id,
          $name: spec.name,
          $enabled: 1,
          ...Object.fromEntries(Object.entries(sb).map(([k, v]) => [`$${k}`, v])),
          $payload_kind: "agent_turn",
          $payload_message: spec.message,
          $payload_deliver: spec.deliver ? 1 : 0,
          $payload_channel: null,
          $payload_to: null,
          $next_run_at_ms: computeNextRun(spec.schedule, now),
          $created_at_ms: now,
          $updated_at_ms: now,
          $delete_after_run: 0,
        });
      }
    })();
  }

  private async executeJob(job: CronJob): Promise<void> {
    const startMs = Date.now();
    let status: "ok" | "error" = "ok";
    let error: string | undefined;

    try {
      if (this.onJob) {
        await this.onJob(job);
      }
    } catch (err) {
      status = "error";
      error = err instanceof Error ? err.message : String(err);
    }

    const durationMs = Date.now() - startMs;
    const record: CronRunRecord = { runAtMs: startMs, status, durationMs, error };

    // Re-read the row after the await to pick up any schedule/TZ changes that
    // arrived while the job was executing (e.g. updateBuiltinJobsTimezone called from web UI).
    const currentRow = this.stmts.selectById.get(job.id) as Row | undefined;
    let runHistory: CronRunRecord[] = [];
    if (currentRow) {
      try {
        runHistory = JSON.parse(currentRow.run_history) as CronRunRecord[];
      } catch { /* start fresh */ }
    }
    runHistory.push(record);
    if (runHistory.length > MAX_HISTORY) {
      runHistory = runHistory.slice(-MAX_HISTORY);
    }

    // Determine next run and enabled state for one-shot jobs.
    // Use the fresh schedule from the re-read row so that a concurrent
    // updateBuiltinJobsTimezone call is not clobbered.
    let nextRunAtMs: number | null;
    let enabled = 1;

    if (job.schedule.kind === "at") {
      if (job.deleteAfterRun) {
        this.stmts.delete.run(job.id);
        this.scheduleNextTick();
        return;
      }
      enabled = 0;
      nextRunAtMs = null;
    } else {
      // Re-read schedule from DB to capture any timezone retag that happened
      // during the await window above.
      const freshSchedule = currentRow ? scheduleFromRow(currentRow) : job.schedule;
      nextRunAtMs = computeNextRun(freshSchedule, Date.now());
    }

    this.db.transaction(() => {
      this.stmts.updateFull.run({
        $last_run_at_ms: startMs,
        $last_status: status,
        $last_error: error ?? null,
        $next_run_at_ms: nextRunAtMs,
        $run_history: JSON.stringify(runHistory),
        $enabled: enabled,
        $updated_at_ms: Date.now(),
        $id: job.id,
      });
    })();

    this.scheduleNextTick();
  }

  private getNextTickMs(): number | null {
    const rows = this.stmts.selectAll.all() as Row[];
    let earliest: number | null = null;
    for (const row of rows) {
      if (row.enabled === 1 && row.next_run_at_ms !== null) {
        if (earliest === null || row.next_run_at_ms < earliest) {
          earliest = row.next_run_at_ms;
        }
      }
    }
    return earliest;
  }

  private scheduleNextTick(): void {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
    if (!this._running) return;

    const nextMs = this.getNextTickMs();
    if (nextMs === null) return;

    const delayMs = Math.max(nextMs - Date.now(), 0);
    this.timerHandle = setTimeout(() => void this.onTimer(), delayMs);
  }

  private async onTimer(): Promise<void> {
    if (!this._running) return;

    const now = Date.now();
    const rows = this.stmts.selectAll.all() as Row[];
    const due = rows.filter(
      (r) => r.enabled === 1 && r.next_run_at_ms !== null && r.next_run_at_ms <= now,
    );

    for (const row of due) {
      await this.executeJob(rowToJob(row));
    }

    this.scheduleNextTick();
  }
}
