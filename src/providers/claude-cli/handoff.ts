/**
 * Handoff detection and prompt formatting for Claude CLI provider.
 *
 * Detects when Ghost's session diverges from CLI's session (provider
 * switch, memory consolidation) and formats conversation context for
 * fresh CLI sessions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CliHandoff {
  systemPromptHash: string;
  syncedCount: number;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Check whether CLI session is stale and needs a fresh start. */
export function shouldHandoff(
  handoff: CliHandoff | null,
  systemHash: string,
  contextSize: number,
): boolean {
  if (!handoff) return true;
  if (handoff.systemPromptHash !== systemHash) return true;
  if (contextSize < handoff.syncedCount) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

/** Format full conversation history + new user prompt for a fresh CLI session. */
export function formatHandoffPrompt(
  messages: ReadonlyArray<{ role: string; content: unknown }>,
): string {
  const userPrompt = extractUserPrompt(messages);
  const history = messages.slice(0, -1);

  if (history.length === 0) return userPrompt;

  const parts: string[] = [];
  for (const msg of history) {
    if (msg.role === "toolResult") continue;
    const text = extractTextContent(msg.content);
    if (!text.trim()) continue;
    const label = msg.role === "user" ? "User" : "Ghost";
    parts.push(`[${label}]\n${text}`);
  }

  if (parts.length === 0) return userPrompt;

  return [
    "<session_context>",
    "Below is the conversation history from the current session. Continue naturally.",
    "",
    parts.join("\n\n"),
    "</session_context>",
    "",
    userPrompt,
  ].join("\n");
}

/** Extract the latest user message text from a message array. */
export function extractUserPrompt(messages: ReadonlyArray<{ role: string; content: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") {
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return (m.content as Array<{ type: string; text?: string }>)
          .filter(c => c.type === "text")
          .map(c => c.text ?? "")
          .join("\n");
      }
    }
  }
  return "";
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Shared hash utility
// ---------------------------------------------------------------------------

export function sha256(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}
