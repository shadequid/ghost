import { describe, test, expect } from "bun:test";
import { ChartSeriesService } from "../../src/services/chart-series.js";
import type { Kline } from "../../src/services/interfaces/trading-types.js";
import type { ITradingClient } from "../../src/services/interfaces/trading-client.js";
import type { LevelsResult } from "../../src/services/ta-levels.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Generate a deterministic random-walk kline array. */
function makeKlines(count: number, basePrice = 50_000, baseTime = 1_700_000_000_000): Kline[] {
  const klines: Kline[] = [];
  let price = basePrice;
  for (let i = 0; i < count; i++) {
    // Simple walk: seed-based so tests are stable
    const change = Math.sin(i * 0.3) * 100 + Math.cos(i * 0.7) * 50;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.abs(Math.sin(i) * 30);
    const low = Math.min(open, close) - Math.abs(Math.cos(i) * 30);
    const volume = 100 + Math.abs(Math.sin(i * 1.1) * 500);
    klines.push({ openTime: baseTime + i * 60_000, open, high, low, close, volume });
    price = close;
  }
  return klines;
}

function mockClient(klines: Kline[]): ITradingClient {
  return {
    canWrite: false,
    address: "0xtest",
    connect: () => {},
    disconnect: () => {},
    resolveSymbol: (s: string) => s.toUpperCase(),
    getBalance: async () => ({ totalEquity: 0, availableBalance: 0, usedMargin: 0, unrealizedPnl: 0 }),
    getPositions: async () => [],
    getOpenOrders: async () => [],
    getFills: async () => [],
    getFillsByTime: async () => [],
    getHistoricalOrders: async () => [],
    getTicker: async (symbol: string) => ({
      symbol, markPrice: 50_000, midPrice: 50_000, oraclePrice: 50_000,
      volume24h: 0, prevDayPrice: 49_000, priceChangePct24h: 1, openInterest: 0, fundingRate: 0,
    }),
    getAllTickers: async () => [],
    getOrderbook: async () => ({ symbol: "BTC", bids: [], asks: [] }),
    getKlines: async () => klines,
    getFundingHistory: async () => [],
    ensureMeta: async () => {},
    getAssetIndex: async () => 0,
    getMaxLeverage: () => undefined,
    getAllAssetNames: () => [],
    isKnownSymbol: () => false,
    getDexUniverses: () => new Map(),
    subscribeAllDexsAssetCtxs: async () => ({ unsubscribe: async () => {} }),
    closeWs: async () => {},
    placeOrder: async () => ({ symbol: "BTC", side: "buy" as const, orderType: "market", status: "filled" as const }),
    cancelOrder: async () => ({ symbol: "BTC", orderId: "1", status: "cancelled" as const }),
    cancelAllOrders: async () => [],
    setLeverage: async () => ({ symbol: "BTC", leverage: 1, marginMode: "cross" as const }),
    closePosition: async () => ({ symbol: "BTC", side: "buy" as const, orderType: "market", status: "filled" as const }),
    partialClose: async () => ({ symbol: "BTC", side: "buy" as const, orderType: "market", status: "filled" as const }),
    adjustMargin: async () => ({ symbol: "BTC", amount: 0 }),
  };
}

const KLINES_200 = makeKlines(200);
const KLINES_SMALL = makeKlines(15);

// ---------------------------------------------------------------------------
// Candle conversion
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — candles", () => {
  test("converts openTime (ms) to unix seconds", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const first = result.candles[0];
    // openTime for index 0 is 1_700_000_000_000 ms → 1_700_000_000 s
    expect(first.time).toBe(Math.floor(KLINES_200[0].openTime / 1000));
  });

  test("candle OHLC matches kline", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    for (let i = 0; i < result.candles.length; i++) {
      const c = result.candles[i];
      const k = KLINES_200[i];
      expect(c.open).toBe(k.open);
      expect(c.high).toBe(k.high);
      expect(c.low).toBe(k.low);
      expect(c.close).toBe(k.close);
    }
  });

  test("candles array length equals klines length", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    expect(result.candles.length).toBe(200);
  });

  test("symbol and interval are echoed on response", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    expect(result.symbol).toBe("BTC");
    expect(result.interval).toBe("1m");
  });
});

