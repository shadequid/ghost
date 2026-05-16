import { describe, test, expect } from "bun:test";
import pino from "pino";
import { EventBus } from "../../src/bus/events.js";
import { ApprovalManager } from "../../src/gateway/approval.js";
import { DaemonConfirmService } from "../../src/services/trading-confirm.js";
import type { GhostEvent } from "../../src/events/index.js";
import type { Orchestrator } from "../../src/agent/orchestrator.js";

const silent = pino({ level: "silent" });

function makeOrchestrator(preText: string): Orchestrator {
  return {
    getCurrentTurnText: () => preText,
    getCurrentTurnOrigin: () => ({ channel: "web" as const, chatId: "test" }),
  } as unknown as Orchestrator;
}

describe("trading approval flow (B3 regression)", () => {
  test("resolve emits exactly one trading.approval.resolved", async () => {
    const bus = new EventBus(silent);
    const mgr = new ApprovalManager();
    const svc = new DaemonConfirmService(mgr, bus, makeOrchestrator("analysis preface"));

    const events: GhostEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const confirmPromise = svc.confirm("Buy BTC", { lines: ["Long BTC 1x | size: 100"] });

    // Requested event fires synchronously inside confirm()
    await new Promise((r) => setTimeout(r, 0));
    const requested = events.filter((e) => e.type === "trading.approval.requested");
    expect(requested).toHaveLength(1);
    if (requested[0].type === "trading.approval.requested") {
      expect(requested[0].payload.preText).toBe("analysis preface");
    }

    // Resolve the approval
    const sessionKey = requested[0].type === "trading.approval.requested"
      ? requested[0].payload.sessionKey
      : "";
    const pending = mgr.getPending(sessionKey);
    expect(pending).not.toBeNull();
    mgr.resolve(pending!.approvalId, "approved");

    const ok = await confirmPromise;
    expect(ok).toEqual({ decision: "approved" });

    const resolved = events.filter((e) => e.type === "trading.approval.resolved");
    expect(resolved).toHaveLength(1); // B3 fix: no duplicate
    if (resolved[0].type === "trading.approval.resolved") {
      expect(resolved[0].payload.decision).toBe("approved");
    }
  });

  test("rejected decision returns false and emits exactly one resolved", async () => {
    const bus = new EventBus(silent);
    const mgr = new ApprovalManager();
    const svc = new DaemonConfirmService(mgr, bus, makeOrchestrator(""));

    const events: GhostEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const p = svc.confirm("Sell ETH", { lines: ["Short ETH"] });
    await new Promise((r) => setTimeout(r, 0));
    const req = events.find((e) => e.type === "trading.approval.requested");
    expect(req).toBeDefined();
    if (req && req.type === "trading.approval.requested") {
      mgr.resolve(req.payload.approvalId, "rejected");
    }
    const ok = await p;
    expect(ok).toEqual({ decision: "rejected" });
    expect(events.filter((e) => e.type === "trading.approval.resolved")).toHaveLength(1);
  });
});
