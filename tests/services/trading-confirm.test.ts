import { describe, test, expect, it, mock } from "bun:test";
import { DaemonConfirmService } from "../../src/services/trading-confirm.js";
import type { ConfirmBody, ConfirmExtras } from "../../src/services/trading-confirm.js";
import { ApprovalManager } from "../../src/gateway/approval.js";
import type { EventBus } from "../../src/bus/events.js";
import type { Orchestrator } from "../../src/agent/orchestrator.js";

function makeDeps(origin: { channel: string; chatId: string } | null) {
  const approvalManager = new ApprovalManager();
  const eventBus = { publish: mock(() => {}), subscribe: mock(() => () => {}) } as unknown as EventBus;
  const orchestrator = {
    getCurrentTurnText: () => "test",
    getCurrentTurnOrigin: () => origin,
  } as unknown as Orchestrator;
  return { approvalManager, eventBus, orchestrator };
}

describe("DaemonConfirmService.confirm — origin requirement", () => {
  test("throws when orchestrator returns null origin", async () => {
    const { approvalManager, eventBus, orchestrator } = makeDeps(null);
    const svc = new DaemonConfirmService(approvalManager, eventBus, orchestrator);
    await expect(svc.confirm("Place order", { lines: ["long BTC 1x"] })).rejects.toThrow(
      "trading approval requires a channel origin",
    );
  });

  test("passes origin into approvalManager.create", async () => {
    const origin = { channel: "telegram", chatId: "555" };
    const { approvalManager, eventBus, orchestrator } = makeDeps(origin);
    const svc = new DaemonConfirmService(approvalManager, eventBus, orchestrator);
    const p = svc.confirm("Place order", { lines: ["long BTC 1x"] });
    await Promise.resolve();
    const publishMock = (eventBus as unknown as { publish: ReturnType<typeof mock> }).publish;
    expect(publishMock).toHaveBeenCalled();
    const firstCall = publishMock.mock.calls[0] as unknown as [{ type: string; payload: { approvalId: string; origin: typeof origin } }];
    const publishedEvent = firstCall[0];
    expect(publishedEvent.type).toBe("trading.approval.requested");
    expect(publishedEvent.payload.origin).toEqual(origin);
    approvalManager.resolve(publishedEvent.payload.approvalId, "rejected");
    await p;
  });
});

// Regression: tools whose describer returns `lines: []` (cancel-all,
// emergency-close, etc.) used to surface a bullet duplicating the title
// because `summary` fell back to `title` and the renderer's legacy fallback
// pushed it as a bullet. The preview must (a) not echo `title` into
// `summary`, and (b) preserve `lines: []` so the renderer skips its
// legacy fallback path entirely.
describe("DaemonConfirmService.confirm — empty bullets stay empty", () => {
  test("body with empty lines/steps emits summary=undefined and lines=[]", async () => {
    const origin = { channel: "web", chatId: "ws-1" };
    const { approvalManager, eventBus, orchestrator } = makeDeps(origin);
    const svc = new DaemonConfirmService(approvalManager, eventBus, orchestrator);
    const p = svc.confirm("Cancel all open orders on BTC", { lines: [], steps: [] });
    await Promise.resolve();
    const publishMock = (eventBus as unknown as { publish: ReturnType<typeof mock> }).publish;
    const firstCall = publishMock.mock.calls[0] as unknown as [
      { type: string; payload: { approvalId: string; preview: { summary?: string; lines?: string[]; steps?: string[]; actionLabel: string } } },
    ];
    const { preview, approvalId } = firstCall[0].payload;
    expect(preview.actionLabel).toBe("Cancel all open orders on BTC");
    expect(preview.summary).toBeUndefined();
    expect(preview.lines).toEqual([]);
    expect(preview.steps).toBeUndefined();
    approvalManager.resolve(approvalId, "rejected");
    await p;
  });
});

describe("ConfirmExtras", () => {
  it("accepts wizard + suggestedValue", () => {
    const extras: ConfirmExtras = {
      wizard: { kind: "generic", groups: [{ rows: [{ label: "x", value: "y" }] }] },
      suggestedValue: "1000",
    };
    expect(extras.wizard?.kind).toBe("generic");
  });

  it("ConfirmBody legacy shape still typechecks", () => {
    const body: ConfirmBody = { lines: ["one"], steps: ["step1"] };
    expect(body.lines?.length).toBe(1);
  });

  it("confirm propagates extras into ApprovalPreview", async () => {
    const origin = { channel: "web", chatId: "1" };
    const approvalManager = new ApprovalManager();
    const publishMock = mock(() => {});
    const eventBus = { publish: publishMock, subscribe: mock(() => () => {}) } as unknown as EventBus;
    const orchestrator = {
      getCurrentTurnText: () => "test",
      getCurrentTurnOrigin: () => origin,
    } as unknown as Orchestrator;
    const svc = new DaemonConfirmService(approvalManager, eventBus, orchestrator);
    const p = svc.confirm("Set size", { lines: ["BTC 1x"] }, {
      wizard: { kind: "generic", groups: [{ rows: [{ label: "Size", value: "1000" }] }] },
      suggestedValue: "1000",
    });
    const firstCall = publishMock.mock.calls[0] as unknown as [{ payload: { preview: { wizard?: { kind: string }; suggestedValue?: string }; approvalId: string } }];
    const { preview, approvalId } = firstCall[0].payload;
    expect(preview.wizard?.kind).toBe("generic");
    expect(preview.suggestedValue).toBe("1000");
    approvalManager.resolve(approvalId, "rejected");
    await p;
  });
});
