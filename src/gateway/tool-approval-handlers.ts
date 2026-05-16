import type { MethodHandler } from "./method-registry.js";
import type { ApprovalManager } from "./approval.js";

export function registerToolApprovalMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: { approvalManager: ApprovalManager },
): void {
  const { approvalManager } = deps;

  register("tool.approval.resolve", async (_ctx, payload) => {
    const p = payload as { approvalId?: string; decision?: string } | undefined;
    const approvalId = p?.approvalId;
    const decision = p?.decision;

    if (!approvalId) throw new Error("approvalId required");
    if (decision !== "approved" && decision !== "rejected") {
      throw new Error('decision must be "approved" or "rejected"');
    }

    const ok = approvalManager.resolve(approvalId, decision);
    if (!ok) throw new Error("Approval not found or already resolved");

    return { ok: true };
  });

  register("tool.approval.pending", async (_ctx, payload) => {
    const p = payload as { sessionKey?: string } | undefined;
    const sessionKey = p?.sessionKey ?? "default";
    const pending = approvalManager.getPending(sessionKey);
    return { pending };
  });
}
