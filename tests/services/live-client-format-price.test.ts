/**
 * Regression tests for HyperliquidClient price formatting on order placement.
 *
 * HL enforces TWO independent caps on submitted prices:
 *   - max 5 significant figures
 *   - max (MAX_DECIMALS - szDecimals) decimal places (perps MAX_DECIMALS=6)
 *
 * The tighter wins. Sub-dollar symbols with high szDecimals (e.g. APT,
 * szDecimals=2 → max 4 decimals) used to overflow the decimal cap through
 * `toPrecision(5)` alone and trigger HL "invalid price" rejections.
 */
import { describe, test, expect } from "bun:test";
import { HyperliquidClient } from "../../src/services/live/client";

/** Minimal pino-compatible logger stub. */
const noopLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => noopLogger,
} as any;

/**
 * Build a client pre-loaded with a fixed asset map + szDecimals so we can
 * exercise placeOrder without touching the network. Captures every order
 * payload submitted to the stubbed exchange so we can assert on the
 * formatted `p` field.
 */
function makeClient(meta: Array<{ name: string; szDecimals: number }>) {
  const capturedOrders: Array<{ p: string; s: string; a: number; b: boolean }> = [];
  const exchangeStub = {
    order: async (params: { orders: Array<{ p: string; s: string; a: number; b: boolean }> }) => {
      capturedOrders.push(...params.orders);
      return { response: { data: { statuses: [{ resting: { oid: 1 } }] } } };
    },
  };

  const client = new HyperliquidClient(undefined, noopLogger);
  (client as any).exchange = exchangeStub;
  (client as any).assetMap = new Map(meta.map((m, idx) => [m.name, idx]));
  (client as any).szDecimals = new Map(meta.map((m) => [m.name, m.szDecimals]));
  (client as any).metaLoaded = true;

  // Stub getTicker so market orders can compute slippagePrice without HTTP.
  (client as any).getTicker = async (symbol: string) => ({
    symbol, midPrice: tickerMids[symbol] ?? 0,
    markPrice: 0, oraclePrice: 0, volume24h: 0, change24h: 0,
  });

  return { client, capturedOrders };
}

const tickerMids: Record<string, number> = {
  APT: 0.9339, BTC: 70123.5, SOL: 142.37, ETH: 3845.21,
};

describe("HyperliquidClient.formatPrice — szDecimals-aware clamping", () => {
  test("APT limit: 4-decimal clamp prevents 5-decimal overflow (BUG-0163 repro)", async () => {
    const { client, capturedOrders } = makeClient([
      { name: "APT", szDecimals: 2 },
    ]);

    await client.placeOrder({
      symbol: "APT", side: "sell", size: 1, orderType: "limit",
      price: 0.929238,
    });

    // szDecimals=2 → max 4 decimals. 0.92924 (5 decimals) would be rejected.
    expect(capturedOrders[0].p).toBe("0.9292");
  });

  test("APT market: slippage path also clamps to 4 decimals", async () => {
    const { client, capturedOrders } = makeClient([
      { name: "APT", szDecimals: 2 },
    ]);

    // sell with default 0.5% slippage off mid 0.9339 → 0.929230...
    await client.placeOrder({
      symbol: "APT", side: "sell", size: 1, orderType: "market",
    });

    // toPrecision(5) → "0.92923" → toFixed(4) → "0.9292".
    expect(capturedOrders[0].p).toBe("0.9292");
  });

  test("BTC limit: high-priced symbol with szDecimals=5 emits integer price", async () => {
    const { client, capturedOrders } = makeClient([
      { name: "BTC", szDecimals: 5 },
    ]);

    await client.placeOrder({
      symbol: "BTC", side: "buy", size: 0.001, orderType: "limit",
      price: 70123.5,
    });

    // szDecimals=5 → max 1 decimal. toPrecision(5) trims 70123.5 → 70124
    // (rounded to 5 sig figs); toFixed(1) keeps it; toString drops ".0".
    expect(capturedOrders[0].p).toBe("70124");
  });

  test("SOL limit: szDecimals=2 mid-price unaffected at typical precision", async () => {
    const { client, capturedOrders } = makeClient([
      { name: "SOL", szDecimals: 2 },
    ]);

    await client.placeOrder({
      symbol: "SOL", side: "buy", size: 1, orderType: "limit",
      price: 142.37,
    });

    // 5 sig figs satisfied; 2 decimals well within 4-decimal cap.
    expect(capturedOrders[0].p).toBe("142.37");
  });

  test("ETH limit: szDecimals=4 caps to 2 decimals", async () => {
    const { client, capturedOrders } = makeClient([
      { name: "ETH", szDecimals: 4 },
    ]);

    await client.placeOrder({
      symbol: "ETH", side: "buy", size: 0.1, orderType: "limit",
      price: 3845.21,
    });

    // szDecimals=4 → max 2 decimals. toPrecision(5)→"3845.2", toFixed(2)→"3845.20",
    // parseFloat→3845.2, toString→"3845.2".
    expect(capturedOrders[0].p).toBe("3845.2");
  });

  test("unknown symbol falls back to szDecimals=0 → max 6 decimals", async () => {
    // No meta entry for FOO → szDecimals defaults to 0 → 6 decimals allowed.
    const { client, capturedOrders } = makeClient([
      { name: "FOO", szDecimals: 0 },
    ]);

    await client.placeOrder({
      symbol: "FOO", side: "buy", size: 1, orderType: "limit",
      price: 1.234567,
    });

    // 5 sig figs trim: 1.234567 → 1.2346. 6-decimal cap not binding.
    expect(capturedOrders[0].p).toBe("1.2346");
  });

  test("limit price submitted unchanged when already at HL-valid precision", async () => {
    const { client, capturedOrders } = makeClient([
      { name: "APT", szDecimals: 2 },
    ]);

    await client.placeOrder({
      symbol: "APT", side: "buy", size: 1, orderType: "limit",
      price: 0.93,
    });

    expect(capturedOrders[0].p).toBe("0.93");
  });
});
