import { describe, test, expect, mock } from "bun:test";
import { BinanceFundingProvider } from "../../../src/services/funding/binance.js";
import { FundingRateCache } from "../../../src/services/funding/cache.js";
import { NOOP_LOGGER } from "../../../src/logger.js";

function makeProvider(fetchFn: typeof fetch) {
  return new BinanceFundingProvider(new FundingRateCache(), NOOP_LOGGER, fetchFn);
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("BinanceFundingProvider", () => {
  test("fetch success → returns parsed FundingRate and caches it", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(okResponse({
        lastFundingRate: "0.00010000",
        nextFundingTime: 1_714_368_000_000,
      })),
    );
    const cache = new FundingRateCache();
    const provider = new BinanceFundingProvider(cache, NOOP_LOGGER, fetchFn as unknown as typeof fetch);

    const result = await provider.fetchFundingRate("BTC");
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(0.0001);
    expect(result!.nextFundingAt).toBe(1_714_368_000_000);
    // Should now be in cache
    expect(cache.get("binance:BTCUSDT")).toEqual(result);
  });

  test("second call with cache hit → fetchFn NOT called again", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(okResponse({ lastFundingRate: "0.0001", nextFundingTime: 0 })),
    );
    const cache = new FundingRateCache();
    const provider = new BinanceFundingProvider(cache, NOOP_LOGGER, fetchFn as unknown as typeof fetch);

    await provider.fetchFundingRate("BTC");
    await provider.fetchFundingRate("BTC");
    expect(fetchFn.mock.calls.length).toBe(1);
  });

  test("HTTP 400 (symbol not listed) → returns null, no cache write", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(new Response("Bad Request", { status: 400 })),
    );
    const cache = new FundingRateCache();
    const provider = new BinanceFundingProvider(cache, NOOP_LOGGER, fetchFn as unknown as typeof fetch);

    const result = await provider.fetchFundingRate("BTC");
    expect(result).toBeNull();
    expect(cache.get("binance:BTCUSDT")).toBeNull();
  });

  test("HTTP 500 → returns null (logged)", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(new Response("Server Error", { status: 500 })),
    );
    const result = await makeProvider(fetchFn as unknown as typeof fetch).fetchFundingRate("BTC");
    expect(result).toBeNull();
  });

  test("fetch throws (timeout) → returns null (logged)", async () => {
    const fetchFn = mock(() => Promise.reject(new Error("AbortError: timeout")));
    const result = await makeProvider(fetchFn as unknown as typeof fetch).fetchFundingRate("BTC");
    expect(result).toBeNull();
  });
});
