import { describe, test, expect } from "bun:test";
import { registerApprovalMethods } from "../../src/gateway/approval-handlers.js";
import { ApprovalManager } from "../../src/gateway/approval.js";
import type { MethodHandler } from "../../src/gateway/method-registry.js";

function setup(approvalManager: ApprovalManager) {
  const handlers = new Map<string, MethodHandler>();
  registerApprovalMethods(
    (method, handler) => handlers.set(method, handler),
    { approvalManager },
  );
  return handlers;
}

const preview = { action: "t", actionLabel: "T", summary: "s", details: {} };

describe("trading.approval.resolve — origin guard", () => {
  test("resolves web-origin approval", async () => {
    const mgr = new ApprovalManager();
    const { approvalId } = mgr.create("sess", preview, { channel: "web", chatId: "1" });
    const handlers = setup(mgr);
    const handler = handlers.get("trading.approval.resolve")!;
    const res = await handler({} as never, { approvalId, decision: "approved" });
    expect(res).toEqual({ ok: true });
  });

  test("rejects telegram-origin approval with explicit message", async () => {
    const mgr = new ApprovalManager();
    const { approvalId } = mgr.create("sess", preview, { channel: "telegram", chatId: "1" });
    const handlers = setup(mgr);
    const handler = handlers.get("trading.approval.resolve")!;
    await expect(
      handler({} as never, { approvalId, decision: "approved" }),
    ).rejects.toThrow(/belongs to channel telegram/);
  });

  test("rejects unknown approvalId with not-found message", async () => {
    const mgr = new ApprovalManager();
    const handlers = setup(mgr);
    const handler = handlers.get("trading.approval.resolve")!;
    await expect(
      handler({} as never, { approvalId: "nonexistent", decision: "approved" }),
    ).rejects.toThrow(/not found or already resolved/);
  });
});

describe("trading.approval.pending — origin filter", () => {
  test("returns web-origin pending when requested", async () => {
    const mgr = new ApprovalManager();
    mgr.create("default", preview, { channel: "web", chatId: "1" });
    const handlers = setup(mgr);
    const handler = handlers.get("trading.approval.pending")!;
    const res = await handler({} as never, { sessionKey: "default" }) as { pending: unknown };
    expect(res.pending).not.toBeNull();
  });

  test("hides telegram-origin pending from web caller", async () => {
    const mgr = new ApprovalManager();
    mgr.create("default", preview, { channel: "telegram", chatId: "1" });
    const handlers = setup(mgr);
    const handler = handlers.get("trading.approval.pending")!;
    const res = await handler({} as never, { sessionKey: "default" }) as { pending: unknown };
    expect(res.pending).toBeNull();
  });
});
