/**
 * Unit tests for HyperliquidClient.getMaxLeverage.
 * Uses the same info() stub pattern as client-meta-hip3.test.ts.
 */
import { describe, it, expect } from "bun:test";
import { HyperliquidClient } from "../../src/services/live/client";

const noopLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => noopLogger,
} as any;

// ─── Fixtures ───

const NATIVE_META = {
  universe: [
    { name: "BTC", szDecimals: 5, maxLeverage: 40 },
    { name: "ETH", szDecimals: 4, maxLeverage: 25 },
  ],
};

const XYZ_META = {
  universe: [
    { name: "xyz:WTIOIL", szDecimals: 2, maxLeverage: 10 },
  ],
};

function makeClient(
  infoMap: Record<string, unknown> = {},
  infoHandler?: (type: string, extra: Record<string, unknown>) => unknown,
): HyperliquidClient {
  const client = new HyperliquidClient(undefined, noopLogger);
  (client as any).info = async (type: string, extra: Record<string, unknown> = {}) => {
    if (infoHandler) {
      const result = infoHandler(type, extra);
      if (result !== undefined) return result;
    }
    const key = extra.dex !== undefined ? `${type}:${extra.dex}` : type;
    if (key in infoMap) return infoMap[key];
    throw new Error(`Unexpected info call: type=${type} dex=${extra.dex}`);
  };
  return client;
}

function nativeAndXyzClient(): HyperliquidClient {
  return makeClient({
    "perpDexs": [null, { name: "xyz", fullName: "XYZ", deployer: "0xabc" }],
    "meta": NATIVE_META,
    "meta:xyz": XYZ_META,
  });
}

// ─── getMaxLeverage ───

describe("HyperliquidClient.getMaxLeverage", () => {
  it("returns seeded maxLeverage for native BTC after ensureMeta", async () => {
    const client = nativeAndXyzClient();
    await (client as any).ensureMeta();

    expect(client.getMaxLeverage("BTC")).toBe(40);
  });

  it("returns seeded maxLeverage for native ETH after ensureMeta", async () => {
    const client = nativeAndXyzClient();
    await (client as any).ensureMeta();

    expect(client.getMaxLeverage("ETH")).toBe(25);
  });

  it("returns undefined for an unknown symbol", async () => {
    const client = nativeAndXyzClient();
    await (client as any).ensureMeta();

    expect(client.getMaxLeverage("UNKNOWN999")).toBeUndefined();
  });

  it("round-trips HIP-3 xyz:WTIOIL via resolveSymbol (lowercase dex)", async () => {
    const client = nativeAndXyzClient();
    await (client as any).ensureMeta();

    // canonical lowercase form
    expect(client.getMaxLeverage("xyz:WTIOIL")).toBe(10);
    // uppercase dex must resolve to same value
    expect(client.getMaxLeverage("XYZ:WTIOIL")).toBe(10);
  });

  it("returns undefined before ensureMeta is called", () => {
    const client = nativeAndXyzClient();
    // meta not loaded yet
    expect(client.getMaxLeverage("BTC")).toBeUndefined();
  });

  it("does not store zero or negative maxLeverage values", async () => {
    const client = makeClient({
      "perpDexs": [],
      "meta": {
        universe: [
          { name: "BTC", szDecimals: 5, maxLeverage: 0 },
          { name: "ETH", szDecimals: 4, maxLeverage: -5 },
        ],
      },
    });
    await (client as any).ensureMeta();

    expect(client.getMaxLeverage("BTC")).toBeUndefined();
    expect(client.getMaxLeverage("ETH")).toBeUndefined();
  });
});
