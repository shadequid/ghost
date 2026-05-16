import { describe, test, expect, mock } from "bun:test";
import { OkxFundingProvider } from "../../../src/services/funding/okx.js";
import { FundingRateCache } from "../../../src/services/funding/cache.js";
import { NOOP_LOGGER } from "../../../src/logger.js";

function makeProvider(fetchFn: typeof fetch, cache = new FundingRateCache()) {
  return { provider: new OkxFundingProvider(cache, NOOP_LOGGER, fetchFn), cache };
}

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const SUCCESS_BODY = {
  code: "0",
  data: [{ fundingRate: "0.00010000", nextFundingTime: "1714368000000" }],
};

describe("OkxFundingProvider", () => {
  test("fetch success → returns parsed FundingRate and caches it", async () => {
    const fetchFn = mock(() => Promise.resolve(okResponse(SUCCESS_BODY)));
    const { provider, cache } = makeProvider(fetchFn as unknown as typeof fetch);

    const result = await provider.fetchFundingRate("BTC");
    expect(result).not.toBeNull();
    expect(result!.rate).toBeCloseTo(0.0001);
    expect(result!.nextFundingAt).toBe(1_714_368_000_000);
    expect(cache.get("okx:BTC-USDT-SWAP")).toEqual(result);
  });

  test("second call with cache hit → fetchFn NOT called again", async () => {
    const fetchFn = mock(() => Promise.resolve(okResponse(SUCCESS_BODY)));
    const { provider } = makeProvider(fetchFn as unknown as typeof fetch);

    await provider.fetchFundingRate("BTC");
    await provider.fetchFundingRate("BTC");
    expect(fetchFn.mock.calls.length).toBe(1);
  });

  test("code !== '0' (error response) → returns null, no cache write", async () => {
    const fetchFn = mock(() =>
      Promise.resolve(okResponse({ code: "51001", data: [] })),
    );
    const cache = new FundingRateCache();
    const provider = new OkxFundingProvider(cache, NOOP_LOGGER, fetchFn as unknown as typeof fetch);

    const result = await provider.fetchFundingRate("BTC");
    expect(result).toBeNull();
    expect(cache.get("okx:BTC-USDT-SWAP")).toBeNull();
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
