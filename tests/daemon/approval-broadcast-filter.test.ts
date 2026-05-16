/**
 * Verify broadcastEventToWeb filters trading.approval.* events by origin.channel.
 * Other events (tool.approval.*, tick, etc.) broadcast normally.
 */

import { describe, test, expect, mock } from "bun:test";
import { broadcastEventToWeb } from "../../src/daemon/index.js";
import type { ClientManager } from "../../src/gateway/client-manager.js";

function makeClientManager() {
  return { broadcast: mock(() => {}) } as unknown as ClientManager;
}

describe("broadcastEventToWeb", () => {
  test("skips trading.approval.requested when origin.channel === telegram", () => {
    const cm = makeClientManager();
    broadcastEventToWeb(
      {
        type: "trading.approval.requested",
        payload: { approvalId: "a1", origin: { channel: "telegram", chatId: "1" } },
      },
      cm,
    );
    expect((cm.broadcast as ReturnType<typeof mock>)).not.toHaveBeenCalled();
  });

  test("broadcasts trading.approval.requested when origin.channel === web", () => {
    const cm = makeClientManager();
    broadcastEventToWeb(
      {
        type: "trading.approval.requested",
        payload: { approvalId: "a1", origin: { channel: "web", chatId: "1" } },
      },
      cm,
    );
    expect((cm.broadcast as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
  });

  test("skips trading.approval.resolved with telegram-origin linked approval", () => {
    const cm = makeClientManager();
    broadcastEventToWeb(
      {
        type: "trading.approval.resolved",
        payload: { approvalId: "a1", decision: "approved", ts: 1, origin: { channel: "telegram", chatId: "1" } },
      },
      cm,
    );
    expect((cm.broadcast as ReturnType<typeof mock>)).not.toHaveBeenCalled();
  });

  test("broadcasts tool.approval.requested unchanged (no origin concept)", () => {
    const cm = makeClientManager();
    broadcastEventToWeb(
      { type: "tool.approval.requested", payload: { approvalId: "t1" } },
      cm,
    );
    expect((cm.broadcast as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
  });

  test("broadcasts non-approval events (e.g., tick) unchanged", () => {
    const cm = makeClientManager();
    broadcastEventToWeb(
      { type: "position.updated", payload: { symbol: "BTC" } },
      cm,
    );
    expect((cm.broadcast as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
  });

  test("broadcasts trading.approval.requested without origin (defensive) via web path", () => {
    const cm = makeClientManager();
    broadcastEventToWeb(
      {
        type: "trading.approval.requested",
        payload: { approvalId: "a1" }, // no origin field
      },
      cm,
    );
    expect((cm.broadcast as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
  });
});
