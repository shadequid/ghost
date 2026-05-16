/**
 * Recent-orders tool: scan-time external-trade detection.
 *
 * `ghost_get_recent_orders` exposes HL `historicalOrders` (or paper-engine
 * equivalent) to the proactive-advisor skill so external-trade-review can
 * be detected at scan time without WebSocket subscriptions.
 *
 * Attribution: cloid prefix `0x67686f7374` (ASCII "ghost") marks Ghost-placed
 * orders. Anything else — including missing/null cloid (HL UI / 3rd-party
 * tools / pre-cloid-rollout legacy) — is `external`.
 *
 * Kind classification: `protection` if reduceOnly OR triggerPrice present,
 * `position` otherwise.
 *
 * Engine-driven status flag: skip statuses that originated from the HL engine
 * (liquidations, margin calls, scheduled cancels, self-trade prevention) — these
 * are not user intent.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import type { ITradingClient } from "../../services/interfaces/trading-client.js";
import type { OrderRecord } from "../../services/interfaces/trading-types.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";
import { GHOST_CLOID_PREFIX } from "../../helpers/cloid.js";

const ENGINE_DRIVEN_STATUSES: ReadonlyArray<OrderRecord["status"]> = [
  "liquidatedCanceled",
  "marginCanceled",
  "scheduledCancel",
  "selfTradeCanceled",
];

function classifyKind(o: OrderRecord): "position" | "protection" {
  return o.reduceOnly || o.triggerPrice !== null ? "protection" : "position";
}

function classifyAttribution(o: OrderRecord): "ghost-placed" | "external" {
  return typeof o.cloid === "string" && o.cloid.toLowerCase().startsWith(GHOST_CLOID_PREFIX)
    ? "ghost-placed"
    : "external";
}

function isEngineDriven(o: OrderRecord): boolean {
  return ENGINE_DRIVEN_STATUSES.includes(o.status);
}

export function createRecentOrdersTools(hl: ITradingClient): AnyAgentTool[] {
  return [
    {
      name: "ghost_get_recent_orders",
      label: "Get Recent Orders",
      description:
        "Fetch recent orders with cloid attribution (ghost-placed vs external) and kind classification (position vs protection). Use for the proactive external-trade-review topic to detect orders the user placed outside Ghost — call with `attribution: \"external\"` to skip Ghost-placed entries server-side.",
      parameters: Type.Object({
        lookbackHours: Type.Optional(Type.Number({ description: "Look back N hours from now. Default 3." })),
        symbol: Type.Optional(Type.String({ description: "Filter by symbol. Omit for all." })),
        attribution: Type.Optional(Type.Union(
          [Type.Literal("ghost-placed"), Type.Literal("external"), Type.Literal("any")],
          { description: "Filter by attribution. Default 'any'. Use 'external' for proactive external-trade-review." },
        )),
        excludeEngineDriven: Type.Optional(Type.Boolean({ description: "Drop engine-driven cancels (liquidations, margin, scheduled, self-trade). Default true." })),
      }),
      async execute(_toolCallId: string, params: {
        lookbackHours?: number;
        symbol?: string;
        attribution?: "ghost-placed" | "external" | "any";
        excludeEngineDriven?: boolean;
      }) {
        try {
          const lookbackHours = params.lookbackHours ?? 3;
          if (lookbackHours <= 0) {
            return errorResult("lookbackHours must be greater than 0.");
          }
          const attribution = params.attribution ?? "any";
          const excludeEngineDriven = params.excludeEngineDriven ?? true;
          const startTime = Date.now() - lookbackHours * 3600_000;
          const orders = await hl.getHistoricalOrders(undefined, startTime);
          const filtered = params.symbol
            ? orders.filter((o) => o.symbol.toUpperCase() === hl.resolveSymbol(params.symbol!))
            : orders;
          if (filtered.length === 0) {
            return textResult(`No orders in the last ${lookbackHours}h.`);
          }
          const enriched = filtered.map((o) => ({
            symbol: o.symbol,
            side: o.side,
            size: o.size,
            price: o.price,
            triggerPrice: o.triggerPrice,
            reduceOnly: o.reduceOnly,
            status: o.status,
            timestamp: o.timestamp,
            cloid: o.cloid,
            attribution: classifyAttribution(o),
            kind: classifyKind(o),
            engineDriven: isEngineDriven(o),
          }));
          const visible = enriched
            .filter((o) => attribution === "any" || o.attribution === attribution)
            .filter((o) => !excludeEngineDriven || !o.engineDriven);
          if (visible.length === 0) {
            return textResult(
              `No orders matching filter (attribution=${attribution}, excludeEngineDriven=${excludeEngineDriven}) in the last ${lookbackHours}h.`,
            );
          }
          return textResult(JSON.stringify({
            window: `last ${lookbackHours}h`,
            count: visible.length,
            orders: visible,
          }, null, 2));
        } catch (e: unknown) {
          return errorResult(getErrorMessage(e));
        }
      },
    },
  ];
}
