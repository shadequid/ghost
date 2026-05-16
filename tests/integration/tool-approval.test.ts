import { describe, test, expect } from "bun:test";
import pino from "pino";
import { EventBus } from "../../src/bus/events.js";
import { ApprovalManager } from "../../src/gateway/approval.js";
import { requestToolApproval } from "../../src/runtime.js";
import type { GhostEvent } from "../../src/events/index.js";

const silent = pino({ level: "silent" });

describe("tool approval flow (B1 regression)", () => {
  test("tool.approval.requested IS broadcast", async () => {
    const bus = new EventBus(silent);
    const mgr = new ApprovalManager();
    const events: GhostEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const task = requestToolApproval(
      mgr, bus, "exec", "rm -rf /tmp/foo", "medium",
    );
    await new Promise((r) => setTimeout(r, 0));

    const req = events.find((e) => e.type === "tool.approval.requested");
    expect(req).toBeDefined();
    if (req && req.type === "tool.approval.requested") {
      expect(req.payload.preview.action).toBe("exec");

      // Resolve approve via the approvalId returned in the event payload —
      // no need to reach for private state on ApprovalManager
      mgr.resolve(req.payload.approvalId, "approved");
      const ok = await task;
      expect(ok).toBe(true);
    }

    expect(events.filter((e) => e.type === "tool.approval.resolved")).toHaveLength(1);
  });

  test("rejected decision returns false", async () => {
    const bus = new EventBus(silent);
    const mgr = new ApprovalManager();
    const events: GhostEvent[] = [];
    bus.subscribe((e) => events.push(e));

    const task = requestToolApproval(
      mgr, bus, "write_file", "/etc/passwd", "path_restricted",
    );
    await new Promise((r) => setTimeout(r, 0));
    const req = events.find((e) => e.type === "tool.approval.requested");
    expect(req).toBeDefined();
    if (req && req.type === "tool.approval.requested") {
      mgr.resolve(req.payload.approvalId, "rejected");
    }

    const ok = await task;
    expect(ok).toBe(false);
  });
});
