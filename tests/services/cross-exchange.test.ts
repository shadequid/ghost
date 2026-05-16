import { describe, test, expect } from "bun:test";
import { CrossExchangeService } from "../../src/services/cross-exchange.js";
import type { FundingProvider, FundingRate } from "../../src/services/funding/index.js";

// Minimal mock provider — no fetch, fully in-memory
function makeProvider(
  key: FundingProvider["key"],
  name: string,
  rate: number | null,
  throws = false,
): FundingProvider {
  return {
    name,
    key,
    async fetchFundingRate(): Promise<FundingRate | null> {
      if (throws) throw new Error("provider exploded");
      if (rate === null) return null;
      return { rate, fetchedAt: Date.now() };
    },
  };
}

describe("CrossExchangeService", () => {
  test("all providers return data — cexData has 3 entries, avg and deltaPct computed", async () => {
    const binance = makeProvider("binance", "Binance", 0.0001);
    const bybit = makeProvider("bybit", "Bybit", 0.0002);
    const okx = makeProvider("okx", "OKX", 0.0003);
    const svc = new CrossExchangeService([binance, bybit, okx]);

    const hlRate = 0.0004;
    const result = await svc.getCrossExchangeFunding("BTC", hlRate);

    expect(result.cexData).toHaveLength(3);
    expect(result.degraded).toBe(false);
    expect(result.degradedReason).toBeNull();

    const expectedAvg = (0.0001 + 0.0002 + 0.0003) / 3;
    expect(result.avgCexRate).toBeCloseTo(expectedAvg);
    const expectedDelta = (hlRate - expectedAvg) * 100;
    expect(result.deltaPct).toBeCloseTo(expectedDelta);
  });

  test("one provider returns null — result has 2 entries, avg computed over 2", async () => {
    const svc = new CrossExchangeService([
      makeProvider("binance", "Binance", 0.0001),
      makeProvider("bybit", "Bybit", null),        // symbol not listed
      makeProvider("okx", "OKX", 0.0003),
    ]);

    const result = await svc.getCrossExchangeFunding("BTC", 0.0002);

    expect(result.cexData).toHaveLength(2);
    expect(result.degraded).toBe(false);
    const expectedAvg = (0.0001 + 0.0003) / 2;
    expect(result.avgCexRate).toBeCloseTo(expectedAvg);
  });

  test("all providers return null — cexData empty, avg/delta null, degraded=true", async () => {
    const svc = new CrossExchangeService([
      makeProvider("binance", "Binance", null),
      makeProvider("bybit", "Bybit", null),
      makeProvider("okx", "OKX", null),
    ]);

    const result = await svc.getCrossExchangeFunding("UNKNOWNCOIN", 0.0001);

    expect(result.cexData).toHaveLength(0);
    expect(result.avgCexRate).toBeNull();
    expect(result.avgCexRateText).toBeNull();
    expect(result.deltaPct).toBeNull();
    expect(result.degraded).toBe(true);
    expect(result.degradedReason).toBeTruthy();
  });

  test("one provider throws — Promise.allSettled handles it, remaining 2 entries kept, degraded=false", async () => {
    const svc = new CrossExchangeService([
      makeProvider("binance", "Binance", 0.0001),
      makeProvider("bybit", "Bybit", 0.0002, /* throws */ true),
      makeProvider("okx", "OKX", 0.0003),
    ]);

    const result = await svc.getCrossExchangeFunding("BTC", 0.0002);

    expect(result.cexData).toHaveLength(2);
    expect(result.degraded).toBe(false);
  });

  test("deltaPct is positive when HL rate > CEX average", async () => {
    const cexRate = 0.0001;
    const hlRate = 0.0005;
    const svc = new CrossExchangeService([makeProvider("binance", "Binance", cexRate)]);

    const result = await svc.getCrossExchangeFunding("BTC", hlRate);

    expect(result.deltaPct).not.toBeNull();
    expect(result.deltaPct!).toBeGreaterThan(0);
    expect(result.deltaPct!).toBeCloseTo((hlRate - cexRate) * 100);
  });

  test("deltaPct is negative when HL rate < CEX average", async () => {
    const cexRate = 0.0005;
    const hlRate = 0.0001;
    const svc = new CrossExchangeService([makeProvider("binance", "Binance", cexRate)]);

    const result = await svc.getCrossExchangeFunding("BTC", hlRate);

    expect(result.deltaPct).not.toBeNull();
    expect(result.deltaPct!).toBeLessThan(0);
    expect(result.deltaPct!).toBeCloseTo((hlRate - cexRate) * 100);
  });

  test("deltaPct is zero when HL rate equals CEX average", async () => {
    const rate = 0.0003;
    const svc = new CrossExchangeService([makeProvider("binance", "Binance", rate)]);

    const result = await svc.getCrossExchangeFunding("BTC", rate);

    expect(result.deltaPct).not.toBeNull();
    expect(result.deltaPct!).toBeCloseTo(0);
  });
});
