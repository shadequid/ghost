import { describe, test, expect } from "bun:test";
import { ApprovalManager } from "../../src/gateway/approval.js";

describe("Tool approval via ApprovalManager", () => {
  test("create and approve tool approval", async () => {
    const mgr = new ApprovalManager();
    const preview = {
      action: "exec",
      actionLabel: "Execute Command",
      summary: "npx --yes clawhub@latest search weather",
      details: { risk: "medium", tool: "exec" },
      riskAssessment: "medium",
    };

    const { approvalId, promise } = mgr.create("tool", preview);
    expect(approvalId).toBeTruthy();

    // Resolve as approved
    const ok = mgr.resolve(approvalId, "approved");
    expect(ok).toBe(true);

    const decision = await promise;
    expect(decision).toBe("approved");
  });

  test("create and reject tool approval", async () => {
    const mgr = new ApprovalManager();
    const preview = {
      action: "write_file",
      actionLabel: "Write File",
      summary: "/outside/workspace/file.txt",
      details: { risk: "path_restricted", tool: "write_file" },
    };

    const { approvalId, promise } = mgr.create("tool", preview);
    const ok = mgr.resolve(approvalId, "rejected");
    expect(ok).toBe(true);

    const decision = await promise;
    expect(decision).toBe("rejected");
  });

  test("tool and trading approvals use separate session keys", async () => {
    const mgr = new ApprovalManager();
    const toolPreview = {
      action: "exec",
      actionLabel: "Execute Command",
      summary: "mv file.txt backup/",
      details: { risk: "medium", tool: "exec" },
    };
    const tradingPreview = {
      action: "confirm_order",
      actionLabel: "Confirm Order",
      summary: "BUY BTC MARKET",
      details: { size: "0.01" },
      direction: "long" as const,
    };

    const tool = mgr.create("tool", toolPreview);
    const trading = mgr.create("default", tradingPreview);

    // Both should be pending independently
    expect(mgr.getPending("tool")).toBeTruthy();
    expect(mgr.getPending("default")).toBeTruthy();

    mgr.resolve(tool.approvalId, "approved");
    mgr.resolve(trading.approvalId, "rejected");

    expect(await tool.promise).toBe("approved");
    expect(await trading.promise).toBe("rejected");
  });

  test("supersede expires the previous pending approval", async () => {
    // The 5-min auto-cancel timer was dropped (web mock v2). The only
    // remaining producer of `expired` is a same-session supersede — when
    // a new approval claims a sessionKey that already has a pending one,
    // the old waiter unblocks with `expired` so callers don't deadlock.
    const mgr = new ApprovalManager();
    const preview = {
      action: "exec",
      actionLabel: "Execute Command",
      summary: "some-cmd",
      details: { risk: "medium", tool: "exec" },
    };

    const first = mgr.create("tool", preview);
    mgr.create("tool", preview); // supersede
    const decision = await first.promise;
    expect(decision).toBe("expired");
  });

  test("getPending returns null after resolution", async () => {
    const mgr = new ApprovalManager();
    const preview = {
      action: "exec",
      actionLabel: "Execute Command",
      summary: "cmd",
      details: {},
    };

    const { approvalId } = mgr.create("tool", preview);
    expect(mgr.getPending("tool")).toBeTruthy();

    mgr.resolve(approvalId, "approved");
    expect(mgr.getPending("tool")).toBeNull();
  });
});
