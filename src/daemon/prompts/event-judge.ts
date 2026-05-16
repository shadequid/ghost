/**
 * Event-judge trigger message.
 *
 * The `event-judge` skill (always: true) is loaded into the system prompt
 * and owns the priority order, tone guidance, and output schema. This
 * builder just names the skill and dumps the data it needs.
 */

import type { ObserverEvent } from "../../observer/events.js";

export interface ChatSnippet {
  role: "user" | "assistant";
  /** Text body only — tool calls / system markers stripped by caller. */
  text: string;
  /** Wall-clock ms when this turn occurred. */
  timestamp: number;
}

export interface EventJudgeContext {
  /** Events emitted by the observer this tick. Non-empty. */
  events: ObserverEvent[];
  /** Recent main-session messages (most recent last). Empty array allowed. */
  recentChat: ChatSnippet[];
  /** Wall-clock ms of the most recent proactive assistant message — null when none. */
  lastProactiveAtMs: number | null;
  /** Current wall-clock ms. */
  nowMs: number;
}

function compactEvent(ev: ObserverEvent): unknown {
  // `detectedAt` is the same nowMs for every event in a tick — redundant.
  const { detectedAt: _, ...rest } = ev;
  void _;
  return rest;
}

function ageMin(nowMs: number, ts: number): number {
  return Math.max(0, Math.round((nowMs - ts) / 60_000));
}

export function buildEventJudgePrompt(ctx: EventJudgeContext): string {
  const events = JSON.stringify(ctx.events.map(compactEvent), null, 2);
  const chat = ctx.recentChat.length === 0
    ? "(none)"
    : ctx.recentChat
        .map((c) => `[${ageMin(ctx.nowMs, c.timestamp)}m ago, ${c.role}] ${c.text}`)
        .join("\n");
  const lastProactive = ctx.lastProactiveAtMs === null
    ? "none yet"
    : `${ageMin(ctx.nowMs, ctx.lastProactiveAtMs)}m ago`;

  return [
    "Run event-judge skill.",
    `Events: ${events}`,
    `Recent chat: ${chat}`,
    `Last proactive: ${lastProactive}`,
  ].join("\n\n");
}
