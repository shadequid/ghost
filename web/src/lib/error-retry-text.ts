import type { ChatMessage } from './chatTypes';

/**
 * Given a messages array and the index of an error bubble, return the
 * content of the most-recent preceding user message (the one that
 * triggered the failed turn). Returns undefined if the index doesn't
 * point at an error message, or no user message precedes it.
 *
 * Used by `AgentChat.tsx` to wire an inline `↻ Retry` link inside the
 * error bubble itself — clicking it calls `chat.handleSend(text)` to
 * re-issue the same message.
 */
export function errorRetryText(
  messages: readonly ChatMessage[],
  index: number,
): string | undefined {
  if (index < 0 || index >= messages.length) return undefined;
  if (messages[index]?.type !== 'error') return undefined;

  for (let i = index - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') return m.content;
  }
  return undefined;
}
