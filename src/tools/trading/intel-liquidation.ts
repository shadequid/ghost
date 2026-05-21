/**
 * Liquidation map tool — estimate liquidation concentration zones.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { defineTool } from "./types.js";
import type { LiquidationMapService } from "../../services/liquidation-map.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";
import { formatUsd } from "../../helpers/formatters.js";

export function createLiquidationMapTool(liquidationMap: LiquidationMapService): AgentTool {
  return defineTool({
    name: "ghost_liquidation_map",
    label: "Liquidation Map",
    description: "Estimate liquidation concentration zones based on common leverage tiers. Shows where liquidations cluster above and below current price.",
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol to analyze liquidation zones for" }),
    }),
    async execute(_toolCallId, params) {
      try {
        const result = await liquidationMap.getLiquidationZones(params.symbol);
        const lines = [
          `Liquidation Map: ${result.symbol}`,
          `Current Price: ${formatUsd(result.currentPrice)}`,
          "\u2500".repeat(50),
        ];

        const above = result.zones.filter((z) => z.price > result.currentPrice);
        const below = result.zones.filter((z) => z.price <= result.currentPrice);

        if (above.length > 0) {
          lines.push("", "Short Liquidation Zones (above price):");
          for (const z of above.sort((a, b) => a.price - b.price)) {
            lines.push(`  ${formatUsd(z.price)} (${z.leverage}x ${z.side}) \u2014 ${z.magnitude} concentration`);
          }
        }

        if (below.length > 0) {
          lines.push("", "Long Liquidation Zones (below price):");
          for (const z of below.sort((a, b) => b.price - a.price)) {
            lines.push(`  ${formatUsd(z.price)} (${z.leverage}x ${z.side}) \u2014 ${z.magnitude} concentration`);
          }
        }

        if (result.zones.length === 0) {
          lines.push("No liquidation zones estimated.");
        }

        return textResult(lines.join("\n"));
      } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
    },
  });
}
