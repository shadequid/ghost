/**
 * Intelligence tools — every ghost_* tool whose purpose is to gather market /
 * context intelligence for the agent. Registered as a single bundle via
 * `createIntelTools(deps)` so the call site stays a one-liner and new intel
 * tools have a single canonical home.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { defineTool } from "./types.js";
import type { ITradingClient } from "../../services/interfaces/trading-client.js";
import type { IntelService } from "../../services/intel.js";
import type { SessionManager } from "../../session/manager.js";
import type { CrossExchangeService } from "../../services/cross-exchange.js";
import type { LiquidationMapService } from "../../services/liquidation-map.js";
import type { TimingRiskService } from "../../services/timing-risk.js";
import type { WhaleTrackingService } from "../../services/whale-tracking.js";
import type { CronService } from "../../scheduler/service.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";
import { formatUsd, formatPct } from "../../helpers/formatters.js";
import { createSessionInfoTool } from "./intel-session.js";
import { createChatHistoryTool } from "./chat-history.js";
import { createCrossExchangeFundingTool } from "./intel-funding.js";
import { createLiquidationMapTool } from "./intel-liquidation.js";
import { createTimingRiskTool } from "./intel-timing.js";
import { createWhaleActivityTool } from "./intel-whale.js";
import { createMorningBriefingTool } from "./intel-briefing.js";

export interface IntelToolsDeps {
  hl: ITradingClient;
  intel: IntelService;
  sessionManager: SessionManager;
  crossExchange: CrossExchangeService;
  liquidationMap: LiquidationMapService;
  timingRisk: TimingRiskService;
  whaleTracking: WhaleTrackingService;
  cronService: CronService;
}

export function createIntelTools(deps: IntelToolsDeps): AgentTool[] {
  const { hl, intel, sessionManager } = deps;
  return [
    defineTool({
      name: "ghost_market_overview",
      label: "Market Overview",
      description: "Composite market overview: Fear & Greed, market cap, TVL, trending, stablecoins.",
      parameters: Type.Object({}),
      async execute() {
        try {
          return textResult(JSON.stringify(await intel.getOverview(), null, 2));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    }),
    defineTool({
      name: "ghost_pre_trade_check",
      label: "Pre-Trade Check",
      description: "Pre-trade advisory: timing risk, funding, OI, orderbook, sentiment analysis before trading.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Symbol to analyze" }),
        side: Type.String({ description: "'buy' (long) or 'sell' (short)" }),
        size: Type.Optional(Type.Number({ description: "Planned size for exposure calc" })),
      }),
      async execute(_toolCallId, params) {
        try {
          const [ticker, book, klines, overview] = await Promise.all([
            hl.getTicker(params.symbol), hl.getOrderbook(params.symbol, 20),
            hl.getKlines(params.symbol, "1h", 24), intel.getOverview().catch(() => null),
          ]);
          const resolved = hl.resolveSymbol(params.symbol);
          const isBuy = params.side === "buy";
          const factors: string[] = [];
          let riskScore = 0;
          // Funding
          const fp = ticker.fundingRate * 100;
          if (isBuy && fp > 0.01) { factors.push(`⚠ Funding ${fp.toFixed(4)}% — longs pay. Crowded long.`); riskScore += 2; }
          else if (!isBuy && fp < -0.01) { factors.push(`⚠ Funding ${fp.toFixed(4)}% — shorts pay. Crowded short.`); riskScore += 2; }
          else { factors.push(`✓ Funding ${fp.toFixed(4)}% — neutral.`); }
          // Volume
          if (klines.length > 0) {
            const avgVol = klines.reduce((s, k) => s + k.volume, 0) / klines.length;
            const latestVol = klines[klines.length - 1].volume;
            if (latestVol < avgVol * 0.5) { factors.push(`⚠ Low volume (${formatUsd(latestVol)} vs avg ${formatUsd(avgVol)}).`); riskScore += 1; }
            else { factors.push(`✓ Volume normal.`); }
          }
          // Orderbook
          const bidVol = book.bids.reduce((s, l) => s + l.size * l.price, 0);
          const askVol = book.asks.reduce((s, l) => s + l.size * l.price, 0);
          const total = bidVol + askVol;
          if (total > 0) {
            const bidPct = bidVol / total * 100;
            if (isBuy && bidPct < 40) { factors.push(`⚠ Weak buy support (${bidPct.toFixed(0)}% bids).`); riskScore += 1; }
            else if (!isBuy && bidPct > 60) { factors.push(`⚠ Strong buy wall (${bidPct.toFixed(0)}% bids).`); riskScore += 1; }
            else { factors.push(`✓ Orderbook balanced (${bidPct.toFixed(0)}% bids).`); }
          }
          factors.push(`  OI: ${formatUsd(ticker.openInterest)} | 24h: ${formatPct(ticker.priceChangePct24h)}`);
          // Sentiment
          if (overview?.fearGreed) {
            const fg = overview.fearGreed;
            factors.push(`  Sentiment: ${fg.classification} (${fg.value}/100)`);
            if (isBuy && fg.value > 75) { factors.push(`⚠ Extreme Greed — reversal risk.`); riskScore += 1; }
            else if (!isBuy && fg.value < 25) { factors.push(`⚠ Extreme Fear — bounce risk.`); riskScore += 1; }
          }
          // Exposure
          if (params.size) {
            const positions = await hl.getPositions();
            const existing = positions.find(p => p.symbol.toUpperCase() === resolved);
            if (existing) { factors.push(`  Note: Already ${existing.side.toUpperCase()} ${existing.symbol} (size: ${existing.size}).`); }
          }
          const level = riskScore >= 4 ? "HIGH" : riskScore >= 2 ? "MODERATE" : "LOW";
          return textResult([`Pre-Trade Check: ${params.side.toUpperCase()} ${resolved}`, `Risk Level: ${level} (${riskScore}/6)`, "─".repeat(40), ...factors].join("\n"));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    }),
    // ghost_session_info: required by proactive-advisor and briefing skills (idle-gate step 1).
    createSessionInfoTool(sessionManager),
    // ghost_chat_history: gives proactive-advisor on-demand access to recent user statements
    // so external-trade-review can quote the user's actual prior thesis when framing divergence.
    createChatHistoryTool(sessionManager),
    // Service-backed intel tools — colocated here so every ghost_* intelligence
    // tool ships from this one factory rather than being scattered across the
    // top-level trading registry.
    createCrossExchangeFundingTool(hl, deps.crossExchange),
    createLiquidationMapTool(deps.liquidationMap),
    createTimingRiskTool(deps.timingRisk),
    createWhaleActivityTool(deps.whaleTracking),
    createMorningBriefingTool(deps.cronService),
  ];
}
