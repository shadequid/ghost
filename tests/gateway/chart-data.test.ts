import { describe, test, expect } from "bun:test";
import { handleChartData, type ChartDataDeps } from "../../src/gateway/chart-data.js";
import type { ChartDataResponse } from "../../src/services/interfaces/chart-types.js";
import type { ChartSeriesService } from "../../src/services/chart-series.js";
import type { TaLevelsService } from "../../src/services/ta-levels.js";
import type { LevelsResult } from "../../src/services/ta-levels.js";

// ---------------------------------------------------------------------------
// Minimal stub data
// ---------------------------------------------------------------------------

const STUB_RESPONSE: ChartDataResponse = {
  symbol: "BTC",
  interval: "4h",
  candles: [],
  volumes: [],
  lineOverlays: [],
  bandOverlays: [],
  levels: [],
  subPanes: [],
};

const STUB_LEVELS: LevelsResult = {
  symbol: "BTC",
  interval: "4h",
  price: 65000,
  resistance: [{ price: 66000, label: "R1", distPct: 1.5 }],
  support: [{ price: 64000, label: "S1", distPct: 1.5 }],
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeChartSeries(
  impl: Partial<{ build: ChartSeriesService["build"] }> = {},
): ChartSeriesService {
  return {
    build: impl.build ?? (async () => STUB_RESPONSE),
  } as unknown as ChartSeriesService;
}

function makeTaLevels(
  impl: Partial<{ getLevels: TaLevelsService["getLevels"] }> = {},
): TaLevelsService {
  return {
    getLevels: impl.getLevels ?? (async () => STUB_LEVELS),
  } as unknown as TaLevelsService;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("handleChartData", () => {
  // -------------------------------------------------------------------------
  // 1. Missing symbol → 400
  // -------------------------------------------------------------------------

  test("missing symbol returns 400", async () => {
    const deps: ChartDataDeps = { chartSeries: makeChartSeries() };

    const result = await handleChartData({}, deps);

    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("symbol is required");
  });

  test("empty symbol string returns 400", async () => {
    const deps: ChartDataDeps = { chartSeries: makeChartSeries() };

    const result = await handleChartData({ symbol: "   " }, deps);

    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toBe("symbol is required");
  });

  // -------------------------------------------------------------------------
  // 2. Invalid interval → 400
  // -------------------------------------------------------------------------

  test("invalid interval returns 400", async () => {
    const deps: ChartDataDeps = { chartSeries: makeChartSeries() };

    const result = await handleChartData({ symbol: "BTC", interval: "2h" }, deps);

    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toMatch(/interval must be one of/);
  });

  test("all valid intervals are accepted", async () => {
    const validIntervals = ["1m", "5m", "15m", "1h", "4h", "1d"];
    const deps: ChartDataDeps = { chartSeries: makeChartSeries() };

    for (const interval of validIntervals) {
      const result = await handleChartData({ symbol: "BTC", interval }, deps);
      expect(result.status).toBe(200);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Valid request returns chart data
  // -------------------------------------------------------------------------

  test("valid request returns 200 with chart data", async () => {
    const deps: ChartDataDeps = {
      chartSeries: makeChartSeries({ build: async () => STUB_RESPONSE }),
    };

    const result = await handleChartData({ symbol: "BTC", interval: "4h" }, deps);

    expect(result.status).toBe(200);
    expect(result.body).toEqual(STUB_RESPONSE);
  });

  test("omitted interval defaults to 4h", async () => {
    let capturedInterval: string | undefined;
    const deps: ChartDataDeps = {
      chartSeries: makeChartSeries({
        build: async (_sym, interval) => {
          capturedInterval = interval;
          return STUB_RESPONSE;
        },
      }),
    };

    await handleChartData({ symbol: "ETH" }, deps);

    expect(capturedInterval).toBe("4h");
  });

  test("symbol is trimmed before forwarding", async () => {
    let capturedSymbol: string | undefined;
    const deps: ChartDataDeps = {
      chartSeries: makeChartSeries({
        build: async (sym) => {
          capturedSymbol = sym;
          return STUB_RESPONSE;
        },
      }),
    };

    await handleChartData({ symbol: "  BTC  " }, deps);

    expect(capturedSymbol).toBe("BTC");
  });

  // -------------------------------------------------------------------------
  // 4. Invalid indicators are silently filtered — still returns 200
  // -------------------------------------------------------------------------

  test("invalid indicators are filtered and request returns 200", async () => {
    let capturedIndicators: string[] | undefined;
    const deps: ChartDataDeps = {
      chartSeries: makeChartSeries({
        build: async (_sym, _int, indicators) => {
          capturedIndicators = indicators;
          return STUB_RESPONSE;
        },
      }),
    };

    // "volume" and "ema" are not valid ChartIndicator values
    const result = await handleChartData(
      { symbol: "BTC", interval: "1h", indicators: "rsi,volume,ema,macd" },
      deps,
    );

    expect(result.status).toBe(200);
    expect(capturedIndicators).toEqual(["rsi", "macd"]);
  });

  test("all-invalid indicators result in empty array — still returns 200", async () => {
    let capturedIndicators: string[] | undefined;
    const deps: ChartDataDeps = {
      chartSeries: makeChartSeries({
        build: async (_sym, _int, indicators) => {
          capturedIndicators = indicators;
          return STUB_RESPONSE;
        },
      }),
    };

    const result = await handleChartData(
      { symbol: "BTC", indicators: "invalid,garbage" },
      deps,
    );

    expect(result.status).toBe(200);
    expect(capturedIndicators).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 5. TaLevels failure is non-fatal — still returns 200 without levels
  // -------------------------------------------------------------------------

  test("TaLevels failure is non-fatal — returns 200 without levels", async () => {
    let levelsPassedToBuild: unknown;
    const deps: ChartDataDeps = {
      chartSeries: makeChartSeries({
        build: async (_sym, _int, _ind, levels) => {
          levelsPassedToBuild = levels;
          return STUB_RESPONSE;
        },
      }),
      taLevels: makeTaLevels({
        getLevels: async () => {
          throw new Error("exchange timeout");
        },
      }),
    };

    const result = await handleChartData({ symbol: "BTC", interval: "4h" }, deps);

    expect(result.status).toBe(200);
    expect(levelsPassedToBuild).toBeUndefined();
  });

  test("missing taLevels dep — still returns 200", async () => {
    const deps: ChartDataDeps = { chartSeries: makeChartSeries() };

    const result = await handleChartData({ symbol: "BTC" }, deps);

    expect(result.status).toBe(200);
  });

  test("taLevels result is forwarded to chartSeries.build", async () => {
    let levelsPassedToBuild: unknown;
    const deps: ChartDataDeps = {
      chartSeries: makeChartSeries({
        build: async (_sym, _int, _ind, levels) => {
          levelsPassedToBuild = levels;
          return STUB_RESPONSE;
        },
      }),
      taLevels: makeTaLevels({ getLevels: async () => STUB_LEVELS }),
    };

    await handleChartData({ symbol: "BTC", interval: "4h" }, deps);

    expect(levelsPassedToBuild).toEqual(STUB_LEVELS);
  });

  // -------------------------------------------------------------------------
  // 6. ChartSeriesService.build() failure → 500
  // -------------------------------------------------------------------------

  test("chartSeries.build() failure returns 500", async () => {
    const deps: ChartDataDeps = {
      chartSeries: makeChartSeries({
        build: async () => {
          throw new Error("klines unavailable");
        },
      }),
    };

    const result = await handleChartData({ symbol: "BTC", interval: "4h" }, deps);

    expect(result.status).toBe(500);
    expect((result.body as { error: string }).error).toContain("klines unavailable");
  });

  test("chartSeries.build() failure with non-Error thrown returns 500", async () => {
    const deps: ChartDataDeps = {
      chartSeries: makeChartSeries({
        build: async () => {
          throw "string error";
        },
      }),
    };

    const result = await handleChartData({ symbol: "BTC", interval: "4h" }, deps);

    expect(result.status).toBe(500);
    expect((result.body as { error: string }).error).toContain("string error");
  });
});
