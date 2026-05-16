/**
 * Timing risk tool — detect weekends, holidays, post-volatility, macro events.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import type { TimingRiskService } from "../../services/timing-risk.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";

export function createTimingRiskTool(timingRisk: TimingRiskService): AnyAgentTool {
  return {
    name: "ghost_timing_risk",
    label: "Timing Risk",
    description: "Detect timing risks: weekends, holidays, post-volatility, upcoming macro events.",
    parameters: Type.Object({
      symbol: Type.String({ description: "Symbol to check timing risks for" }),
      timezone: Type.Optional(Type.String({ description: "IANA timezone (default: UTC)" })),
    }),
    async execute(_toolCallId, params) {
      try {
        const risks = await timingRisk.getTimingRisks(params.symbol, params.timezone);

        if (risks.length === 0) {
          return textResult(`Timing Risk: ${params.symbol}\nNo timing risks detected.`);
        }

        const lines = [
          `Timing Risk: ${params.symbol}`,
          "\u2500".repeat(40),
        ];

        for (const r of risks) {
          const icon = r.severity === "high" ? "\u26A0" : r.severity === "medium" ? "\u26A0" : "\u2139";
          lines.push(`${icon} [${r.severity.toUpperCase()}] ${r.description}`);
        }

        return textResult(lines.join("\n"));
      } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
    },
  };
}
