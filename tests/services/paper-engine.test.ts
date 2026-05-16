import { describe, test, expect, beforeEach } from "bun:test";
import { PaperEngine } from "../../src/services/paper/engine.js";
import { GHOST_CLOID_PREFIX } from "../../src/helpers/cloid.js";

// Minimal mock for MarketDataSource
function createMockMarketClient() {
  return {
    getTicker: async (symbol: string) => ({
      symbol: symbol.toUpperCase(),
      markPrice: symbol === "BTC" ? 65000 : 3000,
      midPrice: symbol === "BTC" ? 65000 : 3000,
      oraclePrice: symbol === "BTC" ? 65000 : 3000,
      volume24h: 1000000,
      prevDayPrice: symbol === "BTC" ? 64000 : 2900,
      priceChangePct24h: 1.5,
      openInterest: 500000,
      fundingRate: 0.0001,
    }),
    resolveSymbol: (s: string) => s.toUpperCase().replace(/[-_/]?(USDT|USDC|USD|PERP)$/i, ""),
  };
}

describe("PaperEngine", () => {
  let engine: PaperEngine;

  beforeEach(() => {
    engine = new PaperEngine(
      createMockMarketClient(),
      { initialBalance: 10000, takerFee: 0.00045, makerFee: 0.00015, priceMonitorInterval: 5000, dbPath: ":memory:" },
    );
  });

  test("initializes with correct balance", async () => {
    const balance = await engine.getBalance();
    expect(balance.totalEquity).toBe(10000);
    expect(balance.availableBalance).toBe(10000);
    expect(balance.usedMargin).toBe(0);
    expect(balance.unrealizedPnl).toBe(0);
  });

  test("starts with no positions", async () => {
    const positions = await engine.getPositions();
    expect(positions).toEqual([]);
  });

  test("starts with no open orders", async () => {
    const orders = await engine.getOpenOrders();
    expect(orders).toEqual([]);
  });

  test("starts with no fills", async () => {
    const fills = await engine.getFills();
    expect(fills).toEqual([]);
  });

  test("places market buy order and creates position", async () => {
    const result = await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "market",
    });
    expect(result.status).toBe("filled");
    expect(result.symbol).toBe("BTC");
    expect(result.side).toBe("buy");

    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe("BTC");
    expect(positions[0].side).toBe("long");
    expect(positions[0].size).toBe(0.1);
  });

  test("deducts margin from balance on market order", async () => {
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "market",
    });
    const balance = await engine.getBalance();
    // margin = notional / leverage = (0.1 * 65000) / 1 = 6500
    // fee = 0.1 * 65000 * 0.00045 = 2.925
    expect(balance.availableBalance).toBeLessThan(10000);
    expect(balance.usedMargin).toBeGreaterThan(0);
  });

  test("market order uses taker fee (0.045%)", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 1, orderType: "market",
    });
    const fills = await engine.getFills();
    // fillPrice = midPrice * (1 + 0.5/100) = 65000 * 1.005 = 65325
    // taker fee = 65325 * 0.00045 = 29.39625
    expect(fills[0].fee).toBeCloseTo(29.396, 2);
  });

  test("closes position and realizes PnL", async () => {
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "market",
    });
    const closeResult = await engine.closePosition("BTC");
    expect(closeResult.status).toBe("filled");

    const positions = await engine.getPositions();
    expect(positions).toHaveLength(0);

    const fills = await engine.getFills();
    expect(fills.length).toBeGreaterThanOrEqual(2); // open + close
  });

  test("places limit order as pending", async () => {
    const result = await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "limit", price: 60000,
    });
    expect(result.status).toBe("resting");
    expect(result.orderId).toBeDefined();

    const orders = await engine.getOpenOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0].price).toBe(60000);
  });

  test("cancels pending order", async () => {
    const result = await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "limit", price: 60000,
    });
    const cancelResult = await engine.cancelOrder("BTC", result.orderId!);
    expect(cancelResult.status).toBe("cancelled");

    const orders = await engine.getOpenOrders();
    expect(orders).toHaveLength(0);
  });

  test("sets leverage per symbol", async () => {
    const result = await engine.setLeverage("BTC", 10, true);
    expect(result.leverage).toBe(10);
    expect(result.marginMode).toBe("cross");
  });

  test("rejects leverage above asset max", async () => {
    await expect(engine.setLeverage("BTC", 50)).rejects.toThrow(/exceeds max 40x/i);
  });

  test("allows leverage at asset max", async () => {
    const result = await engine.setLeverage("BTC", 40);
    expect(result.leverage).toBe(40);
  });

  test("rejects margin mode switch while position is open", async () => {
    await engine.setLeverage("BTC", 10, true);
    await engine.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });
    await expect(engine.setLeverage("BTC", 10, false)).rejects.toThrow(/cannot switch margin mode/i);
  });

  test("allows margin mode switch with no position", async () => {
    await engine.setLeverage("BTC", 10, true);
    const result = await engine.setLeverage("BTC", 10, false);
    expect(result.marginMode).toBe("isolated");
  });

  test("leverage affects margin on order", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "market",
    });
    const balance = await engine.getBalance();
    // margin = notional / leverage = (0.1 * 65000) / 10 = 650
    expect(balance.usedMargin).toBeLessThan(1000);
  });

  test("averages position on same-side order", async () => {
    await engine.setLeverage("BTC", 20);
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "market",
    });
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.2, orderType: "market",
    });
    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].size).toBeCloseTo(0.3);
  });

  test("partial close reduces position", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 1, orderType: "market",
    });
    await engine.partialClose("BTC", 50);
    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].size).toBeCloseTo(0.5);
  });

  test("market buy fills at midPrice + slippage", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 1, orderType: "market",
    });
    const fills = await engine.getFills();
    // midPrice = 65000, default slippage 0.5% -> 65000 * 1.005 = 65325
    expect(fills[0].price).toBeCloseTo(65325, 0);
  });

  test("market sell fills at midPrice - slippage", async () => {
    await engine.setLeverage("BTC", 10);
    // Open long first so we can sell
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 1, orderType: "market",
    });
    await engine.placeOrder({
      symbol: "BTC", side: "sell", size: 0.5, orderType: "market",
    });
    const fills = await engine.getFills();
    // Find the sell fill; midPrice = 65000, 0.5% slippage -> 65000 * 0.995 = 64675
    const sellFill = fills.find((f) => f.side === "sell");
    expect(sellFill).toBeDefined();
    expect(sellFill!.price).toBeCloseTo(64675, 0);
  });

  test("custom slippagePct is respected", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 1, orderType: "market", slippagePct: 1.0,
    });
    const fills = await engine.getFills();
    // midPrice = 65000, 1.0% slippage -> 65000 * 1.01 = 65650
    expect(fills[0].price).toBeCloseTo(65650, 0);
  });

  // ── Story 09-06: Reduce-only enforcement ──

  test("reduce-only rejects when no position exists", async () => {
    await expect(
      engine.placeOrder({ symbol: "BTC", side: "sell", size: 0.1, orderType: "market", reduceOnly: true }),
    ).rejects.toThrow(/no open position/i);
  });

  test("reduce-only rejects same-side order (cannot increase)", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });
    await expect(
      engine.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market", reduceOnly: true }),
    ).rejects.toThrow(/cannot increase/i);
  });

  test("reduce-only clamps size to position size (no flip)", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({ symbol: "BTC", side: "buy", size: 0.5, orderType: "market" });
    // Try to close more than position size
    const result = await engine.placeOrder({
      symbol: "BTC", side: "sell", size: 1.0, orderType: "market", reduceOnly: true,
    });
    expect(result.status).toBe("filled");
    // Position should be fully closed, not flipped
    const positions = await engine.getPositions();
    expect(positions).toHaveLength(0);
  });

  test("non-reduce-only order still flips position", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({ symbol: "BTC", side: "buy", size: 0.5, orderType: "market" });
    await engine.placeOrder({ symbol: "BTC", side: "sell", size: 1.0, orderType: "market" });
    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].side).toBe("short");
    expect(positions[0].size).toBeCloseTo(0.5);
  });

  test("rejects order with insufficient balance", async () => {
    await expect(
      engine.placeOrder({ symbol: "BTC", side: "buy", size: 10, orderType: "market" }),
    ).rejects.toThrow(/insufficient/i);
  });

  // ── Story 09-08: Liquidation simulation ──

  test("long position shows liquidation price below entry", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({ symbol: "BTC", side: "buy", size: 1, orderType: "market" });
    const positions = await engine.getPositions();
    expect(positions[0].liquidationPrice).not.toBeNull();
    expect(positions[0].liquidationPrice!).toBeLessThan(positions[0].entryPrice);
  });

  test("short position shows liquidation price above entry", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({ symbol: "BTC", side: "sell", size: 1, orderType: "market" });
    const positions = await engine.getPositions();
    expect(positions[0].liquidationPrice).not.toBeNull();
    expect(positions[0].liquidationPrice!).toBeGreaterThan(positions[0].entryPrice);
  });

  test("higher leverage = closer liquidation price", async () => {
    // 10x leverage
    const engine10x = new PaperEngine(createMockMarketClient(), {
      initialBalance: 100000, takerFee: 0.00045, makerFee: 0.00015, priceMonitorInterval: 5000, dbPath: ":memory:",
    });
    await engine10x.setLeverage("BTC", 10);
    await engine10x.placeOrder({ symbol: "BTC", side: "buy", size: 1, orderType: "market" });
    const pos10x = (await engine10x.getPositions())[0];

    // 40x leverage
    const engine40x = new PaperEngine(createMockMarketClient(), {
      initialBalance: 100000, takerFee: 0.00045, makerFee: 0.00015, priceMonitorInterval: 5000, dbPath: ":memory:",
    });
    await engine40x.setLeverage("BTC", 40);
    await engine40x.placeOrder({ symbol: "BTC", side: "buy", size: 1, orderType: "market" });
    const pos40x = (await engine40x.getPositions())[0];

    // 40x liquidation price should be closer to entry (higher) than 10x
    expect(pos40x.liquidationPrice!).toBeGreaterThan(pos10x.liquidationPrice!);

    engine10x.close();
    engine40x.close();
  });

  test("checkLiquidation auto-closes position at liquidation level", async () => {
    // Use a mock that returns a price below liquidation
    let mockPrice = 65000;
    const mockClient = {
      getTicker: async (symbol: string) => ({
        symbol: symbol.toUpperCase(),
        markPrice: mockPrice,
        midPrice: mockPrice,
        oraclePrice: mockPrice,
        volume24h: 1000000,
        prevDayPrice: 64000,
        priceChangePct24h: 1.5,
        openInterest: 500000,
        fundingRate: 0.0001,
      }),
      resolveSymbol: (s: string) => s.toUpperCase().replace(/[-_/]?(USDT|USDC|USD|PERP)$/i, ""),
    };
    const liqEngine = new PaperEngine(mockClient, {
      initialBalance: 10000, takerFee: 0.00045, makerFee: 0.00015, priceMonitorInterval: 60000, dbPath: ":memory:",
    });
    await liqEngine.setLeverage("BTC", 10);
    await liqEngine.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });

    const positions = await liqEngine.getPositions();
    expect(positions).toHaveLength(1);
    const liqPrice = positions[0].liquidationPrice!;

    // Move price below liquidation
    mockPrice = liqPrice - 100;
    await liqEngine.checkLiquidation();

    const posAfter = await liqEngine.getPositions();
    expect(posAfter).toHaveLength(0);

    // Liquidation fill should be recorded
    const fills = await liqEngine.getFills();
    const liqFill = fills.find((f) => f.realizedPnl < 0);
    expect(liqFill).toBeDefined();

    liqEngine.close();
  });

  test("balance cannot go below zero after liquidation", async () => {
    let mockPrice = 65000;
    const mockClient = {
      getTicker: async (symbol: string) => ({
        symbol: symbol.toUpperCase(),
        markPrice: mockPrice,
        midPrice: mockPrice,
        oraclePrice: mockPrice,
        volume24h: 1000000,
        prevDayPrice: 64000,
        priceChangePct24h: 1.5,
        openInterest: 500000,
        fundingRate: 0.0001,
      }),
      resolveSymbol: (s: string) => s.toUpperCase().replace(/[-_/]?(USDT|USDC|USD|PERP)$/i, ""),
    };
    const liqEngine = new PaperEngine(mockClient, {
      initialBalance: 7000, takerFee: 0.00045, makerFee: 0.00015, priceMonitorInterval: 60000, dbPath: ":memory:",
    });
    await liqEngine.setLeverage("BTC", 10);
    await liqEngine.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });

    // Crash price far below entry to create a loss exceeding remaining balance
    mockPrice = 10000;
    await liqEngine.checkLiquidation();

    const balance = await liqEngine.getBalance();
    expect(balance.totalEquity).toBeGreaterThanOrEqual(0);

    liqEngine.close();
  });

  test("positions with sufficient margin are NOT liquidated", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({ symbol: "BTC", side: "buy", size: 0.1, orderType: "market" });
    // Price is at 65000, well above any liquidation level for 10x BTC
    await engine.checkLiquidation();
    const positions = await engine.getPositions();
    expect(positions).toHaveLength(1);
  });

  // ── Story 09-09: Hourly funding rate payments ──

  test("applyFunding charges longs when rate is positive", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({ symbol: "BTC", side: "buy", size: 1, orderType: "market" });
    const balanceBefore = await engine.getBalance();

    await engine.applyFunding();

    const balanceAfter = await engine.getBalance();
    // fundingRate = 0.0001 (positive), longs pay
    // payment = 1 * 65000 * 0.0001 = 6.5, longs lose 6.5
    expect(balanceAfter.totalEquity).toBeLessThan(balanceBefore.totalEquity);
  });

  test("applyFunding credits shorts when rate is positive", async () => {
    await engine.setLeverage("BTC", 10);
    await engine.placeOrder({ symbol: "BTC", side: "sell", size: 1, orderType: "market" });
    const balanceBefore = await engine.getBalance();

    await engine.applyFunding();

    const balanceAfter = await engine.getBalance();
    // fundingRate = 0.0001 (positive), shorts receive
    expect(balanceAfter.totalEquity).toBeGreaterThan(balanceBefore.totalEquity);
  });

  test("applyFunding with negative rate reverses direction", async () => {
    // Mock with negative funding rate
    const negFundingClient = {
      getTicker: async (symbol: string) => ({
        symbol: symbol.toUpperCase(),
        markPrice: 65000, midPrice: 65000, oraclePrice: 65000,
        volume24h: 1000000, prevDayPrice: 64000, priceChangePct24h: 1.5,
        openInterest: 500000, fundingRate: -0.0002,
      }),
      resolveSymbol: (s: string) => s.toUpperCase().replace(/[-_/]?(USDT|USDC|USD|PERP)$/i, ""),
    };
    const negEngine = new PaperEngine(negFundingClient, {
      initialBalance: 100000, takerFee: 0.00045, makerFee: 0.00015, priceMonitorInterval: 60000, dbPath: ":memory:",
    });
    await negEngine.setLeverage("BTC", 10);
    await negEngine.placeOrder({ symbol: "BTC", side: "buy", size: 1, orderType: "market" });
    const balanceBefore = await negEngine.getBalance();

    await negEngine.applyFunding();

    const balanceAfter = await negEngine.getBalance();
    // Negative rate: longs receive, so equity should increase
    expect(balanceAfter.totalEquity).toBeGreaterThan(balanceBefore.totalEquity);

    negEngine.close();
  });

  test("funding payment formula: size * oraclePrice * fundingRate", async () => {
    const bigEngine = new PaperEngine(createMockMarketClient(), {
      initialBalance: 100000, takerFee: 0.00045, makerFee: 0.00015, priceMonitorInterval: 60000, dbPath: ":memory:",
    });
    await bigEngine.setLeverage("BTC", 10);
    await bigEngine.placeOrder({ symbol: "BTC", side: "buy", size: 2, orderType: "market" });
    const balanceBefore = await bigEngine.getBalance();

    await bigEngine.applyFunding();

    const balanceAfter = await bigEngine.getBalance();
    // Expected: 2 * 65000 * 0.0001 = 13.0 deducted from longs
    const diff = balanceBefore.totalEquity - balanceAfter.totalEquity;
    expect(diff).toBeCloseTo(13.0, 1);

    bigEngine.close();
  });

  test("adjustMargin updates position margin", async () => {
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "market",
    });
    const result = await engine.adjustMargin("BTC", 100);
    expect(result.amount).toBe(100);
  });

  test("reset clears all state", async () => {
    await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.1, orderType: "market",
    });
    engine.reset(10000);
    const balance = await engine.getBalance();
    expect(balance.totalEquity).toBe(10000);
    const positions = await engine.getPositions();
    expect(positions).toHaveLength(0);
  });

  // ─── Ghost cloid stamping ───

  test("market order result carries Ghost-prefixed cloid", async () => {
    const result = await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.001, orderType: "market",
    });
    expect(result.cloid).toMatch(new RegExp(`^${GHOST_CLOID_PREFIX}[a-f0-9]{22}$`));
  });

  test("limit order result carries Ghost-prefixed cloid", async () => {
    const result = await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.001, orderType: "limit", price: 60000,
    });
    expect(result.cloid).toMatch(new RegExp(`^${GHOST_CLOID_PREFIX}[a-f0-9]{22}$`));
  });

  test("each paper order gets a unique cloid", async () => {
    const r1 = await engine.placeOrder({
      symbol: "BTC", side: "buy", size: 0.001, orderType: "limit", price: 60000,
    });
    const r2 = await engine.placeOrder({
      symbol: "BTC", side: "sell", size: 0.001, orderType: "limit", price: 70000,
    });
    expect(r1.cloid).not.toBe(r2.cloid);
  });

  // ─── getHistoricalOrders ───
  // Note: `paper_orders.created_at` is stored at second resolution (`unixepoch()`),
  // so tests use sleeps >= 1100ms to cross second boundaries.

  describe("getHistoricalOrders", () => {
    test("returns paper orders since startTime, attributes them as Ghost-placed via cloid prefix", async () => {
      const start = Date.now() - 2000;
      await engine.placeOrder({
        symbol: "BTC", side: "buy", size: 0.1, price: 60000, orderType: "limit",
      });
      await engine.placeOrder({
        symbol: "ETH", side: "sell", size: 1, price: 3000, orderType: "limit", reduceOnly: true,
      });

      const orders = await engine.getHistoricalOrders(undefined, start);
      expect(orders.length).toBeGreaterThanOrEqual(2);
      for (const o of orders) {
        expect(o.cloid).toMatch(new RegExp(`^${GHOST_CLOID_PREFIX}[a-f0-9]{22}$`));
      }

      const btc = orders.find((o) => o.symbol === "BTC")!;
      expect(btc).toBeDefined();
      expect(btc.side).toBe("buy");
      expect(btc.reduceOnly).toBe(false);
      expect(btc.price).toBe(60000);
      expect(btc.size).toBe(0.1);
      expect(btc.status).toBe("open");

      const eth = orders.find((o) => o.symbol === "ETH")!;
      expect(eth).toBeDefined();
      expect(eth.reduceOnly).toBe(true);
      expect(eth.side).toBe("sell");
    });

    test("excludes orders placed before startTime", async () => {
      await engine.placeOrder({
        symbol: "BTC", side: "buy", size: 0.1, price: 60000, orderType: "limit",
      });
      await new Promise((r) => setTimeout(r, 1100));
      const cutoff = Date.now();
      await new Promise((r) => setTimeout(r, 1100));
      await engine.placeOrder({
        symbol: "ETH", side: "sell", size: 1, price: 3000, orderType: "limit",
      });

      const orders = await engine.getHistoricalOrders(undefined, cutoff);
      expect(orders.find((o) => o.symbol === "BTC")).toBeUndefined();
      expect(orders.find((o) => o.symbol === "ETH")).toBeDefined();
    });

    test("returns empty array when no orders exist", async () => {
      const orders = await engine.getHistoricalOrders(undefined, Date.now() - 1000);
      expect(orders).toEqual([]);
    });

    test("each order's cloid is stable across reads (deterministic from oid)", async () => {
      // The cloid is derived from orderId via SHA-256, so two reads
      // of the same order return the same cloid. Different orders still
      // produce different cloids (different oids → different hashes).
      const start = Date.now() - 1000;
      await engine.placeOrder({
        symbol: "BTC", side: "buy", size: 0.1, price: 60000, orderType: "limit",
      });
      await engine.placeOrder({
        symbol: "BTC", side: "sell", size: 0.05, price: 70000, orderType: "limit",
      });

      const ordersFirstRead = await engine.getHistoricalOrders(undefined, start);
      const ordersSecondRead = await engine.getHistoricalOrders(undefined, start);

      expect(ordersFirstRead.length).toBe(2);
      // Different orders still get different cloids.
      expect(ordersFirstRead[0].cloid).not.toBe(ordersFirstRead[1].cloid);
      // Same order returns same cloid across reads.
      expect(ordersFirstRead[0].cloid).toBe(ordersSecondRead[0].cloid);
      expect(ordersFirstRead[1].cloid).toBe(ordersSecondRead[1].cloid);
    });
  });
});
