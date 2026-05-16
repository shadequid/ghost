/**
 * Chat history tool — retrieve recent user/assistant messages from the
 * main chat session for context recall.
 *
 * Used by proactive-advisor (external-trade-review) to quote user's stated
 * thesis and Ghost's prior recommendations when framing divergence.
 */

import { Type } from "@sinclair/typebox";
import type { SessionManager } from "../../session/manager.js";
import type { AnyAgentTool } from "./types.js";
import { MAIN_SESSION_KEY } from "../../session/session.js";
import { textResult } from "../../helpers/result.js";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_LOOKBACK_HOURS = 168;   // 7 days — default window when caller omits hours
const MAX_LOOKBACK_HOURS = 720;       // 30 days cap so callers can't blow up the response
const MAX_MESSAGES = 200;             // runtime safety cap — agent picks its own count within this
const TEXT_TRIM = 500;                // per-message character cap to keep output bounded

export function createChatHistoryTool(sessionManager: SessionManager): AnyAgentTool {
  return {
    name: "ghost_chat_history",
    label: "Chat History",
    description:
      "Retrieve recent messages from the main chat session (user statements + Ghost responses). " +
      "Use to recall prior thesis, stated plans, or Ghost's earlier recommendations when " +
      "evaluating proactive topics — especially external-trade-review where you must frame " +
      "divergence by quoting the user's actual words. " +
      "Decide `messages` based on what you actually need: a few (5–10) when you only want the " +
      "most recent context; more (30–100) when reconstructing a thesis spanning several turns.",
    parameters: Type.Object({
      messages: Type.Number({
        minimum: 1, maximum: MAX_MESSAGES,
        description:
          `How many recent messages to load (1–${MAX_MESSAGES}). Pick deliberately based on need — ` +
          "small for spot-checks, large for thesis reconstruction. No default.",
      }),
      lookbackHours: Type.Optional(Type.Number({
        minimum: 1, maximum: MAX_LOOKBACK_HOURS,
        description: `Window in hours (default ${DEFAULT_LOOKBACK_HOURS} = 7 days, max ${MAX_LOOKBACK_HOURS} = 30 days)`,
      })),
      roleFilter: Type.Optional(Type.Union([
        Type.Literal("user"), Type.Literal("assistant"), Type.Literal("both"),
      ], { description: "Filter by role (default 'both')" })),
      symbolFilter: Type.Optional(Type.String({
        minLength: 1,
        description: "Case-insensitive substring filter on message text (e.g. 'BTC', 'SOL')",
      })),
    }),
    async execute(_toolCallId, params) {
      const session = sessionManager.getOrCreate(MAIN_SESSION_KEY);
      const history = session.getHistory();
      const lookbackMs = (params.lookbackHours ?? DEFAULT_LOOKBACK_HOURS) * HOUR_MS;
      const cutoff = Date.now() - lookbackMs;
      const limit = Math.min(params.messages, MAX_MESSAGES);
      const role = params.roleFilter ?? "both";
      const symFilter = params.symbolFilter?.toLowerCase();

      // Walk backwards from newest — stop when we hit the cutoff boundary.
      // History is chronological so once a message is older than cutoff, all
      // preceding messages are too.
      // Messages without timestamps (ts === 0) are always included up to the
      // count limit — legacy data has no time anchor so we cannot determine their
      // age. The loop only breaks when ts > 0 && ts < cutoff.
      const collected: string[] = [];
      for (let i = history.length - 1; i >= 0 && collected.length < limit; i--) {
        const msg = history[i];
        const ts = typeof msg.timestamp === "number" ? msg.timestamp : 0;
        if (ts > 0 && ts < cutoff) break;

        // Skip tool / tool-result — only user/assistant prose is useful
        if (msg.role !== "user" && msg.role !== "assistant") continue;
        if (role !== "both" && msg.role !== role) continue;

        const text = extractText(msg);
        if (!text) continue;
        if (symFilter && !text.toLowerCase().includes(symFilter)) continue;

        const tsStr = ts > 0 ? new Date(ts).toISOString().slice(0, 16).replace("T", " ") : "?";
        const trimmed = text.length > TEXT_TRIM ? `${text.slice(0, TEXT_TRIM)}...` : text;
        collected.push(`[${msg.role} @ ${tsStr}] ${trimmed}`);
      }

      if (collected.length === 0) {
        return textResult("No matching messages in chat history.");
      }
      collected.reverse();  // restore chronological order for readability
      return textResult(collected.join("\n---\n"));
    },
  };
}

// UserMessage.content is string; AssistantMessage.content is (TextContent | ToolCall)[].
// extractText handles both shapes so the tool is resilient to future Message type changes.
interface MessagePart { type: string; text?: string }
function extractText(msg: { role: string; content: unknown }): string {
  if (typeof msg.content === "string") return msg.content.trim();
  if (!Array.isArray(msg.content)) return "";
  const parts: string[] = [];
  for (const p of msg.content as MessagePart[]) {
    if (p.type !== "text" || typeof p.text !== "string") continue;
    const trimmed = p.text.trim();
    if (trimmed) parts.push(trimmed);
  }
  return parts.join(" ");
}
