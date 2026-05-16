/**
 * Tests for `routeOrchestratorError` — the catch-handler routing in
 * `src/gateway/chat.ts` after `orchestrator.prompt()` rejects.
 *
 * Path C: for `TOOL_BLOCKED`, instead of emitting a
 * `chat.error` event (red bubble), synthesize an assistant-text turn so
 * the failure reads like Ghost speaking — "I can't run that — security
 * policy is blocking it." All other classified errors retain the
 * existing `chat.error` path (provider failures, auth, etc. that the
 * agent genuinely cannot recover from).
 */

import { describe, test, expect } from "bun:test";
import {
  routeOrchestratorError,
  TOOL_BLOCKED_ASSISTANT_TEXT,
} from "../../src/gateway/route-orchestrator-error.js";
import type { ClassifiedError } from "../../src/core/errors.js";

interface EmittedEvent {
  type: string;
  payload: unknown;
}

function collect(): {
  emit: (type: string, payload: unknown) => void;
  events: EmittedEvent[];
} {
  const events: EmittedEvent[] = [];
  return {
    events,
    emit: (type, payload) => {
      events.push({ type, payload });
    },
  };
}

describe("routeOrchestratorError — Path C for TOOL_BLOCKED", () => {
  test("TOOL_BLOCKED → emits chat.delta + chat.done in Ghost's voice (no chat.error)", () => {
    const { emit, events } = collect();
    const classified: ClassifiedError = {
      type: "TOOL_BLOCKED",
      userMessage: "Operation was blocked by security policy.",
    };
    routeOrchestratorError("run-1", classified, emit);

    expect(events).toHaveLength(2);
    expect(events[0]?.type).toBe("chat.delta");
    expect(events[1]?.type).toBe("chat.done");

    const delta = events[0]?.payload as { runId: string; delta: string };
    expect(delta.runId).toBe("run-1");
    expect(delta.delta).toBe(TOOL_BLOCKED_ASSISTANT_TEXT);
    expect(delta.delta).toMatch(/^I /);
    expect(delta.delta).toContain("security policy");

    const done = events[1]?.payload as { runId: string };
    expect(done.runId).toBe("run-1");

    expect(events.find((e) => e.type === "chat.error")).toBeUndefined();
  });

  test("AUTH_FAILED → emits chat.error (existing behaviour preserved)", () => {
    const { emit, events } = collect();
    routeOrchestratorError(
      "run-2",
      { type: "AUTH_FAILED", userMessage: "Authentication failed." },
      emit,
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chat.error");
    const p = events[0]?.payload as { runId: string; error: string; errorType: string };
    expect(p.runId).toBe("run-2");
    expect(p.errorType).toBe("AUTH_FAILED");
    expect(p.error).toBe("Authentication failed.");
  });

  test("RATE_LIMITED → emits chat.error", () => {
    const { emit, events } = collect();
    routeOrchestratorError(
      "run-3",
      { type: "RATE_LIMITED", userMessage: "Rate limit reached." },
      emit,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chat.error");
    expect((events[0]?.payload as { errorType: string }).errorType).toBe("RATE_LIMITED");
  });

  test("PROVIDER_DOWN → emits chat.error", () => {
    const { emit, events } = collect();
    routeOrchestratorError(
      "run-4",
      { type: "PROVIDER_DOWN", userMessage: "Could not reach provider." },
      emit,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chat.error");
  });

  test("CONTEXT_OVERFLOW → emits chat.error", () => {
    const { emit, events } = collect();
    routeOrchestratorError(
      "run-5",
      { type: "CONTEXT_OVERFLOW", userMessage: "Context too long." },
      emit,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chat.error");
  });

  test("UNKNOWN → emits chat.error (recursion-safe; user retries via UI)", () => {
    const { emit, events } = collect();
    routeOrchestratorError(
      "run-6",
      { type: "UNKNOWN", userMessage: "Something went wrong." },
      emit,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("chat.error");
    expect((events[0]?.payload as { errorType: string }).errorType).toBe("UNKNOWN");
  });

  test("Ghost-voice TOOL_BLOCKED text doesn't read like a system notice", () => {
    expect(TOOL_BLOCKED_ASSISTANT_TEXT).not.toMatch(/\bERROR\b/);
    expect(TOOL_BLOCKED_ASSISTANT_TEXT).not.toMatch(/\bFAILED\b/);
    expect(TOOL_BLOCKED_ASSISTANT_TEXT).not.toMatch(/^[A-Z_]+:/);
  });
});
