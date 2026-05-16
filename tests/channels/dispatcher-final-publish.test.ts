/**
 * Dispatcher — final publish semantics for non-streaming vs streaming channels.
 *
 * Non-streaming channel path (Telegram):
 *   - Pre-tool narration deltas are dropped after tool_execution_end.
 *   - Post-tool deltas accumulate in a buffer.
 *   - Single final message published via channel.send() on orchestrator resolve.
 *   - sendDelta is never called.
 *
 * Streaming channel path:
 *   - Post-tool deltas are published live via publishStreamDelta.
 *   - A _stream_end marker closes the stream on resolve.
 */

import { describe, test, expect } from "bun:test";
import { MessageBus } from "../../src/bus/queue.js";
import { MessageDispatcher } from "../../src/channels/dispatcher.js";
import { ChannelManager } from "../../src/channels/manager.js";
import { BaseChannel } from "../../src/channels/base.js";
import type { OutboundMessage } from "../../src/bus/types.js";
import type { Orchestrator, PromptOptions, PromptResult } from "../../src/agent/orchestrator.js";
import type { ToolRegistry } from "../../src/tools/registry.js";
import type { PairingStore } from "../../src/pairing/store.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import type { AgentEvent } from "@mariozechner/pi-agent-core";

// Stub pairing store — these tests do not exercise allowlist behavior.
const STUB_PAIRING = {
  listAllowlistIdentities: () => ["*"],
} as unknown as PairingStore;

/** Capture channel — records every send/sendDelta call so tests can
 *  reconstruct the publish order the dispatcher intended. Dispatcher's
 *  `startAll()` returns early on an empty channel map, so a registered
 *  channel is required even for inbound-only tests. */
class CaptureChannel extends BaseChannel {
  readonly name: string;
  readonly displayName = "capture";
  public readonly sent: OutboundMessage[] = [];
  public readonly deltas: Array<{ chatId: string; content: string; metadata?: Record<string, unknown> }> = [];
  constructor(name: string, bus: MessageBus) {
    super({}, bus, NOOP_LOGGER, STUB_PAIRING);
    this.name = name;
  }
  async start() { this._running = true; }
  async stop() { this._running = false; }
  async send(msg: OutboundMessage) { this.sent.push(msg); }
  async sendDelta(chatId: string, content: string, metadata?: Record<string, unknown>) {
    this.deltas.push({ chatId, content, metadata });
  }
}

/** Script entries describe events the fake orchestrator fires in order,
 *  before resolving with a given `result.text`. */
type ScriptEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string }
  /** Claude CLI-style: executor events are absent, only toolcall_end fires. */
  | { type: "toolcall_end_only"; toolName: string };

function makeFakeOrchestrator(script: ScriptEvent[], resultText: string): Orchestrator {
  return {
    prompt: async (opts: PromptOptions): Promise<PromptResult> => {
      for (const entry of script) {
        if (entry.type === "text") {
          opts.onEvent?.({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: entry.delta },
          } as AgentEvent);
        } else if (entry.type === "tool_start") {
          opts.onEvent?.({ type: "tool_execution_start", toolName: entry.toolName, toolCallId: "t-1", args: {} } as AgentEvent);
        } else if (entry.type === "tool_end") {
          opts.onEvent?.({ type: "tool_execution_end", toolName: entry.toolName, toolCallId: "t-1", isError: false, result: "" } as unknown as AgentEvent);
        } else if (entry.type === "toolcall_end_only") {
          opts.onEvent?.({
            type: "message_update",
            message: { role: "assistant", content: [] },
            assistantMessageEvent: {
              type: "toolcall_end",
              contentIndex: 0,
              toolCall: { type: "toolCall", id: "t-1", name: entry.toolName, arguments: {} },
              partial: { role: "assistant", content: [] },
            },
          } as unknown as AgentEvent);
        }
      }
      return { text: resultText, toolCalls: [] };
    },
    abort: () => {},
    sessionKey: "main",
    getCurrentTurnOrigin: () => null,
  } as unknown as Orchestrator;
}

function makeDispatcher(bus: MessageBus, orchestrator: Orchestrator): { dispatcher: MessageDispatcher; manager: ChannelManager } {
  const mockTools = { get: () => undefined, all: () => [] } as unknown as ToolRegistry;
  const manager = new ChannelManager({ logger: NOOP_LOGGER });
  const dispatcher = new MessageDispatcher(
    bus,
    { sendProgress: true, sendToolHints: false, sendMaxRetries: 1, maxConcurrentRequests: 3 },
    orchestrator,
    mockTools,
    manager,
    NOOP_LOGGER,
  );
  return { dispatcher, manager };
}

