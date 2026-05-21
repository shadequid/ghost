/**
 * Technical analysis tools — thin wrappers around TaIndicatorService and TaLevelsService.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { defineTool } from "./types.js";
import type { TaIndicatorService, IndicatorResult } from "../../services/ta-indicators.js";
import type { TaLevelsService, LevelsResult } from "../../services/ta-levels.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";
import { formatUsd, formatPct } from "../../helpers/formatters.js";

// ---------------------------------------------------------------------------
// Formatting helpers (tool-layer concern, not service)
// ---------------------------------------------------------------------------

function adxDescription(label: string): string {
  return label;
}

function ichimokuSummary(ichi: IndicatorResult["trend"]["ichimoku"]): string {
  const parts: string[] = [];
  if (ichi.cloudPosition !== "unknown") {
    const map = { above: "price above cloud (bullish)", below: "price below cloud (bearish)", inside: "price inside cloud (neutral)" };
    parts.push(map[ichi.cloudPosition]);
  }
  if (ichi.tenkanKijun !== "unknown") {
    parts.push(ichi.tenkanKijun === "bullish" ? "Tenkan > Kijun" : "Tenkan < Kijun");
  }
  if (ichi.chikouSignal !== "unknown") {
    parts.push(ichi.chikouSignal === "bullish" ? "Chikou above price (bullish)" : "Chikou below price (bearish)");
  }
  return parts.join(", ") || "insufficient data";
}

function formatIndicators(data: IndicatorResult): string {
  const { symbol, interval, price, trend, momentum, volatility, volume } = data;
  const lines: string[] = [`${symbol} ${interval} Technical Indicators`, "\u2550".repeat(30), ""];

  // Trend
  const hasTrend = [trend.ema9, trend.ema21, trend.ema50, trend.ema200, trend.vwap, trend.adx, trend.ichimoku.tenkan]
    .some(v => !isNaN(v));
  if (hasTrend) {
    lines.push("TREND");
    for (const [period, val] of [[9, trend.ema9], [21, trend.ema21], [50, trend.ema50], [200, trend.ema200]] as const) {
      if (!isNaN(val)) {
        const rel = price > val ? "price above" : "price below";
        lines.push(`  EMA ${period}:`.padEnd(14) + `${formatUsd(val)} \u2014 ${rel}`);
      }
    }
    if (!isNaN(trend.vwap)) {
      lines.push(`  VWAP:`.padEnd(14) + `${formatUsd(trend.vwap)} \u2014 price ${formatPct(trend.vwapDiffPct)} from VWAP`);
    }
    if (!isNaN(trend.adx)) {
      lines.push(`  ADX:`.padEnd(14) + `${trend.adx.toFixed(1)} \u2014 ${adxDescription(trend.adxLabel)}`);
    }
    if (!isNaN(trend.ichimoku.tenkan)) {
      lines.push(`  Ichimoku:`.padEnd(14) + ichimokuSummary(trend.ichimoku));
    }
    lines.push("");
  }

  // Momentum
  const hasMomentum = [momentum.rsi, momentum.stochRsi.k, momentum.macd.macd, momentum.cci, momentum.williamsR]
    .some(v => !isNaN(v));
  if (hasMomentum) {
    lines.push("MOMENTUM");
    if (!isNaN(momentum.rsi)) lines.push(`  RSI:`.padEnd(14) + momentum.rsi.toFixed(1));
    if (!isNaN(momentum.stochRsi.k)) lines.push(`  StochRSI:`.padEnd(14) + `K ${momentum.stochRsi.k.toFixed(1)} / D ${momentum.stochRsi.d.toFixed(1)}`);
    if (!isNaN(momentum.macd.macd)) {
      const m = momentum.macd;
      const sign = m.histogram >= 0 ? "positive" : "negative";
      lines.push(`  MACD:`.padEnd(14) + `${m.macd >= 0 ? "+" : ""}${m.macd.toFixed(1)} / Signal ${m.signal >= 0 ? "+" : ""}${m.signal.toFixed(1)} / Hist ${m.histogram >= 0 ? "+" : ""}${m.histogram.toFixed(1)} (${sign})`);
    }
    if (!isNaN(momentum.cci)) lines.push(`  CCI:`.padEnd(14) + `${momentum.cci >= 0 ? "+" : ""}${momentum.cci.toFixed(1)}`);
    if (!isNaN(momentum.williamsR)) lines.push(`  Williams:`.padEnd(14) + momentum.williamsR.toFixed(1));
    lines.push("");
  }

  // Volatility
  const hasVol = [volatility.bb.upper, volatility.atr, volatility.keltner.upper]
    .some(v => !isNaN(v));
  if (hasVol) {
    lines.push("VOLATILITY");
    if (!isNaN(volatility.bb.upper)) {
      const bb = volatility.bb;
      lines.push(`  BB:`.padEnd(14) + `Upper ${formatUsd(bb.upper)} / Mid ${formatUsd(bb.middle)} / Lower ${formatUsd(bb.lower)} (BW: ${bb.bandwidth.toFixed(1)}%)`);
    }
    if (!isNaN(volatility.atr)) {
      lines.push(`  ATR:`.padEnd(14) + `${formatUsd(volatility.atr)} (${volatility.atrPct.toFixed(2)}%)`);
    }
    if (!isNaN(volatility.keltner.upper)) {
      const kc = volatility.keltner;
      lines.push(`  Keltner:`.padEnd(14) + `Upper ${formatUsd(kc.upper)} / Mid ${formatUsd(kc.middle)} / Lower ${formatUsd(kc.lower)}`);
    }
    if (!isNaN(volatility.bb.lower) && !isNaN(volatility.keltner.lower)) {
      lines.push(`  Squeeze:`.padEnd(14) + (volatility.squeeze ? "Yes (BB inside Keltner)" : "No (BB outside Keltner)"));
    }
    lines.push("");
  }

  // Volume
  if (!isNaN(volume.obv)) {
    lines.push("VOLUME");
    lines.push(`  OBV:`.padEnd(14) + `${volume.obvTrend} (${volume.confirming ? "confirming" : "diverging from"} ${volume.priceDirection})`);
    lines.push("");
  }

  return lines.join("\n");
}

function formatLevels(data: LevelsResult): string {
  const lines: string[] = [
    `${data.symbol} ${data.interval} Support & Resistance`,
    "\u2550".repeat(30),
    `Current price: ${formatUsd(data.price)}`,
    "",
  ];
  if (data.resistance.length > 0) {
    lines.push("RESISTANCE (above)");
    for (const r of data.resistance) {
      lines.push(`  ${formatUsd(r.price).padEnd(12)} ${r.label.padEnd(26)} ${formatPct(r.distPct)}`);
    }
    lines.push("");
  }
  if (data.support.length > 0) {
    lines.push("SUPPORT (below)");
    for (const s of data.support) {
      lines.push(`  ${formatUsd(s.price).padEnd(12)} ${s.label.padEnd(26)} ${formatPct(s.distPct)}`);
    }
    lines.push("");
  }
  if (data.resistance.length === 0 && data.support.length === 0) {
    lines.push("No clear levels detected in the lookback range.");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createTechnicalTools(taIndicators: TaIndicatorService, taLevels: TaLevelsService): AgentTool[] {
  return [
    defineTool({
      name: "ghost_get_indicators",
      label: "Get Technical Indicators",
      description: "Compute technical indicators (EMA, RSI, MACD, Bollinger, ADX, Ichimoku, etc.) from kline data for a symbol.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol (e.g. BTC, ETH)" }),
        interval: Type.Optional(Type.String({ description: "Candle interval: 1m, 5m, 15m, 1h, 4h, 1d. Default 1h." })),
        indicators: Type.Optional(Type.Array(Type.String(), { description: "Subset of indicators to compute. Default: all." })),
      }),
      async execute(_toolCallId, params) {
        try {
          const result = await taIndicators.getIndicators(params.symbol, params.interval ?? "1h", params.indicators);
          return textResult(formatIndicators(result));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    }),
    defineTool({
      name: "ghost_get_levels",
      label: "Get Support & Resistance Levels",
      description: "Detect support/resistance levels using swing points, Fibonacci retracement, and pivot points.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol (e.g. BTC, ETH)" }),
        interval: Type.Optional(Type.String({ description: "Candle interval. Default 4h." })),
        lookback: Type.Optional(Type.Number({ description: "Number of candles. Default 100." })),
        method: Type.Optional(Type.String({ description: "swing, fibonacci, pivot, or all (default)." })),
      }),
      async execute(_toolCallId, params) {
        try {
          const result = await taLevels.getLevels(params.symbol, params.interval ?? "4h", params.lookback ?? 100, params.method);
          return textResult(formatLevels(result));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    }),
  ];
}
