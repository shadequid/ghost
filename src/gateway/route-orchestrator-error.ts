import type { ClassifiedError } from "../core/errors.js";

/**
 * Ghost-voiced text emitted when the orchestrator rejects with a
 * `TOOL_BLOCKED` error. Path C: instead of
 * surfacing a red error bubble for tool-policy denials, we synthesize
 * an assistant text turn so the failure reads like Ghost narrating
 * what happened. Stays in sync (in spirit) with the frontend
 * `inlineErrorText('TOOL_BLOCKED')` fallback string.
 */
export const TOOL_BLOCKED_ASSISTANT_TEXT =
  "I can't run that — security policy is blocking it";

type Emit = (type: string, payload: unknown) => void;

/**
 * Route an orchestrator error to either:
 *  - a synthesized assistant turn (`chat.delta` + `chat.done`) for
 *    `TOOL_BLOCKED`, so Ghost appears to narrate the policy denial; or
 *  - a `chat.error` event for everything else (genuine provider /
 *    auth / context failures the agent can't recover from in-band).
 *
 * Pure function — `emit` is the gateway's `ctx.emit`. No side effects
 * beyond the emit calls.
 *
 * Why `chat.delta`+`chat.done` and not a dedicated event: the frontend
 * `chat.done` handler reads `payload?.response ?? streamRef.current.join('')`,
 * and `streamRef` is appended synchronously on every `chat.delta`. So
 * the full string is committed to the streaming message and finalized
 * by the existing handler — no race with the streaming-RAF flush, no
 * new event type required.
 */
export function routeOrchestratorError(
  runId: string,
  classified: ClassifiedError,
  emit: Emit,
): void {
  if (classified.type === "TOOL_BLOCKED") {
    emit("chat.delta", { runId, delta: TOOL_BLOCKED_ASSISTANT_TEXT });
    emit("chat.done", { runId });
    return;
  }
  emit("chat.error", {
    runId,
    error: classified.userMessage,
    errorType: classified.type,
  });
}
