/**
 * Whale activity tool — top OI, volume, extreme funding, cluster detection.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import type { WhaleTrackingService } from "../../services/whale-tracking.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";
import { formatUsd, formatPct } from "../../helpers/formatters.js";

export function createWhaleActivityTool(whaleTracking: WhaleTrackingService): AnyAgentTool {
  return {
    name: "ghost_get_whale_activity",
    label: "Get Whale Activity",
    description: "Whale activity on Hyperliquid — top OI, volume, extreme funding, cluster detection. Pass symbol for detailed per-coin view.",
    parameters: Type.Object({
      symbol: Type.Optional(Type.String({ description: "Focus on symbol for detailed view. Omit for market overview." })),
    }),
    async execute(_toolCallId, params) {
      try {
        if (params.symbol) {
          const detail = await whaleTracking.getWhaleActivityForCoin(params.symbol);
          const fundPct = (detail.fundingRate * 100).toFixed(4);
          return textResult([
            `${detail.symbol} Whale Context`,
            "\u2500".repeat(40),
            `Price: ${formatUsd(detail.markPrice)} (${formatPct(detail.priceChangePct24h)} 24h)`,
            `OI: ${formatUsd(detail.openInterest)}`,
            `Volume 24h: ${formatUsd(detail.volume24h)}`,
            `Funding: ${fundPct}% \u2014 ${detail.fundingDirection}`,
            `Volume Trend: ${detail.volumeTrend}`,
            `Funding Trend: ${detail.fundingTrend}`,
            `Volume Spike: ${detail.volumeSpike ? "YES" : "no"}`,
            "",
            detail.interpretation,
          ].join("\n"));
        }

        const overview = await whaleTracking.getWhaleActivity();
        const lines: string[] = [];

        lines.push("Top 10 by Open Interest", "\u2500".repeat(50));
        for (const t of overview.topByOI) {
          lines.push(`${t.symbol.padEnd(8)} OI: ${formatUsd(t.openInterest).padEnd(14)} Vol: ${formatUsd(t.volume24h).padEnd(14)} Fund: ${(t.fundingRate * 100).toFixed(4)}%`);
        }

        lines.push("", "Top 10 by Volume", "\u2500".repeat(50));
        for (const t of overview.topByVolume) {
          lines.push(`${t.symbol.padEnd(8)} Vol: ${formatUsd(t.volume24h).padEnd(14)} OI: ${formatUsd(t.openInterest).padEnd(14)} ${formatPct(t.priceChangePct24h)}`);
        }

        if (overview.extremeFunding.length > 0) {
          lines.push("", "Extreme Funding Rates", "\u2500".repeat(50));
          for (const t of overview.extremeFunding) {
            lines.push(`${t.symbol.padEnd(8)} ${(t.fundingRate * 100).toFixed(4)}% \u2014 ${t.fundingDirection}`);
          }
        }

        if (overview.clusterSignal) {
          lines.push("", `Cluster Signal: ${overview.clusterSignal.description}`);
        }

        return textResult(lines.join("\n"));
      } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
    },
  };
}
