import { describe, it, expect } from "bun:test";
import { ApprovalManager } from "../../src/gateway/approval.js";
import type { ApprovalPreview } from "../../src/gateway/approval.js";

describe("ApprovalPreview", () => {
  it("accepts wizard + suggestedValue optional fields", () => {
    const preview: ApprovalPreview = {
      action: "place_order",
      actionLabel: "Open BTC Long 10x?",
      details: {},
      wizard: {
        kind: "open_position",
        symbol: "BTC",
        side: "long",
        leverage: 10,
        size: 1,
        orderType: "limit",
        entryPrice: 62342,
      },
      suggestedValue: "1000",
    };
    expect(preview.wizard?.kind).toBe("open_position");
    expect(preview.suggestedValue).toBe("1000");
  });

  it("ApprovalManager.create preserves wizard payload on pending", () => {
    const mgr = new ApprovalManager();
    const preview: ApprovalPreview = {
      action: "x",
      actionLabel: "x",
      details: {},
      wizard: { kind: "generic", groups: [{ rows: [{ label: "a", value: "b" }] }] },
    };
    const { approvalId } = mgr.create("session:1", preview);
    expect(mgr.getPreview(approvalId)?.wizard?.kind).toBe("generic");
  });
});

