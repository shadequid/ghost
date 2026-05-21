/**
 * Gateway chat methods — uses Orchestrator for unified session/agent path.
 */

import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { MethodHandler, MethodContext } from "./method-registry.js";
import type { SessionManager } from "../session/manager.js";
import type { Orchestrator } from "../agent/orchestrator.js";
import { MAIN_SESSION_KEY } from "../session/session.js";
import { classifyError } from "../core/errors.js";
import { routeOrchestratorError } from "./route-orchestrator-error.js";
import type { Logger } from "pino";

const MAX_SERIALIZED_LEN = 8000;

function argsHint(args: unknown): string {
  try {
    const s = typeof args === "string" ? args : JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 80) + "\u2026" : s;
  } catch { return ""; }
}

function safeSerialize(value: unknown): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return s.length > MAX_SERIALIZED_LEN
      ? s.slice(0, MAX_SERIALIZED_LEN) + "\n…(truncated)"
      : s;
  } catch { return String(value); }
}

/** Extract text from a tool result's content array, matching pi-ai ToolResult shape. */
function extractResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: unknown }).content;
    if (Array.isArray(content)) {
      return content
        .filter((p): p is { type: "text"; text: string } => p?.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
    }
  }
  return safeSerialize(result);
}

interface ActiveRun {
  unsubscribeClient: () => void;
  clientId: string;
  runId: string;
}

export interface ChatMethodsHandle {
  /** Abort all active runs for a disconnected client. */
  abortRunsForClient(clientId: string): void;
}

export function registerChatMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: {
    orchestrator: Orchestrator;
    sessionManager: SessionManager;
    logger: Logger;
  },
): ChatMethodsHandle {
  const log = deps.logger;
  const activeRuns = new Map<string, ActiveRun>();

  register("chat.send", async (ctx, payload) => {
    const p = payload as { message?: string; sessionKey?: string; idempotencyKey?: string };
    if (!p?.message?.trim()) throw new Error("message is required");

    const runId = p.idempotencyKey ?? crypto.randomUUID();
    const toolStartTimes = new Map<string, number>();
    let turnCount = 0;

    // Track this run for abort/disconnect cleanup
    let cancelRun = false;
    const run: ActiveRun = {
      unsubscribeClient: () => { cancelRun = true; },
      clientId: ctx.clientId,
      runId,
    };
    activeRuns.set(runId, run);

    const onEvent = (event: AgentEvent) => {
      if (cancelRun) return;
      emitChatEvent(ctx, runId, event, toolStartTimes, () => {
        turnCount++;
        return turnCount;
      });
    };

    // Run prompt async — return immediately with runId
    const runPromise = deps.orchestrator.prompt({
      content: p.message.trim(),
      channel: "web",
      chatId: ctx.clientId,
      onEvent,
    });

    runPromise
      .then((result) => {
        if (!cancelRun) {
          ctx.emit("chat.done", { runId });
        }
      })
      .catch((err: unknown) => {
        const classified = classifyError(err);
        log.error({ runId, err, errorType: classified.type }, "orchestrator.prompt rejected");
        if (!cancelRun) {
          // TOOL_BLOCKED → synthesized assistant text (Path C);
          // everything else → chat.error as before.
          routeOrchestratorError(runId, classified, (type, payload) => ctx.emit(type, payload));
        }
      })
      .finally(() => {
        activeRuns.delete(runId);
      });

    return { runId, status: "started" };
  });

  register("chat.history", async (_ctx, payload) => {
    const p = payload as { sessionKey?: string; limit?: number };
    const rawLimit = p?.limit ?? 200;
    const limit = Math.min(Math.max(1, rawLimit), 1000);

    // Always read from the unified "main" session
    const session = deps.sessionManager.getOrCreate(MAIN_SESSION_KEY);
    const messages = session.messages.slice(-limit);
    return { sessionKey: MAIN_SESSION_KEY, messages };
  });

  register("chat.abort", async (ctx, payload) => {
    const p = payload as { runId?: string };

    if (p?.runId) {
      const active = activeRuns.get(p.runId);
      if (active) {
        active.unsubscribeClient();
        deps.orchestrator.abort();
        activeRuns.delete(p.runId);
        ctx.emit("chat.aborted", { runId: p.runId });
        return { ok: true, aborted: true };
      }
      return { ok: true, aborted: false };
    }

    // No runId — abort all runs
    let aborted = false;
    for (const [id, active] of activeRuns) {
      active.unsubscribeClient();
      deps.orchestrator.abort();
      activeRuns.delete(id);
      ctx.emit("chat.aborted", { runId: id });
      aborted = true;
    }
    return { ok: true, aborted };
  });

  return {
    abortRunsForClient(clientId: string) {
      for (const [id, run] of activeRuns) {
        if (run.clientId === clientId) {
          run.unsubscribeClient();
          deps.orchestrator.abort();
          activeRuns.delete(id);
        }
      }
    },
  };
}

/** Emit chat events to the web client via ctx.emit(). */
function emitChatEvent(
  ctx: MethodContext,
  runId: string,
  event: AgentEvent,
  toolStartTimes: Map<string, number>,
  incrementTurn: () => number,
): void {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    // Deltas are already cleaned by orchestrator — pass through
    ctx.emit("chat.delta", { runId, delta: event.assistantMessageEvent.delta });
  } else if (event.type === "message_update" && event.assistantMessageEvent.type === "toolcall_end") {
    // CLI provider: tool already executed via MCP — emit both start and completion
    const tc = event.assistantMessageEvent.toolCall;
    ctx.emit("chat.tool_call", {
      runId, toolCallId: tc.id, name: tc.name,
      argsHint: argsHint(tc.arguments),
      argsFull: safeSerialize(tc.arguments),
    });
    ctx.emit("chat.tool_result", {
      runId, toolCallId: tc.id, name: tc.name,
      success: true, durationSecs: 0,
      result: "",
    });
  } else if (event.type === "tool_execution_start") {
    toolStartTimes.set(event.toolCallId, Date.now());
    ctx.emit("chat.tool_call", {
      runId, toolCallId: event.toolCallId, name: event.toolName,
      argsHint: argsHint(event.args),
      argsFull: safeSerialize(event.args),
    });
  } else if (event.type === "tool_execution_end") {
    const startMs = toolStartTimes.get(event.toolCallId) ?? Date.now();
    toolStartTimes.delete(event.toolCallId);
    const durationSecs = Math.round((Date.now() - startMs) / 1000);
    ctx.emit("chat.tool_result", {
      runId, toolCallId: event.toolCallId, name: event.toolName,
      success: !event.isError, durationSecs,
      result: extractResultText(event.result),
    });
  } else if (event.type === "turn_start") {
    const turn = incrementTurn();
    ctx.emit("chat.turn", { runId, turn });
  }
}
