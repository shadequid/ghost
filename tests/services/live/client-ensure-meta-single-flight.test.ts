/**
 * Unit tests for the single-flight ensureMeta() implementation.
 *
 * Verifies that concurrent callers share one rebuild rather than fan-out
 * independently, and that the coalescing slot is released after both
 * success and rejection so future callers can retry.
 */

import { describe, it, expect } from "bun:test";
import { HyperliquidClient } from "../../../src/services/live/client";

// ─── Logger stub ───

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
} as unknown as import("pino").Logger;

// ─── Fixtures ───

const NATIVE_META = {
  universe: [
    { name: "BTC", szDecimals: 5, maxLeverage: 40 },
    { name: "ETH", szDecimals: 4, maxLeverage: 25 },
  ],
};
const XYZ_META = { universe: [{ name: "xyz:AAPL", szDecimals: 2, maxLeverage: 10 }] };
const PERP_DEXES = [{ name: "xyz", fullName: "XYZ DEX", deployer: "0xdead" }];
const PERP_DEXES_PLUS = [
  { name: "xyz", fullName: "XYZ DEX", deployer: "0xdead" },
  { name: "flx", fullName: "FLX DEX", deployer: "0xbeef" },
];
const FLX_META = { universe: [{ name: "flx:TOKEN", szDecimals: 0, maxLeverage: 5 }] };

/** Build a client whose fetchInfo() is stubbed. */
function makeClient(
  fetchInfoImpl: (type: string, extra: Record<string, unknown>) => unknown,
): HyperliquidClient {
  const client = new HyperliquidClient(undefined, noopLogger);
  (client as unknown as Record<string, unknown>).fetchInfo = async (
    type: string,
    extra: Record<string, unknown>,
  ) => fetchInfoImpl(type, extra);
  return client;
}

// ─── Tests ───

describe("ensureMeta single-flight", () => {
  it("cold-start storm: 10 concurrent callers trigger 1+N meta fetches, not 10×(1+N)", async () => {
    let metaCalls = 0;
    const client = makeClient((type, extra) => {
      if (type === "perpDexs") return [...PERP_DEXES];
      if (type === "meta" && !extra.dex) { metaCalls++; return NATIVE_META; }
      if (type === "meta" && extra.dex === "xyz") { metaCalls++; return XYZ_META; }
      throw new Error(`unexpected call: ${type}`);
    });

    // Fire 10 concurrent ensureMeta() calls
    await Promise.all(Array.from({ length: 10 }, () => client.ensureMeta()));

    // 1 native + 1 dex = 2, not 10 × 2 = 20
    expect(metaCalls).toBe(2);
    // Meta should be loaded after the concurrent storm
    expect((client as unknown as Record<string, unknown>).metaLoaded).toBe(true);
  });

  it("rejection recovery: metaInFlight is null after fatal failure so next caller can retry", async () => {
    let attempt = 0;
    // Make perpDexs throw to trigger a fatal rebuild failure (native meta is
    // error-isolated but perpDexs is not, so this causes rebuildMeta to reject
    // via the thrown error propagating from listPerpDexes when not caught at that
    // level). Actually rebuildMeta catches everything — so we simulate rejection
    // by throwing from the entire fetchInfo path including meta:
    const client = new HyperliquidClient(undefined, noopLogger);
    // Override rebuildMeta directly to control rejection
    let rebuildAttempt = 0;
    (client as unknown as Record<string, unknown>).rebuildMeta = async () => {
      rebuildAttempt++;
      if (rebuildAttempt === 1) throw new Error("simulated rebuild failure");
      (client as unknown as Record<string, unknown>).metaLoaded = true;
    };

    // First call should fail
    await expect(client.ensureMeta()).rejects.toThrow("simulated rebuild failure");
    // metaInFlight must be null after rejection so next caller can retry
    expect((client as unknown as Record<string, unknown>).metaInFlight).toBeNull();

    // Second call should succeed
    await expect(client.ensureMeta()).resolves.toBeUndefined();
    expect((client as unknown as Record<string, unknown>).metaLoaded).toBe(true);
    expect(rebuildAttempt).toBe(2);
  });

  it("new-dex burst: 5 concurrent callers after new dex detected = 1 rebuild", async () => {
    let metaCalls = 0;
    const client = makeClient((type, extra) => {
      if (type === "perpDexs") return [...PERP_DEXES_PLUS];
      if (type === "meta" && !extra.dex) { metaCalls++; return NATIVE_META; }
      if (type === "meta" && extra.dex === "xyz") { metaCalls++; return XYZ_META; }
      if (type === "meta" && extra.dex === "flx") { metaCalls++; return FLX_META; }
      throw new Error(`unexpected: ${type}`);
    });

    // Seed metaLoaded = true with only the "xyz" dex known
    (client as unknown as Record<string, unknown>).metaLoaded = true;
    (client as unknown as Record<string, unknown>).dexUniverses = new Map([
      ["", ["BTC", "ETH"]],
      ["xyz", ["xyz:AAPL"]],
    ]);

    const before = metaCalls;
    // 5 concurrent calls — flx is new, so rebuild should fire once
    await Promise.all(Array.from({ length: 5 }, () => client.ensureMeta()));

    // 1 native + 2 dexes (xyz + flx) = 3 meta calls for one rebuild
    expect(metaCalls - before).toBe(3);
  });

  it("fast-path: loaded + no new dex → zero meta fetches for concurrent callers", async () => {
    let metaCalls = 0;
    const client = makeClient((type) => {
      if (type === "perpDexs") return [...PERP_DEXES];
      if (type === "meta") { metaCalls++; return NATIVE_META; }
      throw new Error(`unexpected: ${type}`);
    });

    // Prime meta with "xyz" already known
    (client as unknown as Record<string, unknown>).metaLoaded = true;
    (client as unknown as Record<string, unknown>).dexUniverses = new Map([
      ["", ["BTC", "ETH"]],
      ["xyz", ["xyz:AAPL"]],
    ]);

    await Promise.all(Array.from({ length: 10 }, () => client.ensureMeta()));

    // listPerpDexes is called (returns xyz, already known) — no meta calls
    expect(metaCalls).toBe(0);
  });
});