// ---------------------------------------------------------------------------
// Volume coloring
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — volumes", () => {
  test("volumes array length equals klines length", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    expect(result.volumes.length).toBe(200);
  });

  test("up-candle volume is green", () => {
    // Find a kline where close > open
    const upIdx = KLINES_200.findIndex(k => k.close > k.open);
    expect(upIdx).toBeGreaterThanOrEqual(0);
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    expect(result.volumes[upIdx].color).toBe("rgba(38,166,154,0.5)");
  });

  test("down-candle volume is red", () => {
    // Find a kline where close < open
    const downIdx = KLINES_200.findIndex(k => k.close < k.open);
    expect(downIdx).toBeGreaterThanOrEqual(0);
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    expect(result.volumes[downIdx].color).toBe("rgba(239,83,80,0.5)");
  });

  test("volume value matches kline volume", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    for (let i = 0; i < result.volumes.length; i++) {
      expect(result.volumes[i].value).toBe(KLINES_200[i].volume);
    }
  });

  test("volume time is in seconds", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    expect(result.volumes[0].time).toBe(Math.floor(KLINES_200[0].openTime / 1000));
  });
});

// ---------------------------------------------------------------------------
// Base EMA overlays (always present)
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — base EMA overlays", () => {
  test("always produces EMA 21, 50, 200 overlays even when no indicators requested", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const labels = result.lineOverlays.map(o => o.label);
    expect(labels).toContain("EMA 21");
    expect(labels).toContain("EMA 50");
    expect(labels).toContain("EMA 200");
  });

  test("EMA 21 has correct color #f7c948", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const ema21 = result.lineOverlays.find(o => o.label === "EMA 21");
    expect(ema21?.color).toBe("#f7c948");
  });

  test("EMA 50 has correct color #4dabf7", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const ema50 = result.lineOverlays.find(o => o.label === "EMA 50");
    expect(ema50?.color).toBe("#4dabf7");
  });

  test("EMA 200 has correct color #ffffff", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const ema200 = result.lineOverlays.find(o => o.label === "EMA 200");
    expect(ema200?.color).toBe("#ffffff");
  });

  test("EMA data points have time in seconds", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const ema21 = result.lineOverlays.find(o => o.label === "EMA 21")!;
    expect(ema21.data.length).toBeGreaterThan(0);
    // First EMA data point time should be >= first candle time (offset by period)
    expect(ema21.data[0].time).toBeGreaterThanOrEqual(Math.floor(KLINES_200[0].openTime / 1000));
  });

  test("EMA 21 data length is 200 - 21 + 1 = 180", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const ema21 = result.lineOverlays.find(o => o.label === "EMA 21")!;
    expect(ema21.data.length).toBe(200 - 21 + 1);
  });

  test("EMA 200 data length is 1 for exactly 200 candles", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const ema200 = result.lineOverlays.find(o => o.label === "EMA 200")!;
    expect(ema200.data.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Bollinger Bands
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — bb indicator", () => {
  test("bb adds a bandOverlay labeled 'BB'", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["bb"]);
    const bb = result.bandOverlays.find(o => o.label === "BB");
    expect(bb).toBeDefined();
  });

  test("bb overlay has upperData and lowerData", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["bb"]);
    const bb = result.bandOverlays.find(o => o.label === "BB")!;
    expect(bb.upperData.length).toBeGreaterThan(0);
    expect(bb.lowerData.length).toBeGreaterThan(0);
  });

  test("bb not present when not in indicators", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const bb = result.bandOverlays.find(o => o.label === "BB");
    expect(bb).toBeUndefined();
  });

  test("bb upper is always above lower", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["bb"]);
    const bb = result.bandOverlays.find(o => o.label === "BB")!;
    const len = Math.min(bb.upperData.length, bb.lowerData.length);
    for (let i = 0; i < len; i++) {
      expect(bb.upperData[i].value).toBeGreaterThanOrEqual(bb.lowerData[i].value);
    }
  });
});

