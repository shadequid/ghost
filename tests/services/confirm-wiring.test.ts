/**
 * Integration test for the describer → ConfirmService.confirm → published
 * ApprovalPreview pipeline. Exercises the production orchestrator-level
 * confirm path (`runBatchedConfirm`) to guarantee `desc.wizard` and
 * `desc.suggestedValue` survive end-to-end, not just per-layer.
 *
 * Regression guard for CR-23-01 Major #1.
 */

import { describe, test, expect } from "bun:test";
import pino from "pino";
import { runBatchedConfirm } from "../../src/runtime.js";
import { describeConfirm } from "../../src/services/confirm-policy.js";
import { DaemonConfirmService } from "../../src/services/trading-confirm.js";
import { ApprovalManager } from "../../src/gateway/approval.js";
import { EventBus } from "../../src/bus/events.js";
import type { Orchestrator } from "../../src/agent/orchestrator.js";

describe("confirm wiring — orchestrator path forwards describer wizard", () => {
  test("ghost_place_order via runBatchedConfirm publishes preview.wizard", async () => {
    const origin = { channel: "web", chatId: "ws-1" };
    const approvalManager = new ApprovalManager();
    const eventBus = new EventBus(pino({ level: "silent" }));
    const captured: Array<{ type: string; payload: { preview: { wizard?: { kind: string; symbol?: string; leverage?: number } }; approvalId: string } }> = [];
    eventBus.subscribe((e) => {
      if (e.type === "trading.approval.requested") captured.push(e as never);
    });
    const orchestrator = {
      getCurrentTurnText: () => "place an order",
      getCurrentTurnOrigin: () => origin,
    } as unknown as Orchestrator;
    const confirmService = new DaemonConfirmService(approvalManager, eventBus, orchestrator);

    const args = {
      symbol: "BTC",
      side: "buy",
      size: 1,
      leverage: 10,
      orderType: "limit",
      price: 62342,
    };
    // Sanity: describer itself emits a wizard.
    const desc = describeConfirm("ghost_place_order", args);
    expect(desc.wizard?.kind).toBe("open_position");

    // Production assistant-message shape: a single confirmable toolCall block.
    const assistantMessage = {
      content: [
        { type: "toolCall", name: "ghost_place_order", arguments: args },
      ],
    };
    const batchCache = new WeakMap();

    const p = runBatchedConfirm(
      assistantMessage,
      "ghost_place_order",
      args,
      batchCache,
      { getConfirmService: () => confirmService },
      pino({ level: "silent" }),
    );

    // The confirm publishes synchronously inside the promise; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(captured.length).toBe(1);
    const { preview, approvalId } = captured[0].payload;
    expect(preview.wizard).toBeDefined();
    expect(preview.wizard?.kind).toBe("open_position");
    expect(preview.wizard?.symbol).toBe("BTC");
    expect(preview.wizard?.leverage).toBe(10);

    approvalManager.resolve(approvalId, "rejected");
    await p;
  });

  test("multi-call batched path intentionally drops wizard", async () => {
    // Documented choice (see runtime.ts comment near the batched confirm call):
    // when multiple confirmable tools are batched into a single card, no
    // wizard is shown — too many wizards is confusing. This test pins that
    // decision.
    const origin = { channel: "web", chatId: "ws-2" };
    const approvalManager = new ApprovalManager();
    const eventBus = new EventBus(pino({ level: "silent" }));
    const captured: Array<{ type: string; payload: { preview: { wizard?: unknown }; approvalId: string } }> = [];
    eventBus.subscribe((e) => {
      if (e.type === "trading.approval.requested") captured.push(e as never);
    });
    const orchestrator = {
      getCurrentTurnText: () => "do two things",
      getCurrentTurnOrigin: () => origin,
    } as unknown as Orchestrator;
    const confirmService = new DaemonConfirmService(approvalManager, eventBus, orchestrator);

    const args1 = { symbol: "BTC", side: "buy", size: 1, leverage: 10, orderType: "market" };
    const args2 = { symbol: "ETH", stopLoss: 2500 };
    const assistantMessage = {
      content: [
        { type: "toolCall", name: "ghost_place_order", arguments: args1 },
        { type: "toolCall", name: "ghost_set_sl_tp", arguments: args2 },
      ],
    };
    const batchCache = new WeakMap();
    const p = runBatchedConfirm(
      assistantMessage,
      "ghost_place_order",
      args1,
      batchCache,
      { getConfirmService: () => confirmService },
      pino({ level: "silent" }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(captured.length).toBe(1);
    const { preview, approvalId } = captured[0].payload;
    expect(preview.wizard).toBeUndefined();
    approvalManager.resolve(approvalId, "rejected");
    await p;
  });

});
