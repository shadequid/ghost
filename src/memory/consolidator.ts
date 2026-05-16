/**
 * Memory consolidator — LLM-driven token-budget consolidation via Runner.
 *
 * When session messages exceed context budget, calls the LLM (via Runner)
 * to summarize old messages into MEMORY.md (facts) and HISTORY.md (log),
 * then advances the session's lastConsolidated pointer.
 *
 * The LLM is expected to call the `save_memory` tool, which is permanently
 * registered in the tool registry and handles persistence. If the LLM does
 * not call `save_memory`, consolidation is a no-op for this round —
 * best-effort policy by design.
 */
import type { Logger } from "pino";
import type { Runner } from "../agent/runner.js";
import type { MemoryStore } from "./store.js";
import type { SessionManager } from "../session/manager.js";
import type { Session } from "../session/session.js";
import { estimateSessionPromptTokens, estimateMessageTokens } from "./tokens.js";
import { AsyncKeyLock } from "../helpers/async-lock.js";

// ── Consolidation prompt ────────────────────────────────────────────────

function buildConsolidationPrompt(currentMemory: string, messagesBlock: string): string {
  return [
    "Read the conversation chunk below and call the save_memory tool with:",
    "- history_entry: a paragraph starting with [YYYY-MM-DD HH:MM] summarizing key events",
    "- memory_update: the full updated MEMORY.md content (keep existing facts, add new ones)",
    "",
    "## Current Long-term Memory (MEMORY.md)",
    currentMemory || "(empty)",
    "",
    "## Conversation to consolidate",
    messagesBlock,
  ].join("\n");
}

// ── Message formatting ──────────────────────────────────────────────────

function formatMessagesForConsolidation(messages: readonly unknown[]): string {
  const lines: string[] = [];
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const ts = m.timestamp ? new Date(m.timestamp as number).toISOString().slice(0, 16) : "";
    const prefix = ts ? `[${ts}]` : "";

    if (m.role === "user") {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      lines.push(`${prefix} USER: ${content}`);
    } else if (m.role === "assistant") {
      const parts = (m.content as unknown[]) ?? [];
      const textParts: string[] = [];
      const toolParts: string[] = [];
      for (const p of parts) {
        const part = p as Record<string, unknown>;
        if (part.type === "text" && part.text) textParts.push(String(part.text));
        if (part.type === "toolCall") toolParts.push(String(part.name));
      }
      const text = textParts.join(" ");
      const tools = toolParts.length > 0 ? ` [tools: ${toolParts.join(", ")}]` : "";
      lines.push(`${prefix} ASSISTANT${tools}: ${text}`);
    } else if (m.role === "toolResult") {
      const content = Array.isArray(m.content)
        ? (m.content as Array<Record<string, unknown>>)
            .filter(c => c.type === "text")
            .map(c => String(c.text))
            .join(" ")
        : String(m.content);
      const truncated = content.length > 500 ? content.slice(0, 500) + "..." : content;
      lines.push(`${prefix} TOOL(${String(m.toolName ?? "unknown")}): ${truncated}`);
    }
  }
  return lines.join("\n");
}

// ── MemoryConsolidator ──────────────────────────────────────────────────

export interface ConsolidatorOptions {
  store: MemoryStore;
  sessionManager?: SessionManager;
  runner: Runner;
  contextWindowTokens?: number;
  maxCompletionTokens?: number;
  maxConsolidationRounds?: number;
  logger?: Logger;
}

const SAFETY_BUFFER = 1024;

export class MemoryConsolidator {
  private readonly store: MemoryStore;
  private readonly sessionManager: SessionManager | undefined;
  private readonly runner: Runner;
  private readonly contextWindowTokens: number;
  private readonly maxCompletionTokens: number;
  private readonly maxConsolidationRounds: number;
  private readonly logger: Logger | undefined;
  private readonly lock = new AsyncKeyLock();

