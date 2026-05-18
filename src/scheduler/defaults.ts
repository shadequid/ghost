/**
 * Built-in default cron jobs seeded on daemon start.
 *
 * Placing defaults here — rather than in onboard or daemon — keeps seeding
 * idempotent across daemon restarts and avoids coupling the onboard wizard
 * to scheduler internals.
 */

import type { CronSchedule } from "./types.js";

/** The long-form prompt that drives the morning briefing agent turn.
 *  Exported so intel-briefing tool and delivery handler stay in sync. */
export const BRIEFING_PROMPT =
  "Run the morning briefing. Call tools to fetch the latest data: open " +
  "positions, recent fills / trade history, watchlist, news, and market " +
  "signals (funding, whale activity, fear & greed). Summarize in under 15 " +
  "sentences, in the language the user has been chatting in.";

/** The long-form prompt that drives the end-of-day recap agent turn.
 *  Exported alongside BRIEFING_PROMPT so consumers (e.g. tools, tests) stay in sync. */
export const RECAP_PROMPT =
  "Run the end-of-day recap. Call tools to fetch today's trade history and " +
  "current open positions. Summarize today's PnL, position changes (opened, " +
  "closed, scaled), and one notable market note. Brief one-liner if I had no " +
  "activity. Reply in the language the user has been chatting in.";

export interface DefaultJobSpec {
  /** Unique name — used as idempotency key; must match the job's `name` field. */
  name: string;
  schedule: CronSchedule;
  message: string;
  /** Whether the cron delivery handler should forward the result to a channel. */
  deliver: boolean;
}

/** Detect the host's IANA timezone with a UTC fallback.
 *  Wrapped in try/catch so exotic environments (no Intl support) don't crash. */
export function detectUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Default jobs seeded on every daemon start if the name is not already present. */
export const BUILT_IN_JOBS: ReadonlyArray<DefaultJobSpec> = [
  {
    name: "morning-briefing",
    schedule: {
      kind: "cron",
      expr: "0 8 * * *",
      tz: detectUserTimezone(),
    },
    message: BRIEFING_PROMPT,
    deliver: true,
  },
  {
    name: "evening-recap",
    // Fixed at 21:00 user-TZ — not configurable (YAGNI; customise via `ghost cron edit` if needed).
    schedule: {
      kind: "cron",
      expr: "0 21 * * *",
      tz: detectUserTimezone(),
    },
    message: RECAP_PROMPT,
    deliver: true,
  },
] as const;
