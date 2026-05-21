/**
 * Orchestrator — single prompt path for all channels.
 *
 * Encapsulates: session lock, load session, pre-consolidation,
 * agent context swap, event-driven persistence, agent.prompt(),
 * post-consolidation. All channels call orchestrator.prompt().
 */

import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { Message, Tool } from "@earendil-works/pi-ai";
import type { SessionManager } from "../session/manager.js";
import { MAIN_SESSION_KEY } from "../session/session.js";
import type { MemoryConsolidator } from "../memory/consolidator.js";
import type { ContextBuilder } from "./context-builder.js";
import type { ToolRegistry } from "../tools/registry.js";
import { isOriginAware } from "../tools/context-aware.js";
import { TextAccumulator } from "./text-accumulator.js";
import { AsyncKeyLock } from "../helpers/async-lock.js";
import type { Logger } from "pino";

export interface PromptToolCall {
  name: string;
  arguments: unknown;
}

export interface PromptResult {
  text: string;
  /**
   * All tool calls made by the agent during this prompt run, in order. Each
   * entry has the tool name and the raw arguments passed. Exposed for eval
   * assertions; daemon/CLI callers can ignore.
   */
  toolCalls: PromptToolCall[];
}

export interface PromptOptions {
  content: string;
  channel: string;
  chatId: string;
  onEvent?: (event: AgentEvent) => void;
}

export class Orchestrator {
  private readonly lock = new AsyncKeyLock();
  private readonly textAccumulator = new TextAccumulator();
  private currentOrigin: { channel: string; chatId: string } | null = null;

  constructor(
    private readonly agent: Agent,
    private readonly sessionManager: SessionManager,
    private readonly consolidator: MemoryConsolidator,
    private readonly contextBuilder: ContextBuilder,
    private readonly tools: ToolRegistry,
    private readonly log: Logger,
  ) {}

  /**
   * Get the assistant text accumulated in the current turn of the active prompt run.
   * Safe to call during tool execution (e.g., from the deferredConfirm callback)
   * to capture the analysis text preceding a confirmation card.
   */
  getCurrentTurnText(): string {
    return this.textAccumulator.currentTurnText;
  }

  /**
   * Origin {channel, chatId} of the inbound message that caused the currently
   * running tool call. Null outside an active prompt run, or when the prompt
   * wasn't initiated by an inbound (e.g., cron/scheduler). Used by confirm/
   * approval services so cross-channel subscribers can route the UI prompt to
   * the right chat.
   */
  getCurrentTurnOrigin(): { channel: string; chatId: string } | null {
    return this.currentOrigin;
  }

  /** Run a prompt through the unified session. Serialized via session lock. */
  async prompt(opts: PromptOptions): Promise<PromptResult> {
    return this.lock.acquire(MAIN_SESSION_KEY, () => this.runPrompt(opts));
  }

  /** Abort the current agent run. */
  abort(): void {
    this.agent.abort();
  }

  private async runPrompt(opts: PromptOptions): Promise<PromptResult> {
    const { content, channel, chatId, onEvent } = opts;
    this.currentOrigin = channel && chatId ? { channel, chatId } : null;
    const session = this.sessionManager.getOrCreate(MAIN_SESSION_KEY);

    // Pre-prompt memory consolidation
    const toolDefs = this.getToolDefinitions();
    await this.consolidator.maybeConsolidate(
      session, this.agent.state.systemPrompt, toolDefs,
    ).catch((err) => this.log.warn({ err }, "pre-prompt consolidation failed"));

    // Swap agent context for this session
    const history = session.getHistory().map((msg) => {
      if (msg.role === "assistant" && typeof msg.content === "string") {
        return { ...msg, content: [{ type: "text" as const, text: msg.content }] };
      }
      return msg;
    });
    this.agent.state.messages = history;
    this.agent.sessionId = MAIN_SESSION_KEY;

    // Build full prompt: fresh memory + runtime context in one pass (no indexOf)
    const fullPrompt = this.contextBuilder.buildFullPrompt(channel, chatId);
    this.agent.state.systemPrompt = fullPrompt;

    // Keep agent's tool snapshot in sync with the live registry.
    this.agent.state.tools = this.tools.all();

    // Inject origin into tools that declare they need it.
    for (const tool of this.tools.all()) {
      if (isOriginAware(tool)) tool.setOrigin(channel, chatId);
    }

    // Reset text accumulator for this prompt run
    const acc = this.textAccumulator;
    acc.reset();

    // Capture tool calls for this run (eval harness uses this; daemon/CLI ignore).
    const toolCalls: PromptToolCall[] = [];

    // Subscribe to events for persistence + caller callbacks
    const unsubscribe = this.agent.subscribe((event: AgentEvent) => {
      // Persist non-user messages on message_end
      if (event.type === "message_end") {
        const msg = event.message as Message;
        if (msg.role !== "user") {
          // For assistant tool-use messages, pi-agent-core may skip text_delta
          // events. Extract text and inject as a synthetic delta so the
          // frontend streamRef gets the analysis text.
          // Only for assistant messages — tool result messages contain raw
          // tool output that should NOT be injected as chat text.
          if (msg.role === "assistant" && Array.isArray(msg.content)) {
            // Capture tool calls from this assistant message for the trace.
            for (const block of msg.content as Array<{ type: string; name?: string; arguments?: unknown }>) {
              if (block.type === "toolCall" && typeof block.name === "string") {
                toolCalls.push({ name: block.name, arguments: block.arguments });
              }
            }
            const messageText = (msg.content as Array<{ type: string; text?: string }>)
              .filter((p) => p.type === "text" && typeof p.text === "string")
              .map((p) => p.text!)
              .join("");
            const undelivered = acc.onMessageEnd(messageText);
            if (undelivered) {
              onEvent?.({
                type: "message_update",
                assistantMessageEvent: { type: "text_delta", delta: undelivered },
              } as AgentEvent);
            }
          }

          // Persist all non-user messages to session
          session.addMessage(msg);
        }
      }

      // On new turn, record offset so currentTurnText only has current turn's text
      if (event.type === "turn_start") {
        acc.onTurnStart();
      }

      // Track streaming deltas — count chars delivered to downstream
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        const delta = event.assistantMessageEvent.delta;
        acc.onDelta(delta);
        // Only forward non-empty deltas to avoid empty message bubbles
        if (delta) {
          onEvent?.(event);
        }
        return;
      }

      onEvent?.(event);
    });

    // Add user message to session immediately for crash-safe persistence
    session.addMessage({ role: "user", content, timestamp: Date.now() } as Message);

    try {
      await this.agent.prompt(content);
    } finally {
      unsubscribe();
      this.currentOrigin = null;
    }

    // Check for agent errors
    const agentError = this.agent.state.errorMessage;
    if (agentError) {
      this.log.error({ err: agentError, channel, session: MAIN_SESSION_KEY }, "agent error");
      throw new Error(agentError);
    }

    // Post-prompt consolidation (non-blocking)
    void this.consolidator.maybeConsolidate(
      session, this.agent.state.systemPrompt, toolDefs,
    ).catch((err) => this.log.warn({ err }, "post-prompt consolidation failed"));

    return {
      text: acc.totalText,
      toolCalls,
    };
  }

  private getToolDefinitions(): Tool[] {
    return this.tools.all().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

}