  constructor(opts: ConsolidatorOptions) {
    this.store = opts.store;
    this.sessionManager = opts.sessionManager;
    this.runner = opts.runner;
    this.contextWindowTokens = opts.contextWindowTokens ?? 65_536;
    this.maxCompletionTokens = opts.maxCompletionTokens ?? 8_192;
    this.maxConsolidationRounds = opts.maxConsolidationRounds ?? 5;
    this.logger = opts.logger;
  }

  /** Best-effort consolidation of a chunk. No fallback — if LLM skips save_memory, we skip too. */
  async archiveMessages(chunk: readonly unknown[]): Promise<void> {
    await this.consolidateChunk(chunk);
  }

  /**
   * Check if session exceeds context budget and consolidate if needed.
   * Serialized per session key to prevent concurrent overlapping consolidation.
   */
  async maybeConsolidate(
    session: Session,
    systemPrompt: string,
    tools: readonly unknown[],
  ): Promise<void> {
    return this.lock.acquire(session.key, async () => {
      const budget = this.contextWindowTokens - this.maxCompletionTokens - SAFETY_BUFFER;
      const target = Math.floor(budget / 2);

      for (let round = 0; round < this.maxConsolidationRounds; round++) {
        const unconsolidated = session.messages.slice(session.lastConsolidated);
        const estimated = estimateSessionPromptTokens({ systemPrompt, tools, messages: unconsolidated });

        if (estimated <= budget) return;

        const boundary = this.pickConsolidationBoundary(session, estimated - target);
        if (boundary === null) return;

        const chunk = session.messages.slice(session.lastConsolidated, boundary);
        if (chunk.length === 0) return;

        const saved = await this.consolidateChunk(chunk);
        // Only advance the pointer when the LLM actually called save_memory.
        // If it didn't, the chunk content would be silently dropped from
        // session.getHistory() without ever landing in MEMORY.md/HISTORY.md.
        // maxConsolidationRounds=5 is the ceiling for a stubborn LLM.
        if (!saved) return;
        session.lastConsolidated = boundary;
        await this.sessionManager?.save(session);
      }
    });
  }

  private pickConsolidationBoundary(session: Session, tokensToRemove: number): number | null {
    let removedTokens = 0;
    const start = session.lastConsolidated;

    for (let i = start; i < session.messages.length; i++) {
      removedTokens += estimateMessageTokens(session.messages[i]);

      if (removedTokens >= tokensToRemove && i + 1 < session.messages.length) {
        if (session.messages[i + 1].role === "user") return i + 1;
      }
    }

    return null;
  }

  /**
   * Runs the LLM consolidation pass for one chunk.
   *
   * Returns `true` if the LLM called `save_memory` (memory content changed),
   * `false` if it did not. Callers use the return value to gate whether
   * `lastConsolidated` should advance.
   */
  private async consolidateChunk(chunk: readonly unknown[]): Promise<boolean> {
    const formatted = formatMessagesForConsolidation(chunk);
    const memoryBefore = this.store.readLongTerm();
    await this.runner.call({
      systemPrompt:
        "You are a memory consolidation assistant. You MUST call the save_memory " +
        "tool with both history_entry and memory_update. Do not respond with text — " +
        "your only output should be the save_memory tool call.",
      message: buildConsolidationPrompt(memoryBefore, formatted),
    });
    // Detect best-effort no-op: if memory content is unchanged, save_memory was
    // not called. Bounded by maxConsolidationRounds=5 so this is a finite log.
    // (scout: consolidator best-effort warn)
    const memoryAfter = this.store.readLongTerm();
    if (memoryAfter === memoryBefore) {
      this.logger?.warn(
        { chunkSize: chunk.length },
        "consolidator: LLM did not call save_memory tool — session continues to grow",
      );
      return false;
    }
    return true;
  }
}

export { formatMessagesForConsolidation };
export { estimateTokens, estimateMessageTokens, estimateMessagesTokens, estimateSessionPromptTokens } from "./tokens.js";
