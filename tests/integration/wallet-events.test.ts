import { describe, test, expect } from "bun:test";
import pino from "pino";
import { EventBus } from "../../src/bus/events.js";
import { WalletEvents } from "../../src/events/wallet-events.js";
import type { GhostEvent } from "../../src/events/index.js";

const silent = pino({ level: "silent" });

describe("wallet events — one shape across publishers", () => {
  test("REST publisher + tool publisher produce identical event shape", () => {
    const bus = new EventBus(silent);
    const received: GhostEvent[] = [];
    bus.subscribe((e) => received.push(e));

    // Simulate REST handler
    bus.publish(WalletEvents.changed({ action: "connect", address: "0xaaa" }));
    // Simulate agent tool's saveWalletConfig closure
    bus.publish(WalletEvents.changed({ action: "connect", address: "0xbbb" }));

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({
      type: "wallet.changed",
      payload: { action: "connect", address: "0xaaa" },
    });
    expect(received[1]).toEqual({
      type: "wallet.changed",
      payload: { action: "connect", address: "0xbbb" },
    });
  });

  test("all WalletChangedAction values produce valid events", () => {
    const bus = new EventBus(silent);
    const received: GhostEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.publish(WalletEvents.changed({ action: "connect", address: "0x1" }));
    bus.publish(WalletEvents.changed({ action: "remove", address: "0x1" }));
    bus.publish(WalletEvents.changed({ action: "trading-enabled", address: "0x1" }));
    bus.publish(WalletEvents.changed({ action: "set-default", address: "0x1" }));
    bus.publish(WalletEvents.changed({ action: "disconnect-source", source: "metamask", removed: ["0x1"] }));

    expect(received.every((e) => e.type === "wallet.changed")).toBe(true);
    expect(received).toHaveLength(5);
  });
});
