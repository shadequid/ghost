import { describe, test, expect } from "bun:test";
import { FundingRateCache } from "../../../src/services/funding/cache.js";
import type { FundingRate } from "../../../src/services/funding/types.js";

const makeRate = (rate = 0.0001): FundingRate => ({
  rate,
  fetchedAt: Date.now(),
});

describe("FundingRateCache", () => {
  test("miss returns null", () => {
    const cache = new FundingRateCache();
    expect(cache.get("binance:BTCUSDT")).toBeNull();
  });

  test("set then get returns the rate", () => {
    const cache = new FundingRateCache();
    const rate = makeRate(0.0002);
    cache.set("binance:BTCUSDT", rate);
    expect(cache.get("binance:BTCUSDT")).toEqual(rate);
  });

  test("entry expired when clock advances past TTL → get returns null and entry evicted", () => {
    let now = 1_000_000;
    const cache = new FundingRateCache(() => now);
    cache.set("binance:BTCUSDT", makeRate());
    // Advance past 60s TTL
    now += 61_000;
    expect(cache.get("binance:BTCUSDT")).toBeNull();
    // Confirm the entry was removed from the internal map (re-fetch required)
    expect(cache.get("binance:BTCUSDT")).toBeNull();
  });

  test("distinct keys are isolated (binance:BTCUSDT vs bybit:BTCUSDT)", () => {
    const cache = new FundingRateCache();
    const rateA = makeRate(0.0001);
    const rateB = makeRate(0.0002);
    cache.set("binance:BTCUSDT", rateA);
    cache.set("bybit:BTCUSDT", rateB);
    expect(cache.get("binance:BTCUSDT")).toEqual(rateA);
    expect(cache.get("bybit:BTCUSDT")).toEqual(rateB);
  });
});
