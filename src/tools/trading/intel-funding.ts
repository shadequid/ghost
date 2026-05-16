/**
 * Cross-exchange funding tool — compare HL funding vs CEX rates.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import type { ITradingClient } from "../../services/interfaces/trading-client.js";
import type { CrossExchangeService } from "../../services/cross-exchange.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";

export function createCrossExchangeFundingTool(
  hl: ITradingClient,
  crossExchange: CrossExchangeService,
): AnyAgentTool {
  return {
    name: "ghost_cross_exchange_funding",
    label: "Cross-Exchange Funding",
    description: "Compare Hyperliquid funding rate vs CEX funding rates (Binance, Bybit, OKX) using direct REST APIs.",
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol to compare funding rates for" }),
    }),
    async execute(_toolCallId, params) {
      try {
        const ticker = await hl.getTicker(params.symbol);
        const resolved = hl.resolveSymbol(params.symbol);
        const result = await crossExchange.getCrossExchangeFunding(resolved, ticker.fundingRate);

        const lines = [
          `Cross-Exchange Funding: ${resolved}`,
          "─".repeat(40),
          `Hyperliquid: ${(ticker.fundingRate * 100).toFixed(4)}%`,
        ];

        if (result.cexData.length > 0) {
          lines.push("", "CEX Funding (live):");
          for (const m of result.cexData) {
            const nextLine = m.nextFundingAt
              ? ` · next in ${Math.max(0, Math.round((m.nextFundingAt - Date.now()) / 60_000))}m`
              : "";
            lines.push(`  ${m.exchange} (${m.symbol}): ${m.rateText}${nextLine}`);
          }
          // Pre-computed average + delta for agent reference. Agent interprets the number.
          lines.push("", `CEX average: ${result.avgCexRateText}`);
          const sign = result.deltaPct! >= 0 ? "+" : "";
          lines.push(`HL vs avg: ${sign}${result.deltaPct!.toFixed(4)} pp`);
        }

        if (result.degraded) {
          lines.push("", `Note: ${result.degradedReason}`);
        }

        return textResult(lines.join("\n"));
      } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
    },
  };
}