// ---------------------------------------------------------------------------
// Ichimoku
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — ichimoku indicator", () => {
  test("ichimoku adds a bandOverlay labeled 'Ichimoku'", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["ichimoku"]);
    const ichi = result.bandOverlays.find(o => o.label === "Ichimoku");
    expect(ichi).toBeDefined();
  });

  test("ichimoku overlay has upperData and lowerData", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["ichimoku"]);
    const ichi = result.bandOverlays.find(o => o.label === "Ichimoku")!;
    expect(ichi.upperData.length).toBeGreaterThan(0);
    expect(ichi.lowerData.length).toBeGreaterThan(0);
  });

  test("ichimoku not present when not requested", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const ichi = result.bandOverlays.find(o => o.label === "Ichimoku");
    expect(ichi).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Keltner Channels
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — keltner indicator", () => {
  test("keltner adds a bandOverlay labeled 'Keltner'", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["keltner"]);
    const kc = result.bandOverlays.find(o => o.label === "Keltner");
    expect(kc).toBeDefined();
  });

  test("keltner has upperData and lowerData", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["keltner"]);
    const kc = result.bandOverlays.find(o => o.label === "Keltner")!;
    expect(kc.upperData.length).toBeGreaterThan(0);
    expect(kc.lowerData.length).toBeGreaterThan(0);
  });

  test("keltner upper is always >= lower", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["keltner"]);
    const kc = result.bandOverlays.find(o => o.label === "Keltner")!;
    const len = Math.min(kc.upperData.length, kc.lowerData.length);
    for (let i = 0; i < len; i++) {
      expect(kc.upperData[i].value).toBeGreaterThanOrEqual(kc.lowerData[i].value);
    }
  });
});

// ---------------------------------------------------------------------------
// RSI
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — rsi indicator", () => {
  test("rsi adds a subPane labeled 'RSI'", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["rsi"]);
    const rsi = result.subPanes.find(p => p.label === "RSI");
    expect(rsi).toBeDefined();
  });

  test("rsi subPane has type 'line'", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["rsi"]);
    const rsi = result.subPanes.find(p => p.label === "RSI")!;
    expect(rsi.type).toBe("line");
  });

  test("rsi subPane has zones at 70 and 30", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["rsi"]);
    const rsi = result.subPanes.find(p => p.label === "RSI")!;
    const zoneValues = rsi.zones?.map(z => z.value) ?? [];
    expect(zoneValues).toContain(70);
    expect(zoneValues).toContain(30);
  });

  test("rsi data values are between 0 and 100", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["rsi"]);
    const rsi = result.subPanes.find(p => p.label === "RSI")!;
    for (const d of rsi.data) {
      expect(d.value).toBeGreaterThanOrEqual(0);
      expect(d.value).toBeLessThanOrEqual(100);
    }
  });

  test("rsi not present when not requested", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const rsi = result.subPanes.find(p => p.label === "RSI");
    expect(rsi).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// MACD
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — macd indicator", () => {
  test("macd adds a subPane labeled 'MACD'", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["macd"]);
    const macd = result.subPanes.find(p => p.label === "MACD");
    expect(macd).toBeDefined();
  });

  test("macd subPane has type 'macd'", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["macd"]);
    const macd = result.subPanes.find(p => p.label === "MACD")!;
    expect(macd.type).toBe("macd");
  });

  test("macd subPane has signalData and histogramData", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["macd"]);
    const macd = result.subPanes.find(p => p.label === "MACD")!;
    expect(macd.signalData).toBeDefined();
    expect(macd.signalData!.length).toBeGreaterThan(0);
    expect(macd.histogramData).toBeDefined();
    expect(macd.histogramData!.length).toBeGreaterThan(0);
  });

  test("macd histogram bars are green or red colored", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["macd"]);
    const macd = result.subPanes.find(p => p.label === "MACD")!;
    const validColors = ["rgba(38,166,154,0.8)", "rgba(239,83,80,0.8)"];
    for (const bar of macd.histogramData!) {
      expect(validColors).toContain(bar.color);
    }
  });

  test("macd not present when not requested", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const macd = result.subPanes.find(p => p.label === "MACD");
    expect(macd).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ADX
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — adx indicator", () => {
  test("adx adds a subPane labeled 'ADX'", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["adx"]);
    const adx = result.subPanes.find(p => p.label === "ADX");
    expect(adx).toBeDefined();
  });

  test("adx subPane has type 'line'", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["adx"]);
    const adx = result.subPanes.find(p => p.label === "ADX")!;
    expect(adx.type).toBe("line");
  });

  test("adx data values are non-negative", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["adx"]);
    const adx = result.subPanes.find(p => p.label === "ADX")!;
    for (const d of adx.data) {
      expect(d.value).toBeGreaterThanOrEqual(0);
    }
  });

  test("adx not present when not requested", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    const adx = result.subPanes.find(p => p.label === "ADX");
    expect(adx).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Levels mapping
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — levels", () => {
  const levelsResult: LevelsResult = {
    symbol: "BTC",
    interval: "1m",
    price: 50_000,
    resistance: [
      { price: 51_000, label: "Swing R1", distPct: 2 },
      { price: 52_000, label: "Pivot R2", distPct: 4 },
    ],
    support: [
      { price: 49_000, label: "Swing S1", distPct: -2 },
    ],
  };

  test("resistance levels are mapped as ChartLevel with side=resistance", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", [], levelsResult);
    const resistanceLevels = result.levels.filter(l => l.side === "resistance");
    expect(resistanceLevels.length).toBe(2);
    expect(resistanceLevels[0].price).toBe(51_000);
    expect(resistanceLevels[0].label).toBe("Swing R1");
    expect(resistanceLevels[1].price).toBe(52_000);
  });

  test("support levels are mapped as ChartLevel with side=support", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", [], levelsResult);
    const supportLevels = result.levels.filter(l => l.side === "support");
    expect(supportLevels.length).toBe(1);
    expect(supportLevels[0].price).toBe(49_000);
    expect(supportLevels[0].label).toBe("Swing S1");
  });

  test("no levels when not provided", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", []);
    expect(result.levels).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple indicators combined
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — multiple indicators", () => {
  test("all indicators can be requested together", () => {
    const result = ChartSeriesService.buildSeries(KLINES_200, "BTC", "1m", ["bb", "ichimoku", "keltner", "rsi", "macd", "adx"]);
    expect(result.bandOverlays.length).toBe(3); // bb + ichimoku + keltner
    expect(result.subPanes.length).toBe(3);     // rsi + macd + adx
  });
});

