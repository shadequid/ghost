import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { PaperTradingClient } from "../../src/services/paper/client.js";
import type { ITradingClient } from "../../src/services/interfaces/trading-client.js";

function createMockMarketClient(): ITradingClient {
  return {
    canWrite: false,
    address: "",
    connect: () => {},
    disconnect: () => {},
    resolveSymbol: (s: string) => s.toUpperCase().replace(/[-_/]?(USDT|USDC|USD|PERP)$/i, ""),
    getBalance: async () => ({ totalEquity: 0, availableBalance: 0, usedMargin: 0, unrealizedPnl: 0 }),
    getPositions: async () => [],
    getOpenOrders: async () => [],
    getFills: async () => [],
    getFillsByTime: async () => [],
    getHistoricalOrders: async () => [],
    getTicker: async (symbol: string) => ({
      symbol: symbol.toUpperCase(), markPrice: 65000, midPrice: 65000, oraclePrice: 65000,
      volume24h: 1000000, prevDayPrice: 64000, priceChangePct24h: 1.5,
      openInterest: 500000, fundingRate: 0.0001,
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
    getDexUniverses: () => new Map(),
    subscribeAllDexsAssetCtxs: async () => ({ unsubscribe: async () => {} }),
    closeWs: async () => {},
    placeOrder: async () => ({ symbol: "BTC", side: "buy" as const, orderType: "market", status: "filled" as const }),
    cancelOrder: async () => ({ symbol: "BTC", orderId: "1", status: "cancelled" as const }),
    cancelAllOrders: async () => [],
    setLeverage: async () => ({ symbol: "BTC", leverage: 1, marginMode: "cross" as const }),
    closePosition: async () => ({ symbol: "BTC", side: "buy" as const, orderType: "market", status: "filled" as const }),
    partialClose: async () => ({ symbol: "BTC", side: "buy" as const, orderType: "market", status: "filled" as const }),
    adjustMargin: async () => ({ symbol: "BTC", amount: 0 }),
  };
}

describe("PaperTradingClient", () => {
  let client: PaperTradingClient;

  beforeEach(() => {
    client = new PaperTradingClient(createMockMarketClient(), {
      enabled: true, initialBalance: 50000, priceMonitorInterval: 60000, takerFee: 0.00045, makerFee: 0.00015,
    }, ":memory:");
  });

  afterEach(() => { client.close(); });

  test("canWrite is true and address is paper-default", () => {
    expect(client.canWrite).toBe(true);
    expect(client.address).toBe("paper-default");
  });

  test("connect is no-op", () => {
    client.connect({ address: "0x123" });
    expect(client.address).toBe("paper-default");
  });

  test("market reads delegate to real client", async () => {
    const ticker = await client.getTicker("BTC");
    expect(ticker.markPrice).toBe(65000);
  });

  test("getBalance returns paper balance", async () => {
    const balance = await client.getBalance();
    expect(balance.totalEquity).toBe(50000);
  });

  // ── Story 09-01: Market orders ──

  test("full trade lifecycle: open, check, close", async () => {
    await client.setLeverage("BTC", 10);
    const order = await client.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });
    expect(order.status).toBe("filled");

    const positions = await client.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].side).toBe("long");
    expect(positions[0].size).toBe(0.1);
    expect(positions[0].leverage).toBe(10);

    const balance = await client.getBalance();
    expect(balance.availableBalance).toBeLessThan(50000);

    const close = await client.closePosition("BTC");
    expect(close.status).toBe("filled");
    expect((await client.getPositions())).toHaveLength(0);

    const fills = await client.getFills();
    expect(fills.length).toBeGreaterThanOrEqual(2);
  });

  // ── Story 09-02: Limit/stop/SL/TP orders ──

  test("limit order stored as pending", async () => {
    const result = await client.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "limit", price: 60000,
    });
    expect(result.status).toBe("resting");
    expect(result.orderId).toBeDefined();

    const orders = await client.getOpenOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].price).toBe(60000);
  });

  test("cancel pending order", async () => {
    const result = await client.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "limit", price: 60000,
    });
    await client.cancelOrder("BTC", result.orderId!);
    expect((await client.getOpenOrders())).toHaveLength(0);
  });

  test("bracket order: entry fills, SL/TP queue as pending", async () => {
    await client.setLeverage("BTC", 10);
    await client.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });

    const sl = await client.placeOrder({
      symbol: "BTC", side: "sell", size: 0.1, orderType: "stop_market", price: 60000, reduceOnly: true,
    });
    expect(sl.status).toBe("waitingForTrigger");

    const tp = await client.placeOrder({
      symbol: "BTC", side: "sell", size: 0.1, orderType: "take_profit", price: 70000, reduceOnly: true,
    });
    expect(tp.status).toBe("waitingForTrigger");

    const orders = await client.getOpenOrders();
    expect(orders).toHaveLength(2);
  });

  // ── Story 09-03: Leverage and position management ──

  test("leverage affects margin", async () => {
    await client.setLeverage("BTC", 20);
    await client.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });
    const balance = await client.getBalance();
    // margin = 0.1 * 65000 / 20 = 325
    expect(balance.usedMargin).toBeLessThan(500);
  });

  test("partial close reduces position", async () => {
    await client.setLeverage("BTC", 10);
    await client.placeOrder({ symbol: "BTC", side: "buy", size: 1, orderType: "market" });
    await client.partialClose("BTC", 50);
    const positions = await client.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].size).toBeCloseTo(0.5);
  });

  test("same-side orders average position", async () => {
    await client.setLeverage("BTC", 10);
    await client.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });
    await client.placeOrder({ symbol: "BTC", side: "buy", size: 0.2, orderType: "market" });
    const positions = await client.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].size).toBeCloseTo(0.3);
  });

  test("disconnect resets paper state", async () => {
    await client.setLeverage("BTC", 10);
    await client.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });
    client.disconnect();
    const balance = await client.getBalance();
    expect(balance.totalEquity).toBe(50000);
    expect((await client.getPositions())).toHaveLength(0);
  });
});
