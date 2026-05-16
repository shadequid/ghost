import { describe, test, expect } from "bun:test";
import { ApprovalManager } from "../../src/gateway/approval.js";
import type { ApprovalOrigin } from "../../src/events/approval-events.js";

describe("ApprovalManager.nextSeq", () => {
  test("returns monotonic integers starting at 1", () => {
    const mgr = new ApprovalManager();
    expect(mgr.nextSeq()).toBe(1);
    expect(mgr.nextSeq()).toBe(2);
    expect(mgr.nextSeq()).toBe(3);
  });

  test("sequence is independent of approval lifecycle", () => {
    const mgr = new ApprovalManager();
    const seq1 = mgr.nextSeq();
    mgr.create(`tool:${seq1}`, { action: "t", actionLabel: "T", summary: "s", details: {} });
    const pendingApproval = mgr.getPending(`tool:${seq1}`);
    if (pendingApproval) {
      mgr.resolve(pendingApproval.approvalId, "rejected");
    }
    const seq2 = mgr.nextSeq();
    expect(seq2).toBe(seq1 + 1);
  });
});

describe("ApprovalManager.getOrigin", () => {
  const preview = { action: "t", actionLabel: "T", summary: "s", details: {} };

  test("returns origin when create() was called with one", () => {
    const mgr = new ApprovalManager();
    const origin: ApprovalOrigin = { channel: "telegram", chatId: "123" };
    const { approvalId } = mgr.create("sess", preview, origin);
    expect(mgr.getOrigin(approvalId)).toEqual(origin);
  });

  test("returns null when create() was called without origin", () => {
    const mgr = new ApprovalManager();
    const { approvalId } = mgr.create("sess", preview);
    expect(mgr.getOrigin(approvalId)).toBeNull();
  });

  test("returns null for unknown approvalId", () => {
    const mgr = new ApprovalManager();
    expect(mgr.getOrigin("nonexistent")).toBeNull();
  });

  test("returns null after approval resolved + grace expires", async () => {
    const mgr = new ApprovalManager();
    const origin: ApprovalOrigin = { channel: "web", chatId: "1" };
    const { approvalId } = mgr.create("sess", preview, origin);
    mgr.resolve(approvalId, "approved");
    // Still readable during RESOLVED_GRACE_MS
    expect(mgr.getOrigin(approvalId)?.channel).toBe("web");
  });
});

describe("ApprovalManager.create", () => {
  test("returns createdAtMs directly (no auto-expiry)", () => {
    const mgr = new ApprovalManager();
    const before = Date.now();
    const result = mgr.create(
      "tool:1",
      { action: "t", actionLabel: "T", summary: "s", details: {} },
      null,
    );
    const after = Date.now();

    expect(result.approvalId).toBeDefined();
    expect(result.promise).toBeDefined();
    expect(result.createdAtMs).toBeGreaterThanOrEqual(before);
    expect(result.createdAtMs).toBeLessThanOrEqual(after);
    // expiresAtMs intentionally removed — confirms wait indefinitely.
    expect((result as { expiresAtMs?: number }).expiresAtMs).toBeUndefined();
  });

  test("returned timestamps match getPending()", () => {
    const mgr = new ApprovalManager();
    const result = mgr.create(
      "tool:2",
      { action: "t", actionLabel: "T", summary: "s", details: {} },
    );
    const pending = mgr.getPending("tool:2");
    expect(pending).not.toBeNull();
    if (pending) {
      expect(pending.createdAtMs).toBe(result.createdAtMs);
    }
  });
});