async function runDispatch(
  orchestrator: Orchestrator,
  channelName: string,
  inbound: { content: string; metadata: Record<string, unknown> },
  waitMs = 200,
): Promise<CaptureChannel> {
  const bus = new MessageBus();
  const { dispatcher, manager } = makeDispatcher(bus, orchestrator);
  const ch = new CaptureChannel(channelName, bus);
  manager.addChannel(ch);
  bus.publishInbound({
    channel: channelName, senderId: "u1", chatId: "c1",
    content: inbound.content, timestamp: Date.now(), media: [], metadata: inbound.metadata,
  });
  dispatcher.ensureLoopsRunning();
  void manager.startAllChannels();
  await Bun.sleep(waitMs);
  dispatcher.stop();
  return ch;
}

describe("MessageDispatcher — final publish (non-streaming channel: buffer + single send)", () => {
  test("tool-using prompt: pre-tool narration dropped, post-tool text emitted as one send()", async () => {
    const orchestrator = makeFakeOrchestrator([
      { type: "text", delta: "Let me check the wallet..." },   // narration — dropped
      { type: "tool_start", toolName: "get_price" },
      { type: "tool_end", toolName: "get_price" },
      { type: "text", delta: "HYPE at $41.30" },                // post-tool
      { type: "text", delta: ", sideways." },
    ], "Let me check the wallet...HYPE at $41.30, sideways.");
    const ch = await runDispatch(orchestrator, "mock-nostream", { content: "what's HYPE's price?", metadata: {} }, 600);

    // Non-streaming: single send() with joined post-tool text. No sendDelta.
    expect(ch.sent).toHaveLength(1);
    expect(ch.sent[0]!.content).toBe("HYPE at $41.30, sideways.");
    expect(ch.sent[0]!.content).not.toContain("Let me check");
    expect(ch.deltas).toEqual([]);
  });

  test("no-tool prompt: buffer flushed as a single regular send() (no streaming)", async () => {
    const orchestrator = makeFakeOrchestrator([
      { type: "text", delta: "Hi there, " },
      { type: "text", delta: "how can I help?" },
    ], "Hi there, how can I help?");
    const ch = await runDispatch(orchestrator, "mock-nostream", { content: "hi", metadata: {} }, 400);

    // Single regular message — NOT via sendDelta.
    expect(ch.sent).toHaveLength(1);
    expect(ch.sent[0]!.content).toBe("Hi there, how can I help?");
    expect(ch.deltas).toEqual([]);
  });

  test("multi-round: pre-first-tool narration dropped; post-tool deltas from all rounds buffered", async () => {
    // Non-streaming buffers everything post-tool. After the first tool end,
    // buffer is cleared and acceptDelta is armed. "Narration 2" arrives after
    // a second tool end — it also accumulates in the buffer. Final answer
    // and inter-tool narration past the first tool are all emitted together.
    const orchestrator = makeFakeOrchestrator([
      { type: "text", delta: "Narration 1" },
      { type: "tool_start", toolName: "tool_a" },
      { type: "tool_end", toolName: "tool_a" },
      { type: "text", delta: "Narration 2" },
      { type: "tool_start", toolName: "tool_b" },
      { type: "tool_end", toolName: "tool_b" },
      { type: "text", delta: "Final answer." },
    ], "Narration 1Narration 2Final answer.");
    const ch = await runDispatch(orchestrator, "mock-nostream", { content: "analyse", metadata: {} }, 600);

    expect(ch.sent).toHaveLength(1);
    const content = ch.sent[0]!.content;
    expect(content).not.toContain("Narration 1");
    expect(content).toContain("Final answer.");
    expect(ch.deltas).toEqual([]);
  });

  test("Claude CLI provider (toolcall_end only) drops pre-tool narration, emits one send()", async () => {
    const orchestrator = makeFakeOrchestrator([
      { type: "text", delta: "Let me analyse HYPE..." },
      { type: "toolcall_end_only", toolName: "ghost_get_price" },
      { type: "text", delta: "HYPE at $41.30." },
    ], "");
    const ch = await runDispatch(orchestrator, "mock-nostream", { content: "analyse HYPE", metadata: {} }, 600);

    expect(ch.sent).toHaveLength(1);
    expect(ch.sent[0]!.content).toBe("HYPE at $41.30.");
    expect(ch.sent[0]!.content).not.toContain("Let me analyse");
    expect(ch.deltas).toEqual([]);
  });
});
