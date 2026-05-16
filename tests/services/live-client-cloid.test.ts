/**
 * Regression test: live client stamps a Ghost-prefixed cloid on every order.
 */
import { describe, test, expect } from "bun:test";
import { HyperliquidClient } from "../../src/services/live/client";
import { GHOST_CLOID_PREFIX } from "../../src/helpers/cloid";

const GHOST_CLOID_PATTERN = new RegExp(`^${GHOST_CLOID_PREFIX}[a-f0-9]{22}$`);

/** Minimal pino-compatible logger stub */
const noopLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => noopLogger,
} as any;

/**
 * Build a HyperliquidClient with a stubbed exchange so no real HTTP is made.
 * The stub captures every call to exchange.order().
 */
function makeClientWithStub() {
  const capturedOrders: unknown[] = [];
  const exchangeStub = {
    order: async (params: unknown) => {
      capturedOrders.push(params);
      // Return a valid resting status so placeOrder resolves normally.
      return {
        response: {
          data: {
            statuses: [{ resting: { oid: 42 } }],
          },
        },
      };
    },
  };

  const client = new HyperliquidClient(undefined, noopLogger);
  // Bypass private modifiers to inject the exchange stub.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).exchange = exchangeStub;
  // Pre-populate asset metadata so ensureMeta() is a no-op.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).assetMap = new Map([["BTC", 0]]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).szDecimals = new Map([["BTC", 3]]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).metaLoaded = true;

  return { client, capturedOrders };
}

describe("HyperliquidClient — Ghost cloid stamping", () => {
  test("places limit order with Ghost-prefixed cloid", async () => {
    const { client, capturedOrders } = makeClientWithStub();

    await client.placeOrder({
      symbol: "BTC",
      side: "buy",
      size: 0.001,
      orderType: "limit",
      price: 60000,
    });

    // The @nktkas/hyperliquid library uses 'c' as the cloid field name.
    const payload = capturedOrders[0] as { orders?: Array<{ c?: string }> };
    const cloid = payload?.orders?.[0]?.c;
    expect(cloid).toMatch(GHOST_CLOID_PATTERN);
  });

  test("each order gets a unique cloid", async () => {
    const { client, capturedOrders } = makeClientWithStub();

    await client.placeOrder({
      symbol: "BTC", side: "buy", size: 0.001, orderType: "limit", price: 60000,
    });
    await client.placeOrder({
      symbol: "BTC", side: "sell", size: 0.001, orderType: "limit", price: 70000,
    });

    // The @nktkas/hyperliquid library uses 'c' as the cloid field name.
    const cloid1 = (capturedOrders[0] as any)?.orders?.[0]?.c as string;
    const cloid2 = (capturedOrders[1] as any)?.orders?.[0]?.c as string;
    expect(cloid1).toMatch(GHOST_CLOID_PATTERN);
    expect(cloid2).toMatch(GHOST_CLOID_PATTERN);
    expect(cloid1).not.toBe(cloid2);
  });

  // placeOrder() must return the generated cloid in PlaceOrderResult
  // so downstream consumers (proactive scan via ghost_get_recent_orders) can
  // attribute Ghost-placed vs external orders.
  test("placeOrder returns cloid in PlaceOrderResult matching Ghost prefix", async () => {
    const { client } = makeClientWithStub();

    const result = await client.placeOrder({
      symbol: "BTC",
      side: "buy",
      size: 0.001,
      orderType: "limit",
      price: 60000,
    });

    expect(result.cloid).toBeDefined();
    expect(result.cloid).toMatch(GHOST_CLOID_PATTERN);
  });
});
