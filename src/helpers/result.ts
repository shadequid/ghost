/**
 * Result type for service operations.
 * Services return Result<T>, tool handlers convert to pi-agent-core format.
 */

import type { AgentToolResult } from "@mariozechner/pi-agent-core";

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E = string>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Quick text tool result */
export function textResult(text: string): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

/** Quick error tool result */
export function errorResult(message: string): AgentToolResult<Record<string, unknown>> {
  return textResult(`Error: ${message}`);
}

/** Safely extract error message from unknown catch value */
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
