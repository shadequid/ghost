/** CronService — JSON file-backed scheduler with async timer. */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { CronExpressionParser } from "cron-parser";
import type { CronJob, CronSchedule, CronRunRecord } from "./types.js";
import { BUILT_IN_JOBS, type DefaultJobSpec } from "./defaults.js";

const MAX_HISTORY = 20;
const MIN_INTERVAL_MS = 10_000;

function computeNextRun(schedule: CronSchedule, nowMs: number): number | null {
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

export class CronService {
  private store: { version: number; jobs: CronJob[] } = { version: 1, jobs: [] };
  private lastMtime = 0;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private _running = false;
  private onJob?: (job: CronJob) => Promise<string | null>;

  constructor(private readonly storePath: string) {}

  /** Set job execution callback (called post-construction when agent is ready). */
  setOnJob(fn: (job: CronJob) => Promise<string | null>): void {
    this.onJob = fn;
  }

  /**
   * Start the scheduler.
   *
   * `defaults` — list of built-in job specs to seed on first start.
   * Pass `[]` in tests to opt out of seeding (keeps tests hermetic).
   * Omit entirely in production to use `BUILT_IN_JOBS` (the default).
   */
  start(opts: { defaults?: ReadonlyArray<DefaultJobSpec> } = {}): void {
    this._running = true;
    this.loadStore();
    this.seedDefaultJobs(opts.defaults ?? BUILT_IN_JOBS);
    const now = Date.now();
    for (const job of this.store.jobs) {
      if (!job.enabled) continue;
      // Skip-on-miss: any cron/at job whose nextRunAtMs already elapsed while the
      // daemon was offline must NOT replay on startup. Advance the timestamp to
      // the next future occurrence (cron) or drop it (at). 'every' intervals are
      // left untouched — their cadence is now+everyMs by construction.
      if (
        job.state.nextRunAtMs !== null &&
        job.state.nextRunAtMs <= now &&
        (job.schedule.kind === "cron" || job.schedule.kind === "at")
      ) {
        job.state.nextRunAtMs = computeNextRun(job.schedule, now);
      } else if (!job.state.nextRunAtMs) {
        job.state.nextRunAtMs = computeNextRun(job.schedule, now);
      }
    }
    this.saveStore();
    this.armTimer();
  }

  stop(): void {
    this._running = false;
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  listJobs(includeDisabled = false): CronJob[] {
    this.loadStore();
    const jobs = includeDisabled
      ? this.store.jobs
      : this.store.jobs.filter(j => j.enabled);
    return jobs.sort((a, b) => (a.state.nextRunAtMs ?? Infinity) - (b.state.nextRunAtMs ?? Infinity));
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
    this.loadStore();
    const now = Date.now();
    const job: CronJob = {
      id: crypto.randomUUID().slice(0, 8),
      name: opts.name,
      enabled: true,
      schedule: opts.schedule,
      payload: {
        kind: "agent_turn",
        message: opts.message,
        deliver: opts.deliver ?? true,
        channel: opts.channel,
        to: opts.to,
      },
      state: {
        nextRunAtMs: computeNextRun(opts.schedule, now),
        lastRunAtMs: null,
        lastStatus: null,
        lastError: null,
        runHistory: [],
      },
      createdAtMs: now,
      updatedAtMs: now,
      deleteAfterRun: opts.deleteAfterRun ?? false,
    };
    this.store.jobs.push(job);
    this.saveStore();
    this.armTimer();
    return job;
  }

  removeJob(jobId: string): boolean {
    this.loadStore();
    const idx = this.store.jobs.findIndex(j => j.id === jobId);
    if (idx === -1) return false;
    this.store.jobs.splice(idx, 1);
    this.saveStore();
    this.armTimer();
    return true;
  }

  enableJob(jobId: string, enabled: boolean): void {
    this.loadStore();
    const job = this.store.jobs.find(j => j.id === jobId);
    if (!job) return;
    job.enabled = enabled;
    if (enabled) {
      job.state.nextRunAtMs = computeNextRun(job.schedule, Date.now());
    } else {
      job.state.nextRunAtMs = null;
    }
    job.updatedAtMs = Date.now();
    this.saveStore();
    this.armTimer();
  }

  async runJob(jobId: string, force = false): Promise<void> {
    this.loadStore();
    const job = this.store.jobs.find(j => j.id === jobId);
    if (!job) return;
    if (!job.enabled && !force) return;
    await this.executeJob(job);
    this.saveStore();
    this.armTimer();
  }

  getJob(jobId: string): CronJob | undefined {
    this.loadStore();
    return this.store.jobs.find(j => j.id === jobId);
  }

  status(): { enabled: boolean; jobs: number; nextWakeAtMs: number | null } {
    this.loadStore();
    return {
      enabled: this._running,
      jobs: this.store.jobs.filter(j => j.enabled).length,
      nextWakeAtMs: this.getNextWakeMs(),
    };
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Add each spec whose `name` is not already present in the store.
   * Idempotent — repeated daemon starts never duplicate built-in jobs.
   * A job that exists but is disabled (user turned off morning-briefing)
   * is intentionally left alone — we only skip by name, not by enabled state.
   */
  private seedDefaultJobs(specs: ReadonlyArray<DefaultJobSpec>): void {
    const existingNames = new Set(this.store.jobs.map((j) => j.name));
    let dirty = false;
    const now = Date.now();
    for (const spec of specs) {
      if (existingNames.has(spec.name)) continue;
      const job: CronJob = {
        id: crypto.randomUUID().slice(0, 8),
        name: spec.name,
        enabled: true,
        schedule: spec.schedule,
        payload: {
          kind: "agent_turn",
          message: spec.message,
          deliver: spec.deliver,
        },
        state: {
          nextRunAtMs: computeNextRun(spec.schedule, now),
          lastRunAtMs: null,
          lastStatus: null,
          lastError: null,
          runHistory: [],
        },
        createdAtMs: now,
        updatedAtMs: now,
        deleteAfterRun: false,
      };
      this.store.jobs.push(job);
      dirty = true;
    }
    if (dirty) this.saveStore();
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

    job.state.lastRunAtMs = startMs;
    job.state.lastStatus = status;
    job.state.lastError = error ?? null;
    job.state.runHistory.push(record);
    if (job.state.runHistory.length > MAX_HISTORY) {
      job.state.runHistory = job.state.runHistory.slice(-MAX_HISTORY);
    }

    // Handle one-shot jobs
    if (job.schedule.kind === "at") {
      if (job.deleteAfterRun) {
        const idx = this.store.jobs.indexOf(job);
        if (idx >= 0) this.store.jobs.splice(idx, 1);
      } else {
        job.enabled = false;
        job.state.nextRunAtMs = null;
      }
    } else {
      job.state.nextRunAtMs = computeNextRun(job.schedule, Date.now());
    }

    job.updatedAtMs = Date.now();
  }

  private getNextWakeMs(): number | null {
    let earliest: number | null = null;
    for (const job of this.store.jobs) {
      if (job.enabled && job.state.nextRunAtMs) {
        if (earliest === null || job.state.nextRunAtMs < earliest) {
          earliest = job.state.nextRunAtMs;
        }
      }
    }
    return earliest;
  }

  private armTimer(): void {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
    if (!this._running) return;

    const nextMs = this.getNextWakeMs();
    if (nextMs === null) return;

    const delayMs = Math.max(nextMs - Date.now(), 0);
    this.timerHandle = setTimeout(() => this.onTimer(), delayMs);
  }

  private async onTimer(): Promise<void> {
    if (!this._running) return;
    this.loadStore();

    const now = Date.now();
    const due = this.store.jobs.filter(
      j => j.enabled && j.state.nextRunAtMs !== null && j.state.nextRunAtMs <= now,
    );

    for (const job of due) {
      await this.executeJob(job);
    }

    this.saveStore();
    this.armTimer();
  }

  private loadStore(): void {
    if (!existsSync(this.storePath)) return;
    try {
      const stat = statSync(this.storePath);
      const mtime = stat.mtimeMs;
      if (mtime === this.lastMtime && this.store.jobs.length > 0) return;

      const raw = readFileSync(this.storePath, "utf-8");
      const parsed = JSON.parse(raw) as { version: number; jobs: CronJob[] };
      this.store = parsed;
      this.lastMtime = mtime;
    } catch {
      // Parse error or missing file — keep current store
    }
  }

  private saveStore(): void {
    mkdirSync(dirname(this.storePath), { recursive: true });
    writeFileSync(this.storePath, JSON.stringify(this.store, null, 2));
    try {
      this.lastMtime = statSync(this.storePath).mtimeMs;
    } catch { /* ignore */ }
  }
}
