# Scheduler — JSON-Backed Cron Jobs

## Overview

Ghost scheduler stores jobs as JSON (no DB) and executes them via the agent loop. Built-in jobs deliver briefings and recaps daily. Custom jobs can be added via CLI or web.

**Store location:** `~/.ghost/workspace/cron/jobs.json`  
**Service:** `src/scheduler/service.ts`  
**Wired at:** `src/runtime.ts` (via daemon startup)

## Cron Model

Each job is stored as JSON with schedule + payload:

```json
{
  "id": "a1b2c3d4",
  "name": "morning-briefing",
  "enabled": true,
  "schedule": {
    "kind": "cron",
    "expr": "0 8 * * *",
    "tz": "America/Los_Angeles"
  },
  "payload": {
    "kind": "agent_turn",
    "message": "Run the morning briefing...",
    "deliver": true,
    "channel": "telegram"
  },
  "state": {
    "nextRunAtMs": 1715509200000,
    "lastRunAtMs": null,
    "lastStatus": null,
    "lastError": null,
    "runHistory": []
  },
  "createdAtMs": 1715420000000,
  "updatedAtMs": 1715420000000,
  "deleteAfterRun": false
}
```

**Schedules:** `kind` = `"at"` (one-time), `"every"` (interval), or `"cron"` (cron expr).

**Source:** `src/scheduler/types.ts`

## Built-in Jobs

Seeded on daemon start if not present:

### Morning Briefing

- **Schedule:** `0 8 * * *` (8 AM local time)
- **Timezone:** Detected at startup (fallback: UTC)
- **Message:** Gathers positions, watchlist, recent news, whale activity, funding rates, fear & greed. Under 15 sentences.
- **Deliver:** `true` — result pushed to Telegram/web

**Source:** `src/scheduler/defaults.ts:13-15`

### Evening Recap

- **Schedule:** `0 21 * * *` (9 PM local time)
- **Timezone:** Same as morning
- **Message:** Realized + unrealized PnL, position changes, biggest winner/loser, market context. Single short message.
- **Deliver:** `true` — result pushed to Telegram/web

**Source:** `src/scheduler/defaults.ts:18-23`

## How to Add a Custom Job

### Via CLI (agent_cron tool)

```typescript
await runner.callTool("ghost_cron", {
  action: "add",
  name: "weekly-portfolio-review",
  schedule: {
    kind: "cron",
    expr: "0 12 * * 0",    // Every Sunday at noon
    tz: "UTC"
  },
  message: "Review portfolio allocation and rebalance if needed.",
  deliver: true
})
```

### Via Web

1. Navigate to `/cron` on the gateway (default: `http://127.0.0.1:15401/cron`).
2. Click "Add Job".
3. Fill name, cron expression, timezone, message.
4. Toggle "Deliver" to push result to channels.
5. Save.

The scheduler reloads the JSON file on each tick, so changes are live.

**Source:** `src/scheduler/service.ts:88-120`

## Delivery Semantics

When `deliver: true` and the job completes:
1. Agent turn runs (e.g., morning briefing prompt).
2. Result is persisted to `state.lastRunAtMs`, `state.lastStatus`.
3. **If status == "ok":** Result dispatched to all paired channels (Telegram, web notifications).
4. **If status == "error":** Error logged; no user-facing dispatch.

One-time jobs with `deleteAfterRun: true` are removed after execution.

**Source:** `src/scheduler/delivery.ts`

## Job State Tracking

Each job tracks:
- `nextRunAtMs`: Wall-clock ms for next execution.
- `lastRunAtMs`, `lastStatus`: Most recent run metadata.
- `runHistory`: Last 20 runs (for troubleshooting).

Persisted to JSON on every state change; safe to inspect the file directly.

## Timezone Handling

Cron expressions are evaluated in the timezone specified in the schedule (e.g., `"America/New_York"`). Daemon detects your system timezone at startup via `Intl.DateTimeFormat()`.

Override by setting `cron.timezone` in config or per-job `schedule.tz`.

**Source:** `src/scheduler/defaults.ts:34-42`

## Inspection

List all jobs (enabled + disabled):
```bash
ghost cron list
```

Raw JSON (for debugging):
```bash
cat ~/.ghost/workspace/cron/jobs.json | jq
```
