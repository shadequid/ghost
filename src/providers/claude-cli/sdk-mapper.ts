/**
 * SDK message → pi-ai AssistantMessageEvent mapper for the Claude CLI provider.
 *
 * SdkMessageMapper is stateful per-invocation. Create one per query() call.
 * Event contract:
 *   stream_event wrappers → token-by-token text/tool deltas
 *   assistant             → batch content when no stream_events seen
 *   result                → done (usage + stop_reason)
 *
 * File intentionally exceeds the 300-LOC guideline. The SDK message type
 * interfaces and the mapper class are tightly coupled — splitting them into
 * separate files would require importing the interfaces back into the mapper,
 * creating an awkward circular-dependency structure. Co-location is clearer.
 */

import type { AssistantMessageEvent, TextContent, ToolCall } from "@mariozechner/pi-ai";
import { createPartial, mapUsage, mapStopReason } from "./parse-helpers.js";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Internal message shapes — narrow SDK union for use by the mapper
// ---------------------------------------------------------------------------

interface StreamContentBlockStart {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "text" | "thinking" }
    | { type: "tool_use"; id: string; name: string };
}

interface StreamContentBlockDelta {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "thinking_delta"; thinking: string }
    | { type: "input_json_delta"; partial_json: string }
    | { type: string };
}

interface StreamContentBlockStop {
  type: "content_block_stop";
  index: number;
}

export interface StreamEventMsg {
  type: "stream_event";
  // Loose event type — narrowed inside processStreamEvent via type assertions.
  event: { type: string; [key: string]: unknown };
}

// Narrowed block helpers — avoids `id?: string` ambiguity in the union
interface AssistantTextBlock { type: "text"; text: string }
interface AssistantToolUseBlock { type: "tool_use"; id: string; name: string; input: unknown }

type AssistantContentBlock =
  | AssistantTextBlock
  | AssistantToolUseBlock
  | { type: "thinking"; thinking: string }
  | { type: string };

export interface AssistantMsg {
  type: "assistant";
  message: {
    content: AssistantContentBlock[];
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
  };
}

