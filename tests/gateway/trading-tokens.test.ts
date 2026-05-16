/**
 * Tests for the trading.tokens.list gateway method.
 * Verifies that maxLeverages is populated only for symbols where
 * getMaxLeverage returns a number, and absent for symbols where it
 * returns undefined.
 */
import { describe, it, expect } from "bun:test";
import { MethodRegistry, type MethodContext } from "../../src/gateway/method-registry.js";
import { registerTradingMethods } from "../../src/gateway/trading.js";
import type { ITradingClient } from "../../src/services/interfaces/trading-client.js";
import type { Ticker } from "../../src/services/interfaces/trading-types.js";

function makeCtx(): MethodContext {
  return { clientId: "c1", sessionId: "s1", broadcast: () => {}, emit: () => {} };
}

const noopLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => noopLogger,
} as any;

/** Minimal Ticker stub — only fields the handler actually reads. */
function makeTicker(symbol: string, markPrice = 100, prevDayPrice = 90): Ticker {
  return { symbol, markPrice, prevDayPrice, midPrice: 0, oraclePrice: 0, volume24h: 0, priceChangePct24h: 0, openInterest: 0, fundingRate: 0 };
}

/** Build a minimal ITradingClient stub with controlled tickers and leverage map. */
function makeTradingClient(
  tickers: Ticker[],
  leverageMap: Record<string, number | undefined>,
): ITradingClient {
  return {
    getAllTickers: async () => tickers,
    getMaxLeverage: (symbol: string) => leverageMap[symbol],
    resolveSymbol: (s: string) => s,
    // remaining methods are not exercised by trading.tokens.list
  } as unknown as ITradingClient;
}

/** Minimal deps — only tradingClient and logger are used by trading.tokens.list. */
function makeDeps(tradingClient: ITradingClient) {
  return {
    tradingClient,
    walletStore: {} as any,
    alertRules: {} as any,
    notifications: {} as any,
    newsService: {} as any,
    preferenceStore: {} as any,
    watchlist: {} as any,
    logger: noopLogger,
  };
}

interface TokensListResult {
  tokens: string[];
  prices: Record<string, number>;
  prevDayPrices: Record<string, number>;
  maxLeverages: Record<string, number>;
}

describe("trading.tokens.list", () => {
  it("includes maxLeverages only for symbols that have a leverage value", async () => {
    const tickers = [
      makeTicker("BTC", 60000, 59000),
      makeTicker("xyz:WTIOIL", 75, 70),
    ];
    // BTC has leverage, xyz:WTIOIL does not
    const client = makeTradingClient(tickers, { BTC: 40, "xyz:WTIOIL": undefined });

    const reg = new MethodRegistry();
    registerTradingMethods(reg.register.bind(reg), makeDeps(client));

    const result = await reg.dispatch("trading.tokens.list", makeCtx(), {}) as TokensListResult;

    expect(result.maxLeverages["BTC"]).toBe(40);
    expect("xyz:WTIOIL" in result.maxLeverages).toBe(false);
  });

  it("populates prices and prevDayPrices for all tickers", async () => {
    const tickers = [makeTicker("ETH", 3000, 2900)];
    const client = makeTradingClient(tickers, { ETH: 25 });

    const reg = new MethodRegistry();
    registerTradingMethods(reg.register.bind(reg), makeDeps(client));

    const result = await reg.dispatch("trading.tokens.list", makeCtx(), {}) as TokensListResult;

    expect(result.prices["ETH"]).toBe(3000);
    expect(result.prevDayPrices["ETH"]).toBe(2900);
  });

  it("returns tokens sorted alphabetically", async () => {
    const tickers = [makeTicker("ETH"), makeTicker("BTC"), makeTicker("xyz:AAPL")];
    const client = makeTradingClient(tickers, {});

    const reg = new MethodRegistry();
    registerTradingMethods(reg.register.bind(reg), makeDeps(client));

    const result = await reg.dispatch("trading.tokens.list", makeCtx(), {}) as TokensListResult;

    expect(result.tokens).toEqual(["BTC", "ETH", "xyz:AAPL"]);
  });

  it("returns empty maps when getAllTickers throws", async () => {
    const client = {
      getAllTickers: async () => { throw new Error("network error"); },
      getMaxLeverage: () => undefined,
      resolveSymbol: (s: string) => s,
    } as unknown as ITradingClient;

    const reg = new MethodRegistry();
    registerTradingMethods(reg.register.bind(reg), makeDeps(client));

    const result = await reg.dispatch("trading.tokens.list", makeCtx(), {}) as TokensListResult;

    expect(result.tokens).toEqual([]);
    expect(result.prices).toEqual({});
    expect(result.maxLeverages).toEqual({});
  });

  it("does not include maxLeverages entry for a zero leverage value", async () => {
    // getMaxLeverage returns 0 — the gateway guard (typeof === number && > 0) must exclude it
    const tickers = [makeTicker("BTC")];
    const client = makeTradingClient(tickers, { BTC: 0 as unknown as undefined });
    // Override to return 0 explicitly
    (client as any).getMaxLeverage = (_: string) => 0;

    const reg = new MethodRegistry();
    registerTradingMethods(reg.register.bind(reg), makeDeps(client));

    const result = await reg.dispatch("trading.tokens.list", makeCtx(), {}) as TokensListResult;

    expect("BTC" in result.maxLeverages).toBe(false);
  });
});