// ---------------------------------------------------------------------------
// Partial / insufficient data
// ---------------------------------------------------------------------------

describe("ChartSeriesService.buildSeries — insufficient data", () => {
  test("15 klines do not crash — returns partial data", () => {
    expect(() => {
      ChartSeriesService.buildSeries(KLINES_SMALL, "BTC", "1m", ["bb", "rsi", "macd", "adx"]);
    }).not.toThrow();
  });

  test("15 klines still returns correct candle count", () => {
    const result = ChartSeriesService.buildSeries(KLINES_SMALL, "BTC", "1m", []);
    expect(result.candles.length).toBe(15);
  });

  test("15 klines — EMA 200 overlay is empty (not enough data)", () => {
    const result = ChartSeriesService.buildSeries(KLINES_SMALL, "BTC", "1m", []);
    const ema200 = result.lineOverlays.find(o => o.label === "EMA 200")!;
    expect(ema200.data.length).toBe(0);
  });

  test("15 klines — EMA 21 overlay is empty (not enough data)", () => {
    const result = ChartSeriesService.buildSeries(KLINES_SMALL, "BTC", "1m", []);
    const ema21 = result.lineOverlays.find(o => o.label === "EMA 21")!;
    expect(ema21.data.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// async build() via ITradingClient
// ---------------------------------------------------------------------------

describe("ChartSeriesService.build()", () => {
  test("calls getKlines and resolveSymbol on client", async () => {
    const klines = makeKlines(200);
    let klinesWasCalled = false;
    let resolveWasCalled = false;
    const client: ITradingClient = {
      ...mockClient(klines),
      resolveSymbol: (s: string) => { resolveWasCalled = true; return s.toUpperCase(); },
      getKlines: async () => { klinesWasCalled = true; return klines; },
    };
    const service = new ChartSeriesService(client);
    await service.build("BTC", "1m", []);
    expect(klinesWasCalled).toBe(true);
    expect(resolveWasCalled).toBe(true);
  });

  test("returns ChartDataResponse with correct symbol", async () => {
    const klines = makeKlines(200);
    const service = new ChartSeriesService(mockClient(klines));
    const result = await service.build("BTC", "1m", []);
    expect(result.symbol).toBe("BTC");
  });

  test("async build with all indicators", async () => {
    const klines = makeKlines(200);
    const service = new ChartSeriesService(mockClient(klines));
    const result = await service.build("BTC", "1m", ["bb", "rsi", "macd", "adx", "ichimoku", "keltner"]);
    expect(result.bandOverlays.length).toBe(3);
    expect(result.subPanes.length).toBe(3);
    expect(result.candles.length).toBe(200);
  });
});