export interface ResultMsg {
  type: "result";
  subtype: string;
  is_error: boolean;
  stop_reason: string;
  total_cost_usd: number;
  num_turns: number;
  duration_api_ms: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  // Only present on subtype === "success"
  result?: string;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export class SdkMessageMapper {
  private readonly partial: ReturnType<typeof createPartial>;
  private contentIndex = 0;
  private started = false;
  private hasStreamEvents = false;
  private readonly emittedToolCallIds = new Set<string>();
  private readonly blockTypes = new Map<number, "text" | "thinking" | "tool_use">();
  private readonly blockText = new Map<number, string>();
  private readonly toolInputJson = new Map<number, string>();
  private readonly toolMeta = new Map<number, { id: string; name: string }>();

  constructor(
    private readonly modelId: string,
    private readonly log: Logger,
  ) {
    this.partial = createPartial(modelId);
  }

  process(msg: { type: string; [key: string]: unknown }): AssistantMessageEvent[] {
    // Cast through unknown — SDK message shapes are structurally compatible at
    // runtime; the loose index signature prevents direct assignment.
    const raw = msg as unknown;
    switch (msg.type) {
      case "stream_event": return this.processStreamEvent(raw as StreamEventMsg);
      case "assistant":    return this.processAssistant(raw as AssistantMsg);
      case "result":       return this.processResult(raw as ResultMsg);
      default:             return [];
    }
  }

  private processStreamEvent(wrapper: StreamEventMsg): AssistantMessageEvent[] {
    this.hasStreamEvents = true;
    const inner = wrapper.event;
    const events: AssistantMessageEvent[] = [];

    if (inner.type === "message_start") {
      if (!this.started) {
        this.started = true;
        events.push({ type: "start", partial: this.partial });
      }
      return events;
    }

    if (inner.type === "content_block_start") {
      const e = inner as unknown as StreamContentBlockStart;
      if (!this.started) {
        this.started = true;
        events.push({ type: "start", partial: this.partial });
      }
      const block = e.content_block;
      if (block.type === "text") {
        this.blockTypes.set(e.index, "text");
        this.blockText.set(e.index, "");
        events.push({ type: "text_start", contentIndex: this.contentIndex, partial: this.partial } as AssistantMessageEvent);
      } else if (block.type === "thinking") {
        // Track the block so deltas/stop are correctly classified, but emit
        // nothing — thinking content is internal-only and must not surface
        // in the rendered chat. The web UI has a dedicated ThinkingIndicator
        // for the "is reasoning" cue.
        this.blockTypes.set(e.index, "thinking");
      } else if (block.type === "tool_use") {
        this.blockTypes.set(e.index, "tool_use");
        this.toolInputJson.set(e.index, "");
        this.toolMeta.set(e.index, { id: block.id, name: block.name });
        events.push({ type: "toolcall_start", contentIndex: this.contentIndex, partial: this.partial } as AssistantMessageEvent);
      }
      return events;
    }

    if (inner.type === "content_block_delta") {
      const e = inner as unknown as StreamContentBlockDelta;
      const blockType = this.blockTypes.get(e.index);
      if (!blockType) return events;
      const deltaType = (e.delta as { type: string }).type;
      if (deltaType === "text_delta") {
        const d = e.delta as { type: "text_delta"; text: string };
        this.blockText.set(e.index, (this.blockText.get(e.index) ?? "") + d.text);
        events.push({ type: "text_delta", contentIndex: this.contentIndex, delta: d.text, partial: this.partial } as AssistantMessageEvent);
      } else if (deltaType === "input_json_delta") {
        const d = e.delta as { type: "input_json_delta"; partial_json: string };
        this.toolInputJson.set(e.index, (this.toolInputJson.get(e.index) ?? "") + d.partial_json);
        events.push({ type: "toolcall_delta", contentIndex: this.contentIndex, delta: d.partial_json, partial: this.partial } as AssistantMessageEvent);
      }
      // thinking_delta + signature_delta — silently dropped; thinking content
      // is internal-only.
      return events;
    }

    if (inner.type === "content_block_stop") {
      const e = inner as unknown as StreamContentBlockStop;
      const blockType = this.blockTypes.get(e.index);
      if (!blockType) return events;

      if (blockType === "tool_use") {
        const meta = this.toolMeta.get(e.index);
        const rawJson = this.toolInputJson.get(e.index) ?? "{}";
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(rawJson) as Record<string, unknown>; } catch { /* malformed JSON — use empty */ }
        const toolCall: ToolCall = {
          type: "toolCall",
          id: meta?.id ?? "",
          name: meta?.name ?? "",
          arguments: args,
        };
        // Dedup: guard against duplicate tool call IDs.
        if (!this.emittedToolCallIds.has(toolCall.id)) {
          this.emittedToolCallIds.add(toolCall.id);
          events.push({ type: "toolcall_end", contentIndex: this.contentIndex, toolCall, partial: this.partial } as AssistantMessageEvent);
        }
        this.toolInputJson.delete(e.index);
        this.toolMeta.delete(e.index);
        this.contentIndex++;
      } else if (blockType === "text") {
        const fullText = this.blockText.get(e.index) ?? "";
        this.partial.content.push({ type: "text", text: fullText } as TextContent);
        events.push({ type: "text_end", contentIndex: this.contentIndex, content: fullText, partial: this.partial } as AssistantMessageEvent);
        this.blockText.delete(e.index);
        this.contentIndex++;
      }
      // thinking — no event, no partial.content entry, no contentIndex bump.
      // partial.content must stay dense (aligned with contentIndex) so the
      // next text/tool block lands at the right position.
      this.blockTypes.delete(e.index);
    }

    return events;
  }

