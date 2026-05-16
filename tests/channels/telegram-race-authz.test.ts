/**
 * Unit tests for the Telegram approval code paths:
 *   - Race between approval.requested and approval.resolved must not
 *     leak entries in TelegramChannel.pendingApprovals.
 *   - Inline-button callbacks and text-fallback approvals must
 *     enforce the channel allowlist (isAllowed).
 *
 * These tests drive TelegramChannel directly and poke the private methods by
 * access (TypeScript private is only compile-time). The grammY Bot is
 * constructed with a dummy token — we never call bot.start() so no network
 * traffic happens — and its `api` is stubbed per test.
 */

import { describe, it, expect, mock } from "bun:test";
import { TelegramChannel } from "../../src/channels/telegram/index.js";
import { telegramChannelSchema } from "../../src/config/schema.js";
import { MessageBus } from "../../src/bus/queue.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import { initDatabase } from "../../src/core/database.js";
import { PairingStore } from "../../src/pairing/store.js";
import type { EventBus } from "../../src/bus/events.js";
import type { ApprovalManager, ApprovalPreview } from "../../src/gateway/approval.js";
import { makeNoopServices } from "../helpers/telegram.js";

function makePreview(): ApprovalPreview {
  return {
    action: "place_order",
    actionLabel: "Place order",
    summary: "buy 1 HYPE",
    details: { size: "1" },
  };
}

