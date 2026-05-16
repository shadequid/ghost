/**
 * History tools: trade history
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import type { ITradingClient } from "../../services/interfaces/trading-client.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";
import { formatUsd, formatPnl } from "../../helpers/formatters.js";

export function createHistoryTools(hl: ITradingClient): AnyAgentTool[] {
  return [
    {
      name: "ghost_get_trade_history",
      label: "Get Trade History",
      description: "Get closed trades with entry/exit price, PnL, fees. Decide which mode fits the user's ask: (a) recent N trades — pass `limit` (default 20). (b) trades within a time window — pass `lookbackHours` (e.g. 168 for 'last week') OR `startTime`/`endTime` (Unix ms). Time-range mode returns ALL fills in the window; do not combine with `limit`. Optional `symbol` filters client-side.",
      parameters: Type.Object({
        symbol: Type.Optional(Type.String({ description: "Filter by symbol (e.g. BTC). Omit for all." })),
        limit: Type.Optional(Type.Number({ description: "Number of recent trades. Default 20. Ignored if time-range params are given." })),
        startTime: Type.Optional(Type.Number({ description: "Start of time range, Unix ms. Use with endTime or alone (endTime defaults to now)." })),
        endTime: Type.Optional(Type.Number({ description: "End of time range, Unix ms. Defaults to now when omitted." })),
        lookbackHours: Type.Optional(Type.Number({ description: "Convenience for 'last N hours'. Translates to startTime = now - lookbackHours*3600000. Use this for 'last week' (168), 'last day' (24), etc." })),
      }),
      async execute(_toolCallId, params) {
        try {
          const useTimeRange = params.startTime !== undefined || params.lookbackHours !== undefined;
          let fills;
          let header;
          let isTimeRange = false;
          if (useTimeRange) {
            const now = Date.now();
            if (params.lookbackHours !== undefined && params.lookbackHours <= 0) {
              return errorResult("lookbackHours must be greater than 0.");
            }
            const startTime = params.lookbackHours !== undefined ? now - params.lookbackHours * 3600_000 : params.startTime!;
            const endTime = params.endTime;
            if (endTime !== undefined && endTime <= startTime) {
              return errorResult(`endTime (${endTime}) must be greater than startTime (${startTime}).`);
            }
            fills = await hl.getFillsByTime(undefined, startTime, endTime);
            const winLabel = params.lookbackHours !== undefined
              ? `last ${params.lookbackHours}h`
              : `${new Date(startTime).toISOString().slice(0, 16).replace("T", " ")} → ${endTime ? new Date(endTime).toISOString().slice(0, 16).replace("T", " ") : "now"}`;
            header = `Trades (${winLabel})`;
            isTimeRange = true;
          } else {
            fills = await hl.getFills(undefined, params.limit ?? 20);
            header = `Recent Trades`;
          }
          let filtered = fills;
          if (params.symbol) {
            const resolved = hl.resolveSymbol(params.symbol);
            filtered = fills.filter((f) => f.symbol.toUpperCase() === resolved);
          }
          if (filtered.length === 0) {
            return textResult(isTimeRange ? "No trades found in the requested window." : "No recent trades found.");
          }
          const totalPnl = filtered.reduce((sum, f) => sum + f.realizedPnl, 0);
          const totalFees = filtered.reduce((sum, f) => sum + f.fee, 0);
          const headerLine = `${header} (${filtered.length}) | Realized PnL: ${formatPnl(totalPnl)} | Fees: ${formatUsd(totalFees)}`;
          const lines = filtered.map((f) => {
            const date = new Date(f.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
            return `  ${date} ${f.symbol} ${f.side.toUpperCase()} ${f.size} @ ${formatUsd(f.price)} | PnL: ${formatPnl(f.realizedPnl)} | Fee: ${formatUsd(f.fee)}`;
          });
          return textResult(`${headerLine}\n${"─".repeat(60)}\n${lines.join("\n")}`);
        } catch (e: unknown) {
          return errorResult(getErrorMessage(e));
        }
      },
    },
  ];
}