  private processAssistant(msg: AssistantMsg): AssistantMessageEvent[] {
    // SDK always emits stream_events for claude-cli provider; assistant batch
    // fallback is retained for safety in case SDK changes its streaming mode.
    if (this.hasStreamEvents) return [];

    const events: AssistantMessageEvent[] = [];
    if (!this.started) {
      this.started = true;
      events.push({ type: "start", partial: { ...this.partial } });
    }

    for (const block of msg.message.content) {
      if (block.type === "text") {
        const tb = block as AssistantTextBlock;
        this.partial.content.push({ type: "text", text: tb.text } as TextContent);
        events.push({ type: "text_start", contentIndex: this.contentIndex, partial: this.partial } as AssistantMessageEvent);
        events.push({ type: "text_delta", contentIndex: this.contentIndex, delta: tb.text, partial: this.partial } as AssistantMessageEvent);
        events.push({ type: "text_end", contentIndex: this.contentIndex, content: tb.text, partial: this.partial } as AssistantMessageEvent);
        this.contentIndex++;
      } else if (block.type === "tool_use") {
        const ub = block as AssistantToolUseBlock;
        const toolCall: ToolCall = {
          type: "toolCall",
          id: ub.id,
          name: ub.name,
          arguments: (ub.input ?? {}) as Record<string, unknown>,
        };
        if (!this.emittedToolCallIds.has(toolCall.id)) {
          this.emittedToolCallIds.add(toolCall.id);
          events.push({ type: "toolcall_start", contentIndex: this.contentIndex, partial: this.partial } as AssistantMessageEvent);
          events.push({ type: "toolcall_end", contentIndex: this.contentIndex, toolCall, partial: this.partial } as AssistantMessageEvent);
        }
        this.contentIndex++;
      }
    }

    if (msg.message.usage) {
      this.partial.usage = mapUsage(msg.message.usage);
    }
    return events;
  }

  processResult(msg: ResultMsg): AssistantMessageEvent[] {
    this.log.debug(
      `sdk usage: input=${msg.usage.input_tokens} output=${msg.usage.output_tokens}` +
      ` cache_read=${msg.usage.cache_read_input_tokens} cache_write=${msg.usage.cache_creation_input_tokens}` +
      ` turns=${msg.num_turns} cost=$${msg.total_cost_usd?.toFixed(4) ?? "?"} duration_api=${msg.duration_api_ms}ms`,
    );

    const events: AssistantMessageEvent[] = [];

    if (msg.is_error) {
      if (!this.started) {
        this.started = true;
        events.push({ type: "start", partial: { ...this.partial } });
      }
      const errorText = msg.subtype === "error_during_execution"
        ? "Claude Code: tool execution error"
        : "Claude Code: session error";
      this.partial.content = [{ type: "text", text: errorText } as TextContent];
      this.partial.stopReason = "error";
      this.partial.errorMessage = errorText;
      this.partial.usage = mapUsage(msg.usage, msg.total_cost_usd);
      events.push({ type: "error", reason: "error", error: { ...this.partial } });
      return events;
    }

    // Success path — emit fallback text from result.result when no stream_events produced text
    const hasText = this.partial.content.some(
      (c: { type: string }) => c.type === "text" && (c as TextContent).text.trim().length > 0,
    );

    if (!this.started || !hasText) {
      if (!this.started) {
        this.started = true;
        events.push({ type: "start", partial: { ...this.partial } });
      }
      if (msg.subtype === "success") {
        const resultText = msg.result;
        if (resultText) {
          this.partial.content.push({ type: "text", text: resultText } as TextContent);
          events.push({ type: "text_start", contentIndex: this.contentIndex, partial: { ...this.partial } } as AssistantMessageEvent);
          events.push({ type: "text_delta", contentIndex: this.contentIndex, delta: resultText, partial: { ...this.partial } } as AssistantMessageEvent);
          events.push({ type: "text_end", contentIndex: this.contentIndex, content: resultText, partial: { ...this.partial } } as AssistantMessageEvent);
          this.contentIndex++;
        }
      }
    }

    const stopReason = mapStopReason(msg.stop_reason);
    this.partial.stopReason = stopReason;
    this.partial.usage = mapUsage(msg.usage, msg.total_cost_usd);

    events.push({
      type: "done",
      reason: stopReason as Extract<ReturnType<typeof mapStopReason>, "stop" | "length" | "toolUse">,
      message: { ...this.partial },
    });

    return events;
  }
}
