import type { MethodHandler } from "./method-registry.js";
import type { ApprovalManager } from "./approval.js";

export function registerApprovalMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: { approvalManager: ApprovalManager },
): void {
  const { approvalManager } = deps;

  register("trading.approval.resolve", async (_ctx, payload) => {
    const p = payload as { approvalId?: string; decision?: string; reason?: string } | undefined;
    const approvalId = p?.approvalId;
    const decision = p?.decision;
    const reason = typeof p?.reason === "string" ? p.reason : undefined;

    if (!approvalId) throw new Error("approvalId required");
    if (decision !== "approved" && decision !== "rejected") {
      throw new Error('decision must be "approved" or "rejected"');
    }

    const origin = approvalManager.getOrigin(approvalId);
    if (!origin) {
      // Not found or expired past grace window — keep legacy message for back-compat.
      throw new Error("Approval not found or already resolved");
    }
    if (origin.channel !== "web") {
      throw new Error(
        `Approval belongs to channel ${origin.channel} — please confirm there`,
      );
    }

    const ok = approvalManager.resolve(approvalId, decision, reason);
    if (!ok) throw new Error("Approval not found or already resolved");

    return { ok: true };
  });

  register("trading.approval.pending", async (_ctx, payload) => {
    const p = payload as { sessionKey?: string } | undefined;
    const sessionKey = p?.sessionKey ?? "default";
    const pending = approvalManager.getPending(sessionKey);
    if (!pending) return { pending: null };
    const origin = approvalManager.getOrigin(pending.approvalId);
    // Web clients only see their own pending approvals.
    if (origin && origin.channel !== "web") return { pending: null };
    return { pending };
  });
}
