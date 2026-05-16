/**
 * Regression test: HyperliquidClient.getHistoricalOrders maps the HL
 * `historicalOrders` payload into OrderRecord, preserves cloid (used by the
 * proactive detector / ghost_get_recent_orders to attribute Ghost vs external),
 * and filters orders older than `startTime` client-side.
 */
import { describe, it, expect } from "bun:test";
import { HyperliquidClient } from "../../src/services/live/client";

/** Minimal pino-compatible logger stub */
const noopLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => noopLogger,
} as any;

/**
 * Build a HyperliquidClient and stub the private `info()` method so no real
 * HTTP is made. Mirrors the pattern in tests/services/live-client-cloid.test.ts.
 */
function makeClient(infoStub: (req: string, params?: unknown) => Promise<unknown>): HyperliquidClient {
  const client = new HyperliquidClient(undefined, noopLogger);
  // Bypass private modifier to inject the info() stub.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (client as any).info = infoStub;
  return client;
}

describe("HyperliquidClient.getHistoricalOrders", () => {
  it("maps HL historicalOrders payload to OrderRecord, preserves cloid", async () => {
    const sample = [
      {
        order: {
          coin: "BTC",
          side: "B",
          limitPx: "60000",
          sz: "0.5",
          oid: 1,
          cloid: "0x67686f7374abcdef0123456789abcdef",
          reduceOnly: false,
          triggerPx: null,
          timestamp: 1_700_000_000_000,
        },
        status: "filled",
        statusTimestamp: 1_700_000_000_000,
      },
      {
        order: {
          coin: "ETH",
          side: "A",
          limitPx: "3000",
          sz: "1",
          oid: 2,
          cloid: null,
          reduceOnly: true,
          triggerPx: "2900",
          timestamp: 1_700_000_500_000,
        },
        status: "open",
        statusTimestamp: 1_700_000_500_000,
      },
    ];
    const client = makeClient(async (req) => {
      if (req === "historicalOrders") return sample;
      throw new Error(`unexpected info request: ${req}`);
    });

    const orders = await client.getHistoricalOrders("0xUser", 1_700_000_000_000);

    expect(orders).toHaveLength(2);
    // oid is a string per Task 1's tightened OrderRecord contract.
    expect(orders[0].oid).toBe("1");
    expect(orders[0].cloid).toBe("0x67686f7374abcdef0123456789abcdef");
    expect(orders[0].symbol).toBe("BTC");
    expect(orders[0].side).toBe("buy");
    expect(orders[0].triggerPrice).toBeNull();
    expect(orders[0].reduceOnly).toBe(false);
    expect(orders[0].status).toBe("filled");

    expect(orders[1].oid).toBe("2");
    expect(orders[1].cloid).toBeNull();
    expect(orders[1].side).toBe("sell");
    expect(orders[1].triggerPrice).toBe(2900);
    expect(orders[1].reduceOnly).toBe(true);
  });

  it("returns empty array when HL responds with empty list", async () => {
    const client = makeClient(async () => []);
    const orders = await client.getHistoricalOrders("0xUser", Date.now() - 60_000);
    expect(orders).toEqual([]);
  });

  it("filters out orders with timestamp before startTime", async () => {
    const sample = [
      {
        order: {
          coin: "BTC",
          side: "B",
          limitPx: "60000",
          sz: "0.5",
          oid: 1,
          cloid: null,
          timestamp: 1_700_000_000_000,
        },
        status: "filled",
        statusTimestamp: 1_700_000_000_000,
      },
      {
        order: {
          coin: "ETH",
          side: "A",
          limitPx: "3000",
          sz: "1",
          oid: 2,
          cloid: null,
          timestamp: 1_700_001_000_000,
        },
        status: "open",
        statusTimestamp: 1_700_001_000_000,
      },
    ];
    const client = makeClient(async () => sample);
    const orders = await client.getHistoricalOrders("0xUser", 1_700_000_500_000);
    expect(orders).toHaveLength(1);
    expect(orders[0].oid).toBe("2");
  });

  it("treats triggerPx '0.0' as null trigger (matches getOpenOrders convention)", async () => {
    const sample = [{
      order: { coin: "BTC", side: "B", limitPx: "60000", sz: "0.5", oid: 99, cloid: null, reduceOnly: false, triggerPx: "0.0", timestamp: 1_700_000_000_000 },
      status: "open",
      statusTimestamp: 1_700_000_000_000,
    }];
    const client = makeClient(async () => sample);
    const orders = await client.getHistoricalOrders("0xUser", 0);
    expect(orders).toHaveLength(1);
    expect(orders[0].triggerPrice).toBeNull();
  });

  it("excludes orders with no resolvable timestamp", async () => {
    const sample = [
      { order: { coin: "BTC", side: "B", limitPx: "60000", sz: "0.5", oid: 1, cloid: null, reduceOnly: false }, status: "open" }, // no statusTimestamp, no order.timestamp
      { order: { coin: "ETH", side: "A", limitPx: "3000", sz: "1", oid: 2, cloid: null, reduceOnly: false, timestamp: 1_700_000_500_000 }, status: "open", statusTimestamp: 1_700_000_500_000 },
    ];
    const client = makeClient(async () => sample);
    const orders = await client.getHistoricalOrders("0xUser", 0);
    expect(orders).toHaveLength(1);
    expect(orders[0].oid).toBe("2");
  });

  it("preserves engine-driven status values verbatim for downstream filtering", async () => {
    const sample = [
      { order: { coin: "BTC", side: "B", limitPx: "60000", sz: "0.5", oid: 1, cloid: null, reduceOnly: false, timestamp: 1_700_000_000_000 }, status: "liquidatedCanceled", statusTimestamp: 1_700_000_000_000 },
      { order: { coin: "ETH", side: "A", limitPx: "3000", sz: "1", oid: 2, cloid: null, reduceOnly: false, timestamp: 1_700_000_500_000 }, status: "marginCanceled", statusTimestamp: 1_700_000_500_000 },
    ];
    const client = makeClient(async () => sample);
    const orders = await client.getHistoricalOrders("0xUser", 0);
    expect(orders).toHaveLength(2);
    expect(orders[0].status).toBe("liquidatedCanceled");
    expect(orders[1].status).toBe("marginCanceled");
  });
});
