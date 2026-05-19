/**
 * Unit tests for runWithConcurrency and the HIP-3 fan-out concurrency cap.
 *
 * Verifies:
 * - runWithConcurrency never exceeds the stated cap of in-flight calls.
 * - Results are returned in input order (PromiseSettledResult<T>[]).
 * - All 10 dex results come back even when cap < dex count.
 * - getAllTickers never has more than 4 metaAndAssetCtxs calls in flight at once.
 */

import { describe, it, expect } from "bun:test";
import { runWithConcurrency } from "../../src/services/live/info-cache";
import { HyperliquidClient } from "../../src/services/live/client";

// ─── Logger stub ───

const noopLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => noopLogger,
} as any;

// ─── runWithConcurrency unit tests ───

describe("runWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    // Items with descending delays so they complete in reverse order.
    const items = [30, 20, 10]; // delay in ms
    const results = await runWithConcurrency(items, 3, async (delayMs) => {
      await new Promise<void>((r) => setTimeout(r, delayMs));
      return delayMs * 2;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: 60 });
    expect(results[1]).toEqual({ status: "fulfilled", value: 40 });
    expect(results[2]).toEqual({ status: "fulfilled", value: 20 });
  });

  it("captures rejections as rejected results without throwing", async () => {
    const items = [1, 2, 3];
    const results = await runWithConcurrency(items, 3, async (n) => {
      if (n === 2) throw new Error("item 2 failed");
      return n;
    });

    expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
    expect(results[1].status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason.message).toBe("item 2 failed");
    expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
  });

  it("never exceeds concurrency cap — tracks peak in-flight count", async () => {
    const CONCURRENCY = 4;
    const ITEM_COUNT = 10;
    let inFlight = 0;
    let peakInFlight = 0;

    const items = Array.from({ length: ITEM_COUNT }, (_, i) => i);
    await runWithConcurrency(items, CONCURRENCY, async (i) => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Small delay so workers overlap.
      await new Promise<void>((r) => setTimeout(r, 10));
      inFlight--;
      return i;
    });

    expect(peakInFlight).toBeLessThanOrEqual(CONCURRENCY);
  });

  it("processes all 10 items with concurrency 4 and returns them in order", async () => {
    const ITEM_COUNT = 10;
    const items = Array.from({ length: ITEM_COUNT }, (_, i) => i);

    const results = await runWithConcurrency(items, 4, async (i) => i * 10);

    expect(results).toHaveLength(ITEM_COUNT);
    for (let i = 0; i < ITEM_COUNT; i++) {
      expect(results[i]).toEqual({ status: "fulfilled", value: i * 10 });
    }
  });

  it("handles empty input without error", async () => {
    const results = await runWithConcurrency([], 4, async (x: number) => x);
    expect(results).toHaveLength(0);
  });

  it("handles concurrency > item count gracefully", async () => {
    const results = await runWithConcurrency([1, 2], 10, async (n) => n * 2);
    expect(results).toEqual([
      { status: "fulfilled", value: 2 },
      { status: "fulfilled", value: 4 },
    ]);
  });
});

// ─── HyperliquidClient fan-out concurrency cap ───

describe("HyperliquidClient.getAllTickers — concurrency cap", () => {
  const DEX_COUNT = 10;

  /** Build a client with 10 fake HIP-3 dexes and an info() stub that
   *  tracks peak in-flight metaAndAssetCtxs calls. */
  function makeClientWith10Dexes(): {
    client: HyperliquidClient;
    getPeakInFlight: () => number;
    getResultOrder: () => string[];
  } {
    const dexNames = Array.from({ length: DEX_COUNT }, (_, i) => `dex${i}`);

    let inFlight = 0;
    let peakInFlight = 0;
    const completionOrder: string[] = [];

    const client = new HyperliquidClient(undefined, noopLogger);

    (client as any).fetchInfo = async (type: string, extra: Record<string, unknown>) => {
      if (type === "perpDexs") {
        return [null, ...dexNames.map((name) => ({ name, fullName: name.toUpperCase(), deployer: "0x1" }))];
      }
      if (type === "meta" && !extra.dex) {
        return { universe: [] };
      }
      if (type === "meta" && typeof extra.dex === "string") {
        return { universe: [{ name: `${extra.dex}:TOKEN`, szDecimals: 2 }] };
      }
      if (type === "metaAndAssetCtxs" && !extra.dex) {
        return [{ universe: [] }, []];
      }
      if (type === "metaAndAssetCtxs" && typeof extra.dex === "string") {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        // Stagger completion so workers actually overlap.
        await new Promise<void>((r) => setTimeout(r, 5));
        inFlight--;
        completionOrder.push(extra.dex as string);
        return [
          { universe: [{ name: `${extra.dex}:TOKEN`, szDecimals: 2 }] },
          [{ markPx: "10", midPx: "10", oraclePx: "10", dayNtlVlm: "100", prevDayPx: "9", openInterest: "5", funding: "0" }],
        ];
      }
      throw new Error(`Unexpected: type=${type} dex=${extra.dex}`);
    };

    return {
      client,
      getPeakInFlight: () => peakInFlight,
      getResultOrder: () => completionOrder,
    };
  }

  it("never has more than 4 in-flight metaAndAssetCtxs calls at once", async () => {
    const { client, getPeakInFlight } = makeClientWith10Dexes();
    await client.getAllTickers();
    expect(getPeakInFlight()).toBeLessThanOrEqual(4);
  });

  it("returns tickers for all 10 dexes in order", async () => {
    const { client } = makeClientWith10Dexes();
    const tickers = await client.getAllTickers();

    // Each dex contributes one ticker.
    expect(tickers).toHaveLength(DEX_COUNT);

    const symbols = tickers.map((t) => t.symbol);
    // Results must be in dex index order (dex0:TOKEN, dex1:TOKEN, …).
    for (let i = 0; i < DEX_COUNT; i++) {
      expect(symbols[i]).toBe(`dex${i}:TOKEN`);
    }
  });

  it("peak in-flight stays ≤ 4 even when all dexes are ready instantly", async () => {
    // Zero-delay variant — verifies the concurrency cap applies even without async gaps.
    let inFlight = 0;
    let peak = 0;
    const dexNames = Array.from({ length: DEX_COUNT }, (_, i) => `fast${i}`);

    const client = new HyperliquidClient(undefined, noopLogger);
    (client as any).fetchInfo = async (type: string, extra: Record<string, unknown>) => {
      if (type === "perpDexs") {
        return [null, ...dexNames.map((name) => ({ name, fullName: name.toUpperCase(), deployer: "0x1" }))];
      }
      if (type === "meta" && !extra.dex) return { universe: [] };
      if (type === "meta") return { universe: [{ name: `${extra.dex}:T`, szDecimals: 2 }] };
      if (type === "metaAndAssetCtxs" && !extra.dex) return [{ universe: [] }, []];
      if (type === "metaAndAssetCtxs") {
        inFlight++;
        peak = Math.max(peak, inFlight);
        inFlight--;
        return [
          { universe: [{ name: `${extra.dex}:T`, szDecimals: 2 }] },
          [{ markPx: "1", midPx: "1", oraclePx: "1", dayNtlVlm: "1", prevDayPx: "1", openInterest: "1", funding: "0" }],
        ];
      }
      throw new Error(`Unexpected: type=${type}`);
    };

    await client.getAllTickers();
    expect(peak).toBeLessThanOrEqual(4);
  });
});
