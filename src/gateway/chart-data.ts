// src/gateway/chart-data.ts
import type { ChartDataResponse } from "../services/interfaces/chart-types.js";
import type { ChartSeriesService, ChartIndicator } from "../services/chart-series.js";
import type { TaLevelsService } from "../services/ta-levels.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_INTERVALS = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);
const VALID_INDICATORS = new Set<ChartIndicator>([
  "bb", "rsi", "macd", "ichimoku", "keltner", "adx",
  "stochrsi", "obv", "williamsr", "atr", "cci", "vwap",
]);
const DEFAULT_INTERVAL = "4h";

// ---------------------------------------------------------------------------
// Handler deps type
// ---------------------------------------------------------------------------

export interface ChartDataDeps {
  chartSeries: ChartSeriesService;
  taLevels?: TaLevelsService;
}

// ---------------------------------------------------------------------------
// Query param parsing helpers
// ---------------------------------------------------------------------------

function parseIndicators(raw: string | undefined): ChartIndicator[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter((s): s is ChartIndicator => VALID_INDICATORS.has(s as ChartIndicator));
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleChartData(
  query: Record<string, string | undefined>,
  deps: ChartDataDeps,
): Promise<{ status: number; body: ChartDataResponse | { error: string } }> {
  const { symbol, interval: rawInterval, indicators: rawIndicators } = query;

  if (!symbol || typeof symbol !== "string" || symbol.trim().length === 0) {
    return { status: 400, body: { error: "symbol is required" } };
  }

  const interval = rawInterval ?? DEFAULT_INTERVAL;
  if (!VALID_INTERVALS.has(interval)) {
    return {
      status: 400,
      body: { error: `interval must be one of: ${[...VALID_INTERVALS].join(", ")}` },
    };
  }

  const indicators = parseIndicators(rawIndicators);

  // Fetch S/R levels (optional — failure is non-fatal)
  let levels;
  if (deps.taLevels) {
    try {
      levels = await deps.taLevels.getLevels(symbol.trim(), interval, 200);
    } catch {
      // proceed without levels
    }
  }

  try {
    const data = await deps.chartSeries.build(symbol.trim(), interval, indicators, levels);
    return { status: 200, body: data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { error: `Failed to build chart data: ${message}` } };
  }
}
