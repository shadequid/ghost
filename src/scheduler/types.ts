/** Cron job types. JSON-serializable. */

export interface CronSchedule {
  kind: "at" | "every" | "cron";
  atMs?: number;       // one-time: epoch ms
  everyMs?: number;    // interval: ms between runs
  expr?: string;       // cron: "0 9 * * *"
  tz?: string;         // cron: IANA timezone
}

export interface CronPayload {
  kind: "agent_turn";
  message: string;     // instruction for agent
  deliver: boolean;    // deliver response to user?
  channel?: string;    // delivery channel
  to?: string;         // delivery target (chatId)
}

export interface CronRunRecord {
  runAtMs: number;
  status: "ok" | "error";
  durationMs: number;
  error?: string;
}

export interface CronJobState {
  nextRunAtMs: number | null;
  lastRunAtMs: number | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  runHistory: CronRunRecord[];
}

export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
  createdAtMs: number;
  updatedAtMs: number;
  deleteAfterRun: boolean;
}
