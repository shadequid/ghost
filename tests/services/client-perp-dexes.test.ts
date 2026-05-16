/**
 * Unit tests for HyperliquidClient.listPerpDexes
 * — cache TTL, force-bypass, null filtering, error fallback.
 */
import { describe, it, expect, beforeEach } from "bun:test";
import { HyperliquidClient } from "../../src/services/live/client";

const noopLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => noopLogger,
} as any;

/** Build a client with a stubbed info() that records call counts. */
function makeClient(infoImpl: (type: string, extra?: Record<string, unknown>) => Promise<unknown>) {
  const client = new HyperliquidClient(undefined, noopLogger);
  (client as any).info = infoImpl;
  return client;
}

const SAMPLE_PERP_DEXS_RAW = [
  null,
  { name: "xyz", fullName: "XYZ", deployer: "0xabc", oracleUpdater: null, feeRecipient: "0xfee", assetToStreamingOiCap: [] },
  { name: "flx", fullName: "FLX", deployer: "0xdef", oracleUpdater: null, feeRecipient: "0xfee2", assetToStreamingOiCap: [] },
];

describe("HyperliquidClient.listPerpDexes", () => {
  it("filters out null entry and returns only named dexes", async () => {
    const client = makeClient(async (type) => {
      if (type === "perpDexs") return SAMPLE_PERP_DEXS_RAW;
      throw new Error(`unexpected call: ${type}`);
    });

    const result = await client.listPerpDexes();

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("xyz");
    expect(result[1].name).toBe("flx");
  });

  it("caches result and does not call info() on second call within TTL", async () => {
    let callCount = 0;
    const client = makeClient(async (type) => {
      if (type === "perpDexs") { callCount++; return SAMPLE_PERP_DEXS_RAW; }
      throw new Error(`unexpected call: ${type}`);
    });

    await client.listPerpDexes();
    await client.listPerpDexes();

    expect(callCount).toBe(1);
  });

  it("bypasses cache when force=true", async () => {
    let callCount = 0;
    const client = makeClient(async (type) => {
      if (type === "perpDexs") { callCount++; return SAMPLE_PERP_DEXS_RAW; }
      throw new Error(`unexpected call: ${type}`);
    });

    await client.listPerpDexes();
    await client.listPerpDexes(true);

    expect(callCount).toBe(2);
  });

  it("re-fetches after TTL expires", async () => {
    let callCount = 0;
    const client = makeClient(async (type) => {
      if (type === "perpDexs") { callCount++; return SAMPLE_PERP_DEXS_RAW; }
      throw new Error(`unexpected call: ${type}`);
    });

    await client.listPerpDexes();
    // Manually expire the cache by backdating the timestamp.
    (client as any).dexListCacheAt = Date.now() - 2 * 60 * 60 * 1000; // 2h ago
    await client.listPerpDexes();

    expect(callCount).toBe(2);
  });

  it("returns [] on error and does not throw", async () => {
    const client = makeClient(async (_type) => {
      throw new Error("network error");
    });

    const result = await client.listPerpDexes();

    expect(result).toEqual([]);
  });

  it("filters out entries with non-string name", async () => {
    const rawWithBadEntry = [
      null,
      { name: "xyz", fullName: "XYZ", deployer: "0xabc", oracleUpdater: null, feeRecipient: "0xfee", assetToStreamingOiCap: [] },
      { name: 42, fullName: "BAD", deployer: "0x000", oracleUpdater: null, feeRecipient: "0xfee", assetToStreamingOiCap: [] },
    ];
    const client = makeClient(async (type) => {
      if (type === "perpDexs") return rawWithBadEntry;
      throw new Error(`unexpected call: ${type}`);
    });

    const result = await client.listPerpDexes();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("xyz");
  });
});
