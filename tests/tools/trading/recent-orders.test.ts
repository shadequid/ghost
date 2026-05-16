import { describe, it, expect } from "bun:test";
import { createRecentOrdersTools } from "../../../src/tools/trading/recent-orders.js";
import type { ITradingClient } from "../../../src/services/interfaces/trading-client.js";
import type { OrderRecord } from "../../../src/services/interfaces/trading-types.js";

function stubClient(orders: OrderRecord[]): ITradingClient {
  return {
    getHistoricalOrders: async () => orders,
    resolveSymbol: (s: string) => s.toUpperCase(),
  } as unknown as ITradingClient;
}

describe("ghost_get_recent_orders tool", () => {
  it("classifies attribution + kind correctly", async () => {
    const orders: OrderRecord[] = [
      {
        oid: "1", cloid: "0x67686f7374aaaaaaaaaaaaaaaaaaaaaa", symbol: "BTC", side: "buy",
        price: 60000, triggerPrice: null, size: 0.5, reduceOnly: false,
        status: "filled", timestamp: Date.now() - 1000,
      },
      {
        oid: "2", cloid: "0xabcdef0123456789abcdef0123456789", symbol: "ETH", side: "sell",
        price: 3000, triggerPrice: 2900, size: 1, reduceOnly: true,
        status: "open", timestamp: Date.now() - 500,
      },
    ];
    const [tool] = createRecentOrdersTools(stubClient(orders));
    const result = await tool.execute("call-1", { lookbackHours: 1 });
    const text = JSON.stringify(result);
    expect(text).toContain("0x67686f7374"); // Ghost cloid surfaced
    expect(text).toContain("ghost-placed"); // attribution label for ghost cloid
    expect(text).toContain("external"); // attribution label for non-ghost cloid
    expect(text).toContain("protection"); // kind for reduceOnly+trigger
    expect(text).toContain("position"); // kind for plain limit
  });

  it("classifies missing cloid as external (HL UI / 3rd-party tool placements)", async () => {
    const orders: OrderRecord[] = [
      {
        oid: "1", cloid: null, symbol: "BTC", side: "buy",
        price: 60000, triggerPrice: null, size: 0.5, reduceOnly: false,
        status: "filled", timestamp: Date.now() - 1000,
      },
    ];
    const [tool] = createRecentOrdersTools(stubClient(orders));
    const result = await tool.execute("call-1", { lookbackHours: 1 });
    const text = JSON.stringify(result);
    expect(text).toContain('\\"attribution\\": \\"external\\"');
  });

  it("flags engine-driven cancels (when not excluded)", async () => {
    const orders: OrderRecord[] = [
      {
        oid: "1", cloid: null, symbol: "BTC", side: "sell",
        price: 60000, triggerPrice: null, size: 0.5, reduceOnly: false,
        status: "liquidatedCanceled", timestamp: Date.now() - 1000,
      },
    ];
    const [tool] = createRecentOrdersTools(stubClient(orders));
    // Pass excludeEngineDriven=false explicitly so the engine-driven row is
    // surfaced (default is true).
    const result = await tool.execute("call-1", { lookbackHours: 1, excludeEngineDriven: false });
    const text = JSON.stringify(result);
    // The inner tool text JSON is escaped once by the outer JSON.stringify, so
    // the literal `"engineDriven": true` shows up as `\"engineDriven\": true`.
    expect(text).toContain('\\"engineDriven\\": true');
  });

  it("rejects lookbackHours <= 0", async () => {
    const [tool] = createRecentOrdersTools(stubClient([]));
    const result = await tool.execute("call-1", { lookbackHours: 0 });
    expect(JSON.stringify(result).toLowerCase()).toContain("must be greater than 0");
  });

  it("returns no-orders message when list is empty", async () => {
    const [tool] = createRecentOrdersTools(stubClient([]));
    const result = await tool.execute("call-1", { lookbackHours: 3 });
    expect(JSON.stringify(result).toLowerCase()).toContain("no orders");
  });

  // Server-side filtering via `attribution` + `excludeEngineDriven`.
  it("attribution='external' filters out ghost-placed entries", async () => {
    const orders: OrderRecord[] = [
      {
        oid: "1", cloid: "0x67686f7374aaaaaaaaaaaaaaaaaaaaaa", symbol: "BTC", side: "buy",
        price: 60000, triggerPrice: null, size: 0.5, reduceOnly: false,
        status: "filled", timestamp: Date.now() - 1000,
      },
      {
        oid: "2", cloid: null, symbol: "ETH", side: "sell",
        price: 3000, triggerPrice: null, size: 1, reduceOnly: false,
        status: "filled", timestamp: Date.now() - 1000,
      },
      {
        oid: "3", cloid: "0xabcdef0123456789abcdef0123456789", symbol: "SOL", side: "buy",
        price: 100, triggerPrice: null, size: 5, reduceOnly: false,
        status: "filled", timestamp: Date.now() - 1000,
      },
    ];
    const [tool] = createRecentOrdersTools(stubClient(orders));
    const result = await tool.execute("call-1", { lookbackHours: 1, attribution: "external" });
    const text = JSON.stringify(result);
    // ETH (null cloid) and SOL (non-ghost cloid) both survive; BTC (ghost) filtered.
    expect(text).toContain("ETH");
    expect(text).toContain("SOL");
    expect(text).not.toContain("BTC");
    expect(text).toContain('\\"count\\": 2');
  });

  it("excludeEngineDriven=false includes liquidatedCanceled rows", async () => {
    const orders: OrderRecord[] = [
      {
        oid: "1", cloid: null, symbol: "BTC", side: "sell",
        price: 60000, triggerPrice: null, size: 0.5, reduceOnly: false,
        status: "liquidatedCanceled", timestamp: Date.now() - 1000,
      },
    ];
    const [tool] = createRecentOrdersTools(stubClient(orders));
    const result = await tool.execute("call-1", { lookbackHours: 1, excludeEngineDriven: false });
    const text = JSON.stringify(result);
    expect(text).toContain("liquidatedCanceled"); // surfaced when not excluded
    expect(text).toContain('\\"count\\": 1');
  });

  it("excludeEngineDriven defaults to true and drops liquidatedCanceled", async () => {
    const orders: OrderRecord[] = [
      {
        oid: "1", cloid: null, symbol: "BTC", side: "sell",
        price: 60000, triggerPrice: null, size: 0.5, reduceOnly: false,
        status: "liquidatedCanceled", timestamp: Date.now() - 1000,
      },
    ];
    const [tool] = createRecentOrdersTools(stubClient(orders));
    const result = await tool.execute("call-1", { lookbackHours: 1 });
    const text = JSON.stringify(result).toLowerCase();
    // No surviving rows → filter no-match message.
    expect(text).toContain("no orders matching filter");
  });
});
