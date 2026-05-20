/**
 * Tests for the unified cancel flow: ghost_cancel_order (orders[{id,symbol}])
 * + ghost_cancel_all_orders (sweep). These tools are pure executors —
 * confirm UX lives in the orchestrator via mechanical describers in
 * `src/services/confirm-policy.ts`. Card-content assertions for these
 * tools live in `tests/services/confirm-policy.test.ts`; this file only
 * covers schema validation and execute() behavior.
 */

import { describe, test, expect } from "bun:test";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TSchema } from "@sinclair/typebox";
import type { ITradingClient } from "../../../src/services/interfaces/trading-client.js";
import type { OpenOrder, CancelOrderResult } from "../../../src/services/interfaces/trading-types.js";
import type { IWalletStore } from "../../../src/services/interfaces/wallet-store.js";
import { createTradingTools } from "../../../src/tools/trading/orders.js";

function baseOrder(overrides: Partial<OpenOrder>): OpenOrder {
  return {
    orderId: "1",
    symbol: "BTC",
    side: "sell",
    orderType: "limit",
    price: null,
    triggerPrice: null,
    size: 0.1,
    filled: 0,
    reduceOnly: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

interface MockState {
  openOrders: OpenOrder[];
  cancelled: string[];
  cancelOrder?: (symbol: string, orderId: string) => Promise<CancelOrderResult>;
}

function createMockHL(state: MockState): ITradingClient {
  return {
    canWrite: true,
    address: "0xabc",
    connect: () => {},
    disconnect: () => {},
    resolveSymbol: (s: string) => s.toUpperCase().replace(/[-_/]?(USDT|USDC|USD|PERP)$/i, ""),
    getBalance: async () => ({ totalEquity: 0, availableBalance: 0, usedMargin: 0, unrealizedPnl: 0 }),
    getPositions: async () => [],
    getOpenOrders: async () => state.openOrders,
    getFills: async () => [],
    getFillsByTime: async () => [],
    getHistoricalOrders: async () => [],
    getTicker: async (symbol: string) => ({
      symbol, markPrice: 65000, midPrice: 65000, oraclePrice: 65000,
      volume24h: 0, prevDayPrice: 0, priceChangePct24h: 0, openInterest: 0, fundingRate: 0,
    }),
    getAllTickers: async () => [],
    getOrderbook: async () => ({ symbol: "BTC", bids: [], asks: [] }),
    getKlines: async () => [],
    getFundingHistory: async () => [],
    ensureMeta: async () => {},
    getAssetIndex: async () => 0,
    getMaxLeverage: () => undefined,
    getAllAssetNames: () => [],
    isKnownSymbol: () => false,
    getAllAssets: () => [],
    getDexUniverses: () => new Map(),
    subscribeAllDexsAssetCtxs: async () => ({ unsubscribe: async () => {} }),
    closeWs: async () => {},
    placeOrder: async () => ({ symbol: "BTC", side: "buy", orderType: "market", status: "filled" }),
    cancelOrder: async (symbol: string, orderId: string): Promise<CancelOrderResult> => {
      if (state.cancelOrder) return state.cancelOrder(symbol, orderId);
      state.cancelled.push(orderId);
      state.openOrders = state.openOrders.filter((o) => o.orderId !== orderId);
      return { symbol, orderId, status: "cancelled" };
    },
    cancelAllOrders: async (symbol?: string): Promise<CancelOrderResult[]> => {
      const resolved = symbol ? symbol.toUpperCase().replace(/[-_/]?(USDT|USDC|USD|PERP)$/i, "") : undefined;
      const matching = resolved
        ? state.openOrders.filter((o) => o.symbol.toUpperCase() === resolved)
        : state.openOrders.slice();
      matching.forEach((o) => state.cancelled.push(o.orderId));
      state.openOrders = state.openOrders.filter((o) => !matching.includes(o));
      return matching.map((o) => ({ symbol: o.symbol, orderId: o.orderId, status: "cancelled" as const }));
    },
    setLeverage: async () => ({ symbol: "BTC", leverage: 1, marginMode: "cross" }),
    closePosition: async () => ({ symbol: "BTC", side: "buy", orderType: "market", status: "filled" }),
    partialClose: async () => ({ symbol: "BTC", side: "buy", orderType: "market", status: "filled" }),
    adjustMargin: async () => ({ symbol: "BTC", amount: 0 }),
  };
}

function createMockWalletStore(): IWalletStore {
  return {
    async load() { return null; },
    async save() {},
    async addWatch() { return false; },
    async enableTrading() {},
    listWallets() { return []; },
    getWallet() { return null; },
    setDefault() {},
    async remove() { return false; },
    async removeBySource() { return []; },
  };
}

function findTool(tools: AgentTool<TSchema>[], name: string): AgentTool<TSchema> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

function getText(result: { content: { type: string; text?: string }[] }): string {
  const item = result.content[0];
  if (item && "text" in item) return item.text as string;
  return "";
}

const slOrder = baseOrder({ orderId: "101", orderType: "stop_market", reduceOnly: true, triggerPrice: 64000, price: 64000, size: 0.5 });
const tpOrder = baseOrder({ orderId: "202", orderType: "take_profit", reduceOnly: true, triggerPrice: 70000, price: 70000, size: 0.5 });

describe("ghost_cancel_order schema", () => {
  test("requires orders (array of {id, symbol}, min 1, max 10)", () => {
    const tools = createTradingTools(createMockHL({ openOrders: [], cancelled: [] }), createMockWalletStore());
    const tool = findTool(tools, "ghost_cancel_order");
    const schema = tool.parameters as unknown as {
      required?: string[];
      properties: Record<string, {
        type?: string;
        minItems?: number;
        maxItems?: number;
        items?: { type?: string; required?: string[]; properties?: Record<string, { type?: string }> };
      }>;
    };
    expect(schema.required).toContain("orders");
    expect(schema.properties.orders.type).toBe("array");
    expect(schema.properties.orders.minItems).toBe(1);
    expect(schema.properties.orders.maxItems).toBe(10);
    expect(schema.properties.orders.items?.type).toBe("object");
    expect(schema.properties.orders.items?.required).toContain("id");
    expect(schema.properties.orders.items?.required).toContain("symbol");
  });
});

describe("ghost_cancel_order — targeted", () => {
  test("cancels SL, leaves TP intact", async () => {
    const state: MockState = { openOrders: [slOrder, tpOrder], cancelled: [] };
    const tools = createTradingTools(createMockHL(state), createMockWalletStore());
    const tool = findTool(tools, "ghost_cancel_order");
    const text = getText(await tool.execute("c", { orders: [{ id: "101", symbol: "BTC" }] }));

    expect(state.cancelled).toEqual(["101"]);
    expect(state.openOrders).toHaveLength(1);
    expect(text).toContain("Cancelled #101");
  });

  test("cancels SL + TP atomically (both cancelled in one call)", async () => {
    const state: MockState = { openOrders: [slOrder, tpOrder], cancelled: [] };
    const tools = createTradingTools(createMockHL(state), createMockWalletStore());
    const tool = findTool(tools, "ghost_cancel_order");
    const text = getText(await tool.execute("c", {
      orders: [{ id: "101", symbol: "BTC" }, { id: "202", symbol: "BTC" }],
    }));

    expect(state.cancelled.sort()).toEqual(["101", "202"]);
    expect(text).toContain("Cancelled #101");
    expect(text).toContain("Cancelled #202");
  });

  test("bad ID is surfaced via exchange error (Failed #id)", async () => {
    const state: MockState = {
      openOrders: [slOrder, tpOrder],
      cancelled: [],
      cancelOrder: async (_sym, id) => {
        if (id === "999") throw new Error("order not found");
        state.cancelled.push(id);
        return { symbol: "BTC", orderId: id, status: "cancelled" };
      },
    };
    const tools = createTradingTools(createMockHL(state), createMockWalletStore());
    const tool = findTool(tools, "ghost_cancel_order");
    const text = getText(await tool.execute("c", { orders: [{ id: "999", symbol: "BTC" }] }));

    expect(state.cancelled).toHaveLength(0);
    expect(text).toContain("Failed #999");
    expect(text).toContain("order not found");
  });

  test("deduplicates duplicate order ids before cancelling", async () => {
    const state: MockState = { openOrders: [slOrder, tpOrder], cancelled: [] };
    const tools = createTradingTools(createMockHL(state), createMockWalletStore());
    const tool = findTool(tools, "ghost_cancel_order");
    await tool.execute("c", {
      orders: [{ id: "101", symbol: "BTC" }, { id: "101", symbol: "BTC" }],
    });
    expect(state.cancelled).toEqual(["101"]);
  });

  test("partial failure: fulfilled legs reported as cancelled, rejected legs report failure", async () => {
    const state: MockState = {
      openOrders: [slOrder, tpOrder],
      cancelled: [],
      cancelOrder: async (sym, id) => {
        if (id === "202") throw new Error("network blip");
        state.cancelled.push(id);
        state.openOrders = state.openOrders.filter((o) => o.orderId !== id);
        return { symbol: sym, orderId: id, status: "cancelled" };
      },
    };
    const tools = createTradingTools(createMockHL(state), createMockWalletStore());
    const tool = findTool(tools, "ghost_cancel_order");
    const text = getText(await tool.execute("c", {
      orders: [{ id: "101", symbol: "BTC" }, { id: "202", symbol: "BTC" }],
    }));

    expect(state.cancelled).toEqual(["101"]);
    expect(text).toContain("Cancelled #101");
    expect(text).toContain("Failed #202");
    expect(text).toContain("network blip");
  });
});

describe("ghost_cancel_all_orders", () => {
  test("scoped: only cancels orders for that symbol", async () => {
    const ethOrder = baseOrder({ orderId: "404", symbol: "ETH", orderType: "limit", price: 2800 });
    const state: MockState = { openOrders: [slOrder, tpOrder, ethOrder], cancelled: [] };
    const tools = createTradingTools(createMockHL(state), createMockWalletStore());
    const tool = findTool(tools, "ghost_cancel_all_orders");
    const text = getText(await tool.execute("c", { symbol: "BTC" }));

    expect(state.cancelled.sort()).toEqual(["101", "202"]);
    expect(text).toContain("BTC");
    expect(text).not.toContain("404");
  });

  test("unscoped: cancels across every market", async () => {
    const ethOrder = baseOrder({ orderId: "404", symbol: "ETH", orderType: "limit", price: 2800 });
    const state: MockState = { openOrders: [slOrder, ethOrder], cancelled: [] };
    const tools = createTradingTools(createMockHL(state), createMockWalletStore());
    const tool = findTool(tools, "ghost_cancel_all_orders");
    await tool.execute("c", {});

    expect(state.cancelled.sort()).toEqual(["101", "404"]);
  });

  test("no orders: returns early", async () => {
    const state: MockState = { openOrders: [], cancelled: [] };
    const tools = createTradingTools(createMockHL(state), createMockWalletStore());
    const tool = findTool(tools, "ghost_cancel_all_orders");
    const text = getText(await tool.execute("c", {}));

    expect(text.toLowerCase()).toContain("no open orders");
  });

});