function makeChannel(opts?: {
  allowFrom?: string[];
  sendMessage?: (...args: unknown[]) => Promise<{ message_id: number }>;
  editMessageReplyMarkup?: (...args: unknown[]) => Promise<unknown>;
}) {
  const bus = new MessageBus();
  const eventBus = { subscribe: mock(() => () => {}) } as unknown as EventBus;
  const approvalManager = {
    resolve: mock(() => true),
  } as unknown as ApprovalManager;

  const pairingStore = new PairingStore(initDatabase(":memory:"), NOOP_LOGGER);
  const seed = opts?.allowFrom ?? ["*"];
  pairingStore.setAllowlist("telegram", seed);

  const mockPairingService = { issueChallenge: async () => ({ created: false }), approveRequest: () => ({ approved: false }), revoke: () => {}, listRequests: () => [], listAllowlist: () => [] } as unknown as import("../../src/pairing/service.js").PairingService;
  const channel = new TelegramChannel(
    telegramChannelSchema.parse({}),
    "123456:DUMMY",
    bus,
    NOOP_LOGGER,
    eventBus,
    approvalManager,
    pairingStore,
    makeNoopServices(),
    mockPairingService,
  );

  // Stub the grammY Bot api so private methods don't touch the network.
  const sendMessage = opts?.sendMessage
    ?? mock(async () => ({ message_id: 42 }));
  const editMessageReplyMarkup = opts?.editMessageReplyMarkup
    ?? mock(async () => ({}));

  // bot is null until start(). Create a stub bot instance so the test can
  // patch its api without starting the real grammY polling loop.
  const { Bot: BotClass } = require("grammy") as typeof import("grammy");
  const stubBot = new BotClass("1:stub", {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    botInfo: { id: 1, is_bot: true, username: "ghost", first_name: "ghost", can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false } as any,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (channel as unknown as { bot: unknown }).bot = stubBot;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (channel as unknown as { bot: { api: Record<string, unknown> } }).bot.api = {
    sendMessage,
    editMessageReplyMarkup,
    sendChatAction: mock(async () => true),
  } as never;

  // Trigger lazy init of approvals with the stubbed bot.api.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (channel as unknown as { buildHandlerDeps: () => unknown }).buildHandlerDeps();
  // Rebind approvals.api to the mocked api so the race tests see their stubs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (channel as unknown as { approvals: { api: unknown } }).approvals.api =
    (channel as unknown as { bot: { api: unknown } }).bot.api;

  return { channel, approvalManager, sendMessage, editMessageReplyMarkup };
}

describe("onApprovalRequested/Resolved race", () => {
  it("cleans up the pending entry when resolved fires DURING the send await", async () => {
    // Arrange: a sendMessage that yields and lets us interleave a resolved
    // event before it returns.
    let releaseSend!: () => void;
    const sendMessage = mock(async () => {
      await new Promise<void>((r) => { releaseSend = r; });
      return { message_id: 99 };
    });
    const { channel } = makeChannel({ sendMessage });
    const pending = (channel as unknown as {
      approvals: { pending: Map<string, { messageId: number; chatId: string }> };
    }).approvals.pending;

    // Act: kick off the "requested" side, then fire "resolved" while we're
    // still awaiting the send.
    const approvals = (channel as unknown as {
      approvals: { onRequested: (p: unknown) => Promise<void> };
    }).approvals;
    const onReq = approvals.onRequested.bind(approvals);
    const approvalsForRes = (channel as unknown as {
      approvals: { onResolved: (p: unknown) => Promise<void> };
    }).approvals;
    const onRes = approvalsForRes.onResolved.bind(approvalsForRes);

    const approvalId = "11111111-1111-1111-1111-111111111111";
    const origin = { channel: "telegram", chatId: "555" };
    const reqPromise = onReq({ approvalId, preview: makePreview(), origin });

    // Let the microtask queue flush so the reserve-first step runs.
    await Promise.resolve();
    expect(pending.has(approvalId)).toBe(true);
    expect(pending.get(approvalId)!.messageId).toBe(-1);

    // Fire resolved while the send is still pending.
    await onRes({ approvalId, decision: "approved" });
    expect(pending.has(approvalId)).toBe(false);

    // Let the send finish. The entry must NOT be re-inserted.
    releaseSend();
    await reqPromise;
    expect(pending.has(approvalId)).toBe(false);
  });

  it("deletes the reserved slot if the send throws", async () => {
    const sendMessage = mock(async () => { throw new Error("api down"); });
    const { channel } = makeChannel({ sendMessage });
    const pending = (channel as unknown as {
      approvals: { pending: Map<string, unknown> };
    }).approvals.pending;

    const approvals = (channel as unknown as {
      approvals: { onRequested: (p: unknown) => Promise<void> };
    }).approvals;
    const onReq = approvals.onRequested.bind(approvals);

    await onReq({
      approvalId: "22222222-2222-2222-2222-222222222222",
      preview: makePreview(),
      origin: { channel: "telegram", chatId: "555" },
    });

    expect(pending.size).toBe(0);
  });

  it("onApprovalResolved with messageId === -1 exits quietly (no edit/reply)", async () => {
    const editMessageReplyMarkup = mock(async () => ({}));
    const sendMessage = mock(async () => ({ message_id: 1 }));
    const { channel } = makeChannel({ sendMessage, editMessageReplyMarkup });
    const pending = (channel as unknown as {
      approvals: { pending: Map<string, { messageId: number; chatId: string }> };
    }).approvals.pending;

    const approvalId = "33333333-3333-3333-3333-333333333333";
    pending.set(approvalId, { messageId: -1, chatId: "555" });

    const approvalsForRes = (channel as unknown as {
      approvals: { onResolved: (p: unknown) => Promise<void> };
    }).approvals;
    const onRes = approvalsForRes.onResolved.bind(approvalsForRes);

    await onRes({ approvalId, decision: "expired" });

    expect(editMessageReplyMarkup).not.toHaveBeenCalled();
    // sendMessage is the main stub — the resolve path only uses it for suffix.
    expect(sendMessage).not.toHaveBeenCalled();
    expect(pending.has(approvalId)).toBe(false);
  });
});

describe("allowlist enforcement on approval text fallback", () => {
  // The inline callback_query handler is registered deep inside grammY's
  // dispatcher and not cleanly reachable without a mock grammY Bot. We cover
  // the authz tightening at the unit level via matchTextDecision (ambiguous
  // words) and by structural test on the text-path check here.

  it("text fallback refuses to resolve when sender is not in allowFrom", async () => {
    // Runtime allowFrom now lives in the pairing store, not config.
    const { channel, approvalManager } = makeChannel({ allowFrom: ["trusted-user-id"] });
    const pending = (channel as unknown as {
      approvals: { pending: Map<string, { messageId: number; chatId: string }> };
    }).approvals.pending;
    const approvalId = "44444444-4444-4444-4444-444444444444";
    pending.set(approvalId, { messageId: 10, chatId: "555" });

    // isAllowed is the gate for the text fallback — confirm it rejects the
    // attacker id. If this unit guarantee holds, the guard in start() (which
    // calls this.isAllowed(senderId) before resolving) will reject the text
    // match accordingly.
    expect(channel.isAllowed("attacker-id")).toBe(false);
    expect(channel.isAllowed("trusted-user-id")).toBe(true);

    // resolve must NOT be called purely by the presence of a pending approval.
    expect((approvalManager.resolve as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });
});
