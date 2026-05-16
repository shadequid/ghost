/**
 * Judge response parser + Runner wrapper.
 *
 * The event-judge skill emits a JSON envelope per observer tick. This module
 * parses it leniently (returns synthetic "silent" on any failure so the
 * loop treats it as a no-op rather than throwing) and exposes a single
 * `callJudge` helper that wires Runner.call + parser together.
 */

import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { parseLlmJsonObject } from "../helpers/parse-llm-json.js";
import type { Runner } from "../agent/runner.js";
import type { ContextBuilder } from "../agent/context-builder.js";
import type { ObserverEvent } from "./events.js";
import {
  buildEventJudgePrompt,
  type ChatSnippet,
} from "../daemon/prompts/event-judge.js";

const EVENT_TYPE_LITERALS = [
  Type.Literal("position_closed"),
  Type.Literal("tp_hit"),
  Type.Literal("sl_hit"),
  Type.Literal("position_liquidated"),
  Type.Literal("order_filled"),
  Type.Literal("order_canceled"),
  Type.Literal("liquidation_risk"),
  Type.Literal("pnl_snapshot"),
  Type.Literal("price_alert"),
] as const;

const JudgeResponseSchema = Type.Object({
  decision: Type.Union([Type.Literal("fire"), Type.Literal("silent")]),
  primaryEventType: Type.Union([...EVENT_TYPE_LITERALS, Type.Null()]),
  primarySymbol: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  body: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  /**
   * Whether to also render a notification badge (web bell + Telegram push).
   * LLM decides — high-impact events (liquidation, big PnL close) warrant a
   * notification; chatter-style messages do not. Ignored on silent.
   */
  notify: Type.Boolean(),
  reason: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
});

export type JudgeResponse = Static<typeof JudgeResponseSchema>;

export function parseJudgeResponse(raw: string): JudgeResponse {
  const silent = (reason: string): JudgeResponse => ({
    decision: "silent",
    primaryEventType: null,
    primarySymbol: null,
    body: null,
    notify: false,
    reason,
  });

  if (!raw.trim()) return silent("empty_response");
  const parsed = parseLlmJsonObject(raw);
  if (parsed === undefined) return silent("parse_error");
  if (!Value.Check(JudgeResponseSchema, parsed)) return silent("schema_error");
  const r = parsed as JudgeResponse;

  // Branch invariants — fire MUST carry primaryEventType + body. Silent MUST
  // carry reason. Anything else collapses to a logged silent so the loop
  // doesn't crash on a half-formed envelope.
  if (r.decision === "fire" && (!r.primaryEventType || !r.body)) {
    return silent("fire_missing_fields");
  }
  if (r.decision === "silent" && !r.reason) {
    return silent("silent_missing_reason");
  }
  return r;
}

export interface JudgeCallDeps {
  runner: Runner;
  contextBuilder: ContextBuilder;
  events: ObserverEvent[];
  recentChat: ChatSnippet[];
  lastProactiveAtMs: number | null;
  nowMs: number;
}

/**
 * Invoke the event-judge skill via the shared task agent. Returns the parsed
 * judge response. On any error the caller receives a synthetic silent
 * response — the loop never re-throws.
 */
export async function callJudge(deps: JudgeCallDeps): Promise<JudgeResponse> {
  const prompt = buildEventJudgePrompt({
    events: deps.events,
    recentChat: deps.recentChat,
    lastProactiveAtMs: deps.lastProactiveAtMs,
    nowMs: deps.nowMs,
  });
  let raw: string;
  try {
    raw = await deps.runner.call({
      systemPrompt: deps.contextBuilder.buildFullPrompt("internal", "event-judge"),
      message: prompt,
      persist: false,
    });
  } catch (err) {
    return {
      decision: "silent",
      primaryEventType: null,
      primarySymbol: null,
      body: null,
      notify: false,
      reason: `runner_error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
  return parseJudgeResponse(raw);
}

