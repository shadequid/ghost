import { describe, test, expect, mock } from "bun:test";
import { BybitFundingProvider } from "../../../src/services/funding/bybit.js";
import { FundingRateCache } from "../../../src/services/funding/cache.js";
import { NOOP_LOGGER } from "../../../src/logger.js";

function makeProvider(fetchFn: typeof fetch, cache = new FundingRateCache()) {
  return { provider: new BybitFundingProvider(cache, NOOP_LOGGER, fetchFn), cache };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const SUCCESS_BODY = {
  retCode: 0,
  result: {
    list: [{ fundingRate: "0.0001", fundingRateTimestamp: "1714368000000" }],
  },
};

describe("BybitFundingProvider", () => {
  test("fetch success → returns parsed FundingRate with nextFundingAt derived from last + 8h", async () => {
    const fetchFn = mock(() => Promise.resolve(okResponse(SUCCESS_BODY)));
    const { provider, cache } = makeProvider(fetchFn as unknown as typeof fetch);

    const result = await provider.fetchFundingRate("BTC");
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(0.0001);
    // nextFundingAt = 1714368000000 + 8h
    expect(result!.nextFundingAt).toBe(1_714_368_000_000 + 8 * 60 * 60 * 1000);
    expect(cache.get("bybit:BTCUSDT")).toEqual(result);
  });

  test("second call with cache hit → fetchFn NOT called again", async () => {
    const fetchFn = mock(() => Promise.resolve(okResponse(SUCCESS_BODY)));
    const { provider } = makeProvider(fetchFn as unknown as typeof fetch);

    await provider.fetchFundingRate("BTC");
    await provider.fetchFundingRate("BTC");
    expect(fetchFn.mock.calls.length).toBe(1);
  });

  test("retCode !== 0 (symbol not listed) → returns null, no cache write", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(okResponse({ retCode: 10001, result: { list: [] } })),
    );
    const cache = new FundingRateCache();
    const provider = new BybitFundingProvider(cache, NOOP_LOGGER, fetchFn as unknown as typeof fetch);

    const result = await provider.fetchFundingRate("BTC");
    expect(result).toBeNull();
    expect(cache.get("bybit:BTCUSDT")).toBeNull();
  });

  test("HTTP 500 → returns null (logged)", async () => {
    const fetchFn = mock(() => Promise.resolve(new Response("Server Error", { status: 500 })));
    const { provider } = makeProvider(fetchFn as unknown as typeof fetch);
    expect(await provider.fetchFundingRate("BTC")).toBeNull();
  });

  test("fetch throws (timeout) → returns null (logged)", async () => {
    const fetchFn = mock(() => Promise.reject(new Error("AbortError: timeout")));
    const { provider } = makeProvider(fetchFn as unknown as typeof fetch);
    expect(await provider.fetchFundingRate("BTC")).toBeNull();
  });
});
