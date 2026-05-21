/**
 * Session — append-only conversation history with smart retrieval.
 *
 * Messages are APPEND-ONLY for LLM cache efficiency.
 * Consolidation writes to MEMORY.md/HISTORY.md but never mutates messages.
 */
import type { Message, AssistantMessage, ToolResultMessage, ToolCall } from "@earendil-works/pi-ai";

/**
 * Canonical session key for the single Ghost user session. Used by Orchestrator,
 * Runner, and any tool that needs to read/write the user's chat history.
 * Defined here (not in Orchestrator) so peers don't have to import the
 * orchestrator just to address its session.
 */
export const MAIN_SESSION_KEY = "main";

export interface SessionSummary {
  key: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** Callback invoked when a message is appended to a session. */
export type OnAppendCallback = (message: Message) => void;

export class Session {
  readonly key: string;
  readonly messages: Message[] = [];
  readonly createdAt: Date;
  updatedAt: Date;
  /**
   * Timestamp of the most recent role:"user" message.
   * Null when no user has sent a message yet (fresh session or assistant-only session).
   * Updated only on user messages so background writes (cron, proactive) do not reset it.
   */
  lastActiveAt: Date | null;
  metadata: Record<string, unknown>;
  /** Index of first unconsolidated message. getHistory() returns messages from here onward. */
  lastConsolidated: number;
  /** Optional callback for append-only persistence. Set by SessionManager. */
  onAppend?: OnAppendCallback;

  constructor(opts: {
    key: string;
    messages?: Message[];
    createdAt?: Date;
    updatedAt?: Date;
    lastActiveAt?: Date | null;
    metadata?: Record<string, unknown>;
    lastConsolidated?: number;
    onAppend?: OnAppendCallback;
  }) {
    this.key = opts.key;
    if (opts.messages) this.messages.push(...opts.messages);
    this.createdAt = opts.createdAt ?? new Date();
    this.updatedAt = opts.updatedAt ?? new Date();
    // Explicit null means "no user message ever" — undefined means caller didn't set it
    this.lastActiveAt = opts.lastActiveAt !== undefined ? opts.lastActiveAt : null;
    this.metadata = opts.metadata ?? {};
    this.lastConsolidated = opts.lastConsolidated ?? 0;
    this.onAppend = opts.onAppend;
  }

  /** Append a message. Triggers onAppend callback for immediate persistence. */
  addMessage(message: Message): void {
    this.messages.push(message);
    this.updatedAt = new Date();
    // Track user-only activity so proactive and briefing skills can measure real absence.
    // Background writes (cron delivery, proactive assistant turns) do not reset this.
    if (message.role === "user") {
      this.lastActiveAt = new Date();
    }
    this.onAppend?.(message);
  }

  /**
   * Get history for LLM context — unconsolidated messages with legal boundaries.
   *
   * 1. Slice from lastConsolidated
   * 2. Take recent maxMessages
   * 3. Align to user turn (drop leading non-user messages)
   * 4. Remove orphan tool results (unmatched toolCallId)
   */
  getHistory(maxMessages = 500): Message[] {
    const unconsolidated = this.messages.slice(this.lastConsolidated);
    const recent = unconsolidated.slice(-maxMessages);

    // Align to user turn: drop leading non-user messages
    const userAligned = dropLeadingNonUser(recent);

    // Remove orphan tool results
    return removeOrphanToolResults(userAligned);
  }

  /** Reset session to initial state. */
  clear(): void {
    this.messages.length = 0;
    this.lastConsolidated = 0;
    this.updatedAt = new Date();
  }
}

/** Drop messages until the first user message. */
function dropLeadingNonUser(messages: Message[]): Message[] {
  const firstUser = messages.findIndex(m => m.role === "user");
  if (firstUser < 0) return [];
  return messages.slice(firstUser);
}

/**
 * Remove tool result messages whose toolCallId doesn't match any
 * assistant message's ToolCall.id in the current window.
 *
 * Scans forward: tracks declared tool call IDs from assistant messages.
 * If a toolResult references an ID not declared by any preceding assistant
 * message in this window, it's an orphan and gets dropped.
 */
function removeOrphanToolResults(messages: Message[]): Message[] {
  const declaredIds = new Set<string>();
  const result: Message[] = [];

  for (const msg of messages) {
    if (msg.role === "assistant") {
      // Collect tool call IDs declared by this assistant message
      for (const part of (msg as AssistantMessage).content) {
        if (isToolCall(part)) {
          declaredIds.add(part.id);
        }
      }
      result.push(msg);
    } else if (msg.role === "toolResult") {
      const toolResult = msg as ToolResultMessage;
      if (declaredIds.has(toolResult.toolCallId)) {
        result.push(msg);
      }
      // else: orphan — skip it
    } else {
      result.push(msg);
    }
  }

  return result;
}

function isToolCall(part: unknown): part is ToolCall {
  return typeof part === "object" && part !== null && (part as ToolCall).type === "toolCall";
}
