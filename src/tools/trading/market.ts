/**
 * Market data tools: price, funding, orderbook, klines
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { defineTool } from "./types.js";
import type { ITradingClient } from "../../services/interfaces/trading-client.js";
import type { PriceCache } from "../../services/price-cache.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";
import { formatUsd, formatPct } from "../../helpers/formatters.js";

export function createMarketTools(
  hl: ITradingClient,
  priceCache: PriceCache,
): AgentTool[] {
  return [
    defineTool({
      name: "ghost_get_price",
      label: "Get Price",
      description:
        "Get the current mark price plus 24h change, volume, OI, and funding rate for a symbol. " +
        "Mark is Hyperliquid's canonical reference (matches the watchlist row, alerts, PnL, " +
        "liquidation). When asked 'what is the price of X', always quote the Price line — " +
        "do not substitute mid, oracle, or last-trade.",
      parameters: Type.Object({ symbol: Type.String({ description: "Trading symbol (e.g. BTC, ETH)" }) }),
      async execute(_toolCallId, params) {
        try {
          const t = await hl.getTicker(params.symbol);
          // Prefer live mark from priceCache; REST markPx is fallback.
          const cached = priceCache.get(t.symbol);
          const livePrice = cached?.price ?? t.markPrice;
          const sourceTag = cached !== undefined ? "live mark" : "rest mark";
          return textResult([
            `${t.symbol}`,
            "─".repeat(25),
            `Price:    ${formatUsd(livePrice)}      (${sourceTag})`,
            `24h:      ${formatPct(t.priceChangePct24h)}`,
            `Volume:   ${formatUsd(t.volume24h)}`,
            `OI:       ${formatUsd(t.openInterest)}`,
            `Funding:  ${(t.fundingRate * 100).toFixed(4)}%`,
          ].join("\n"));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    }),
    defineTool({
      name: "ghost_get_funding_rates",
      label: "Get Funding Rates",
      description: "Get current and historical funding rates for carry cost analysis.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol" }),
        history: Type.Optional(Type.Boolean({ description: "Include historical rates. Default false." })),
      }),
      async execute(_toolCallId, params) {
        try {
          const t = await hl.getTicker(params.symbol);
          const lines = [`${t.symbol} Funding`, "─".repeat(25), `Current:  ${(t.fundingRate * 100).toFixed(4)}% (${t.fundingRate > 0 ? "longs pay shorts" : "shorts pay longs"})`, `Annual:   ~${(t.fundingRate * 100 * 3 * 365).toFixed(1)}%`];
          if (params.history) {
            const history = await hl.getFundingHistory(params.symbol, 10);
            lines.push("", "Recent History:");
            for (const h of history) {
              const entry = h as Record<string, unknown>;
              const date = new Date(entry.time as number).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit" });
              lines.push(`  ${date}: ${(parseFloat((entry.fundingRate as string) ?? "0") * 100).toFixed(4)}%`);
            }
          }
          return textResult(lines.join("\n"));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    }),
    defineTool({
      name: "ghost_get_orderbook",
      label: "Get Orderbook",
      description: "Get L2 orderbook depth with bid/ask imbalance analysis.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol" }),
        depth: Type.Optional(Type.Number({ description: "Levels per side. Default 10." })),
      }),
      async execute(_toolCallId, params) {
        try {
          const book = await hl.getOrderbook(params.symbol, params.depth ?? 10);
          const bidVol = book.bids.reduce((sum, l) => sum + l.size * l.price, 0);
          const askVol = book.asks.reduce((sum, l) => sum + l.size * l.price, 0);
          const totalVol = bidVol + askVol;
          if (totalVol === 0) return textResult(`${book.symbol} Orderbook: No data available.`);
          const imbalance = bidVol / totalVol * 100;
          const lines = [`${book.symbol} Orderbook`, "─".repeat(40)];
          for (const a of book.asks.slice(0, 5).reverse()) lines.push(`  ASK  ${formatUsd(a.price).padStart(12)}  ${a.size.toFixed(4)}`);
          lines.push(`  ${"─".repeat(35)}`);
          for (const b of book.bids.slice(0, 5)) lines.push(`  BID  ${formatUsd(b.price).padStart(12)}  ${b.size.toFixed(4)}`);
          lines.push("", `Bid: ${formatUsd(bidVol)} | Ask: ${formatUsd(askVol)} | Imbalance: ${imbalance.toFixed(1)}% bids (${imbalance > 55 ? "bullish" : imbalance < 45 ? "bearish" : "balanced"})`);
          return textResult(lines.join("\n"));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    }),
    defineTool({
      name: "ghost_get_klines",
      label: "Get Klines",
      description: "Get OHLCV candlestick data for technical analysis.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol" }),
        interval: Type.Optional(Type.String({ description: "1m, 5m, 15m, 1h, 4h, 1d. Default 1h." })),
        limit: Type.Optional(Type.Number({ description: "Number of candles. Default 20." })),
      }),
      async execute(_toolCallId, params) {
        try {
          const interval = params.interval ?? "1h";
          const klines = await hl.getKlines(params.symbol, interval, params.limit ?? 20);
          if (klines.length === 0) return textResult("No candle data.");
          const resolved = hl.resolveSymbol(params.symbol);
          const latest = klines[klines.length - 1], first = klines[0];
          const high = Math.max(...klines.map(k => k.high)), low = Math.min(...klines.map(k => k.low));
          const totalVol = klines.reduce((s, k) => s + k.volume, 0);
          const lines = [`${resolved} ${interval} (${klines.length} candles)`, "─".repeat(30), `Range: ${formatUsd(low)} — ${formatUsd(high)}`, `Open: ${formatUsd(first.open)} → Close: ${formatUsd(latest.close)}`, `Change: ${formatPct(((latest.close - first.open) / first.open) * 100)}`, `Volume: ${formatUsd(totalVol)}`, "", "Recent:"];
          for (const k of klines.slice(-5)) {
            const t = new Date(k.openTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            lines.push(`  ${t} ${k.close >= k.open ? "▲" : "▼"} O:${formatUsd(k.open)} H:${formatUsd(k.high)} L:${formatUsd(k.low)} C:${formatUsd(k.close)}`);
          }
          return textResult(lines.join("\n"));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    }),
  ];
}
