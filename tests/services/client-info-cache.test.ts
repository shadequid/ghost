/**
 * Unit tests for the domain-agnostic InfoCache and its integration with
 * HyperliquidClient.info() via the opt-in `{ cache: true }` flag.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { HyperliquidClient } from "../../src/services/live/client";
import { InfoCache } from "../../src/services/live/info-cache";

// ─── Logger stub ───

const noopLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => noopLogger,
} as any;

// ─── Fixtures ───

const NATIVE_META = { universe: [{ name: "BTC", szDecimals: 5 }, { name: "ETH", szDecimals: 4 }] };
const XYZ_META    = { universe: [{ name: "xyz:AAPL", szDecimals: 2 }] };

const NATIVE_CTXS = [
  { markPx: "100000", midPx: "99990", oraclePx: "99995", dayNtlVlm: "1e6", prevDayPx: "99000", openInterest: "500", funding: "0.0001" },
  { markPx: "3000",   midPx: "2999",  oraclePx: "2998",  dayNtlVlm: "5e5", prevDayPx: "2950",  openInterest: "1000", funding: "0.00005" },
];

const XYZ_CTXS = [
  { markPx: "180", midPx: "179.5", oraclePx: "179", dayNtlVlm: "2000", prevDayPx: "175", openInterest: "100", funding: "0.00002" },
];

// ─── Helpers ───

/** Build a client whose fetchInfo() is stubbed for controlled call counting. */
function makeClient(
  fetchInfoImpl: (type: string, extra: Record<string, unknown>) => unknown,
): HyperliquidClient {
  const client = new HyperliquidClient(undefined, noopLogger);
  // Stub fetchInfo so the real info() wrapper (with caching/retry) still runs.
  (client as any).fetchInfo = async (type: string, extra: Record<string, unknown>) => {
    return fetchInfoImpl(type, extra);
  };
  return client;
}

// ─── InfoCache unit tests ───

describe("InfoCache", () => {
  it("caches by key within TTL — second call reuses the same promise", async () => {
    let calls = 0;
    const cache = new InfoCache(3000);
    const fetcher = () => { calls++; return Promise.resolve("data"); };

    const r1 = await cache.get("any-key", fetcher);
    const r2 = await cache.get("any-key", fetcher);

    expect(r1).toBe("data");
    expect(r2).toBe("data");
    expect(calls).toBe(1);
  });

  it("treats distinct keys as independent entries", async () => {
    let calls = 0;
    const cache = new InfoCache(3000);
    const fetcher = () => { calls++; return Promise.resolve(calls); };

    await cache.get("key-a", fetcher);
    await cache.get("key-b", fetcher);
    // Same keys again — should reuse cached promises.
    await cache.get("key-a", fetcher);
    await cache.get("key-b", fetcher);

    expect(calls).toBe(2);
  });

  it("refetches after TTL expires", async () => {
    let calls = 0;
    const cache = new InfoCache(100); // 100 ms TTL for fast expiry
    const fetcher = () => { calls++; return Promise.resolve("v" + calls); };

    const r1 = await cache.get("key", fetcher);
    await new Promise<void>((r) => setTimeout(r, 150));
    const r2 = await cache.get("key", fetcher);

    expect(r1).toBe("v1");
    expect(r2).toBe("v2");
    expect(calls).toBe(2);
  });

  it("evicts failed entry so the next caller retries from scratch", async () => {
    let calls = 0;
    const cache = new InfoCache(3000);
    const fetcher = () => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("429"));
      return Promise.resolve("ok");
    };

    await expect(cache.get("key", fetcher)).rejects.toThrow("429");
    const result = await cache.get("key", fetcher);
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("concurrent callers within TTL share one in-flight request", async () => {
    let calls = 0;
    const cache = new InfoCache(3000);
    const fetcher = () => {
      calls++;
      return new Promise<string>((resolve) => setTimeout(() => resolve("data"), 20));
    };

    const [r1, r2, r3] = await Promise.all([
      cache.get("key", fetcher),
      cache.get("key", fetcher),
      cache.get("key", fetcher),
    ]);

    expect(r1).toBe("data");
    expect(r2).toBe("data");
    expect(r3).toBe("data");
    expect(calls).toBe(1);
  });

  it("clear() wipes all entries", async () => {
    let calls = 0;
    const cache = new InfoCache(3000);
    const fetcher = () => { calls++; return Promise.resolve("data"); };

    await cache.get("key", fetcher);
    cache.clear();
    await cache.get("key", fetcher);

    expect(calls).toBe(2);
  });
});

// ─── Integration: client.info() honours the opt-in cache flag ───

describe("HyperliquidClient.info() — opt-in cache flag", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("two concurrent getAllTickers hit metaAndAssetCtxs only once per (type,dex)", async () => {
    const callsPerKey: Record<string, number> = {};

    const client = makeClient((type, extra) => {
      const key = extra.dex !== undefined ? `${type}:${extra.dex}` : type;
      callsPerKey[key] = (callsPerKey[key] ?? 0) + 1;

      if (type === "perpDexs") return [null, { name: "xyz", fullName: "XYZ", deployer: "0xabc" }];
      if (type === "meta" && !extra.dex) return NATIVE_META;
      if (type === "meta" && extra.dex === "xyz") return XYZ_META;
      if (type === "metaAndAssetCtxs" && !extra.dex) return [NATIVE_META, NATIVE_CTXS];
      if (type === "metaAndAssetCtxs" && extra.dex === "xyz") return [XYZ_META, XYZ_CTXS];
      throw new Error(`Unexpected: type=${type} dex=${extra.dex}`);
    });

    const [t1, t2] = await Promise.all([
      client.getAllTickers(),
      client.getAllTickers(),
    ]);

    expect(t1.map((t) => t.symbol).sort()).toEqual(["BTC", "ETH", "xyz:AAPL"].sort());
    expect(t2.map((t) => t.symbol).sort()).toEqual(["BTC", "ETH", "xyz:AAPL"].sort());

    // Cache flag is set → both natives + xyz coalesce to one fetch each.
    expect(callsPerKey["metaAndAssetCtxs"]).toBe(1);
    expect(callsPerKey["metaAndAssetCtxs:xyz"]).toBe(1);
  });

  it("calls without cache:true hit fetchInfo every time even when repeated", async () => {
    let l2Calls = 0;

    const client = new HyperliquidClient({ address: "0xabc", testnet: false }, noopLogger);
    (client as any).fetchInfo = async (type: string, _extra: Record<string, unknown>) => {
      if (type === "l2Book") {
        l2Calls++;
        return { levels: [[], []] };
      }
      throw new Error(`Unexpected: type=${type}`);
    };

    // Two back-to-back orderbook reads — must each hit the network (no cache flag).
    await client.getOrderbook("BTC");
    await client.getOrderbook("BTC");

    expect(l2Calls).toBe(2);
  });
});
