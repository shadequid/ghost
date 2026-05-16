/**
 * Shared helpers for CLI event parsing — usage mapping, stop reason mapping,
 * and partial message construction.
 */

import type {
  AssistantMessage,
  StopReason,
  Usage,
} from "@mariozechner/pi-ai";

export const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Create a base AssistantMessage skeleton for partial updates. */
export function createPartial(model: string): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "claude-cli",
    provider: "claude-cli",
    model,
    usage: { ...EMPTY_USAGE },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

/** Map CLI usage to pi-ai Usage. */
export function mapUsage(
  cliUsage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number },
  totalCostUsd = 0,
): Usage {
  return {
    input: cliUsage.input_tokens,
    output: cliUsage.output_tokens,
    cacheRead: cliUsage.cache_read_input_tokens,
    cacheWrite: cliUsage.cache_creation_input_tokens,
    totalTokens: cliUsage.input_tokens + cliUsage.output_tokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: totalCostUsd },
  };
}

/** Map CLI stop_reason to pi-ai StopReason (for final result only). */
export function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    default:
      return "stop";
  }
}
