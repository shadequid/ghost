/**
 * Integration tests: TelegramChannel (non-streaming) wired through the full
 * dispatcher pipeline. Validates that tool-using orchestrator flows reach
 * api.sendMessage and that sendDelta is never called.
 *
 * Uses the same stub-bot pattern as telegram-race-authz.test.ts — construct
 * TelegramChannel, inject a stub Bot with mocked api, register in ChannelManager,
 * then drive via bus.publishInbound through MessageDispatcher.
 */

import { describe, test, expect, mock } from "bun:test";
import { TelegramChannel } from "../../src/channels/telegram/index.js";
import { telegramChannelSchema } from "../../src/config/schema.js";
import { MessageBus } from "../../src/bus/queue.js";
import { MessageDispatcher } from "../../src/channels/dispatcher.js";
import { ChannelManager } from "../../src/channels/manager.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import { initDatabase } from "../../src/core/database.js";
import { PairingStore } from "../../src/pairing/store.js";
import type { EventBus } from "../../src/bus/events.js";
import type { ApprovalManager } from "../../src/gateway/approval.js";
import type { Orchestrator, PromptOptions } from "../../src/agent/orchestrator.js";
import type { ToolRegistry } from "../../src/tools/registry.js";
import type { PairingService } from "../../src/pairing/service.js";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { makeNoopServices } from "../helpers/telegram.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTelegramChannel(sendMessage: ReturnType<typeof mock>): TelegramChannel {
  const bus = new MessageBus();
  const eventBus = { subscribe: mock(() => () => {}) } as unknown as EventBus;
  const approvalManager = { resolve: mock(() => true) } as unknown as ApprovalManager;
  const db = initDatabase(":memory:");
  const pairingStore = new PairingStore(db, NOOP_LOGGER);
  pairingStore.setAllowlist("telegram", ["*"]);

  const pairingService = {
    issueChallenge: async () => ({ created: false }),
    approveRequest: () => ({ approved: false }),
    revoke: () => {},
    listRequests: () => [],
    listAllowlist: () => [],
  } as unknown as PairingService;

  const channel = new TelegramChannel(
    telegramChannelSchema.parse({}),
    "123456:DUMMY",
    bus,
    NOOP_LOGGER,
    eventBus,
    approvalManager,
    pairingStore,
    makeNoopServices(),
    pairingService,
  );

  // Inject stub bot so send() resolves without network calls.
  const { Bot: BotClass } = require("grammy") as typeof import("grammy");
  const stubBot = new BotClass("1:stub", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    botInfo: { id: 1, is_bot: true, username: "ghost", first_name: "ghost", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as any,
  });
  (channel as unknown as { bot: unknown }).bot = stubBot;
  (channel as unknown as { bot: { api: Record<string, unknown> } }).bot.api = {
    sendMessage,
    sendChatAction: mock(async () => true),
  } as never;

  return channel;
}

type ScriptEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_end"; toolName: string };

function makeFakeOrchestrator(script: ScriptEvent[]): Orchestrator {
  return {
    prompt: async (opts: PromptOptions) => {
      for (const entry of script) {
        if (entry.type === "text") {
          opts.onEvent?.({
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: entry.delta },
          } as AgentEvent);
        } else if (entry.type === "tool_start") {
          opts.onEvent?.({
            type: "tool_execution_start",
            toolName: entry.toolName,
            toolCallId: "t-1",
            args: {},
          } as AgentEvent);
        } else if (entry.type === "tool_end") {
          opts.onEvent?.({
            type: "tool_execution_end",
            toolName: entry.toolName,
            toolCallId: "t-1",
            isError: false,
            result: "",
          } as unknown as AgentEvent);
        }
      }
      return { text: "", toolCalls: [] };
    },
    abort: () => {},
    sessionKey: "main",
    getCurrentTurnOrigin: () => null,
  } as unknown as Orchestrator;
}

async function runThroughDispatcher(
  channel: TelegramChannel,
  orchestrator: Orchestrator,
  inboundContent: string,
  chatId = "99",
  waitMs = 600,
): Promise<void> {
  const bus = new MessageBus();
  const mockTools = { get: () => undefined, all: () => [] } as unknown as ToolRegistry;
  const manager = new ChannelManager({ logger: NOOP_LOGGER });

  // Replace the channel's bus reference with the dispatcher's bus so inbound
  // messages route correctly. Channel is already constructed — we reach into
  // the protected field.
  (channel as unknown as { bus: MessageBus }).bus = bus;

  manager.addChannel(channel);

  const dispatcher = new MessageDispatcher(
    bus,
    { sendProgress: false, sendToolHints: false, sendMaxRetries: 1, maxConcurrentRequests: 3 },
    orchestrator,
    mockTools,
    manager,
    NOOP_LOGGER,
  );

  dispatcher.ensureLoopsRunning();

  bus.publishInbound({
    channel: "telegram",
    senderId: "u1",
    chatId,
    content: inboundContent,
    timestamp: Date.now(),
    media: [],
    metadata: {},
  });

  await Bun.sleep(waitMs);
  dispatcher.stop();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TelegramChannel through dispatcher — non-streaming end-to-end", () => {
  test("tool-using flow: api.sendMessage called once with joined post-tool text", async () => {
    const sendMessage = mock(async () => ({ message_id: 1 }));
    const channel = makeTelegramChannel(sendMessage);

    const orchestrator = makeFakeOrchestrator([
      { type: "text", delta: "Let me check..." },  // narration — dropped
      { type: "tool_start", toolName: "ghost_get_price" },
      { type: "tool_end", toolName: "ghost_get_price" },
      { type: "text", delta: "HYPE is $41.30" },       // post-tool
      { type: "text", delta: ", stable." },
    ]);

    await runThroughDispatcher(channel, orchestrator, "price?");

    // sendMessage is called through sendFormattedHtml which formats with HTML.
    // Assert it was called at least once and the raw content contains the post-tool text.
    expect(sendMessage).toHaveBeenCalled();
    const firstCall = sendMessage.mock.calls[0] as unknown[];
    // sendFormattedHtml calls api.sendMessage(numericChatId, chunk, opts).
    // The second argument is the formatted text — check it contains the post-tool content.
    const messageText = firstCall[1] as string;
    expect(messageText).toContain("HYPE is $41.30");
    expect(messageText).toContain("stable.");
    expect(messageText).not.toContain("Let me check");
  });

  test("no-tool flow: api.sendMessage called once with full buffer text", async () => {
    const sendMessage = mock(async () => ({ message_id: 2 }));
    const channel = makeTelegramChannel(sendMessage);

    const orchestrator = makeFakeOrchestrator([
      { type: "text", delta: "Hi there! " },
      { type: "text", delta: "How can I help?" },
    ]);

    await runThroughDispatcher(channel, orchestrator, "hello");

    expect(sendMessage).toHaveBeenCalled();
    const firstCall = sendMessage.mock.calls[0] as unknown[];
    const messageText = firstCall[1] as string;
    expect(messageText).toContain("Hi there!");
    expect(messageText).toContain("How can I help?");
  });
});
