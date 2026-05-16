import { getEncoding } from "js-tiktoken";
import type { Tiktoken } from "js-tiktoken";

// Singleton OK: Tiktoken encoding is immutable after initialization and expensive
// to create (loads ~3MB token map). Shared across all callers for performance.
let encoding: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoding) {
    encoding = getEncoding("cl100k_base");
  }
  return encoding;
}

const MESSAGE_FRAMING_OVERHEAD = 4;
const REPLY_PRIMING_OVERHEAD = 3;

export function estimateTokens(text: string): number {
  return getEncoder().encode(text).length;
}

export function estimateMessageTokens(message: unknown): number {
  return estimateTokens(JSON.stringify(message)) + MESSAGE_FRAMING_OVERHEAD;
}

export function estimateMessagesTokens(messages: readonly unknown[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}

export function estimateSessionPromptTokens(opts: {
  systemPrompt: string;
  tools: readonly unknown[];
  messages: readonly unknown[];
}): number {
  const systemTokens = estimateTokens(opts.systemPrompt);
  const toolsTokens = opts.tools.length > 0
    ? estimateTokens(JSON.stringify(opts.tools))
    : 0;
  const messagesTokens = estimateMessagesTokens(opts.messages);

  return systemTokens + toolsTokens + messagesTokens + REPLY_PRIMING_OVERHEAD;
}
