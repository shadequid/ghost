/**
 * Trading tools: place orders, cancel, close, leverage.
 *
 * Tools here are pure executors — they do NOT call `confirm()`. The
 * orchestrator intercepts confirmable calls before they reach `execute()`
 * and runs a single combined confirm card per assistant message. Confirm
 * card content (title + bullets) is generated mechanically from the
 * tool's params via the per-tool describer table in
 * `services/confirm-policy.ts`. The agent does NOT author confirm cards.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import type { ITradingClient } from "../../services/interfaces/trading-client.js";
import type { IWalletStore } from "../../services/interfaces/wallet-store.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";
import type { OpenOrder } from "../../services/interfaces/trading-types.js";
import { ensureConnected } from "./ensure-connected.js";

async function ensureCanWrite(hl: ITradingClient, walletStore: IWalletStore) {
  if (hl.canWrite) return null;
  // Try auto-reconnect from DB
  await ensureConnected(hl, walletStore);
  if (hl.canWrite) return null;
  // Still can't write — give helpful error
  const wallets = walletStore.listWallets();
  const watchOnly = wallets.filter((w) => w.status === "watch");
  if (watchOnly.length > 0) {
    return errorResult("Wallet is watch-only — trading not enabled.");
  }
  return errorResult("No wallet connected. Use ghost_connect_wallet to connect.");
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function createTradingTools(hl: ITradingClient, walletStore: IWalletStore): AnyAgentTool[] {
  return [
    {
      name: "ghost_place_order",
      label: "Place Order",
      description: "Place a market or limit order on Hyperliquid. Requires wallet connected.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol (e.g. BTC, ETH, SOL)" }),
        side: Type.String({ description: "'buy' (long) or 'sell' (short)" }),
        size: Type.Number({ description: "Size in base asset units" }),
        orderType: Type.Optional(Type.String({ description: "'market' (default) or 'limit'" })),
        price: Type.Optional(Type.Number({ description: "Limit price (required for limit orders)" })),
        leverage: Type.Optional(Type.Number({ description: "Set leverage before placing" })),
        reduceOnly: Type.Optional(Type.Boolean({ description: "Only reduces existing position" })),
      }),
      async execute(_toolCallId, params) {
        try {
          const writeErr = await ensureCanWrite(hl, walletStore); if (writeErr) return writeErr;
          const side = params.side as "buy" | "sell";
          if (side !== "buy" && side !== "sell") return errorResult("Side must be 'buy' or 'sell'");
          if (params.size <= 0) return errorResult("Size must be greater than 0.");
          const orderType = (params.orderType as "market" | "limit") ?? "market";
          if (orderType === "limit" && !params.price) return errorResult("Limit order requires price");
          if (params.leverage) await hl.setLeverage(params.symbol, params.leverage);
          const result = await hl.placeOrder({ symbol: params.symbol, side, size: params.size, price: params.price, orderType, reduceOnly: params.reduceOnly });
          if (result.status === "filled") return textResult(`Order FILLED: ${result.side.toUpperCase()} ${result.symbol} | Size: ${result.filledSize} | Avg: ${result.avgFillPrice}`);
          if (result.status === "resting") return textResult(`Order PLACED: ${result.side.toUpperCase()} ${result.symbol} | Size: ${result.size} | Price: ${result.price} | ID: ${result.orderId}`);
          return textResult(`Order submitted: ${result.status} | ${result.symbol} ${result.side}`);
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    },
    {
      name: "ghost_set_leverage",
      label: "Set Leverage",
      description: "Set leverage and margin mode for a symbol. Executes immediately without a confirm card — leverage is an account setting that does not by itself open or close a position.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol" }),
        leverage: Type.Number({ description: "Leverage multiplier (e.g. 2, 5, 10)" }),
        cross: Type.Optional(Type.Boolean({ description: "Cross margin. Default true." })),
      }),
      async execute(_toolCallId, params) {
        try {
          const writeErr = await ensureCanWrite(hl, walletStore); if (writeErr) return writeErr;
          const result = await hl.setLeverage(params.symbol, params.leverage, params.cross !== false);
          return textResult(`Leverage set: ${result.symbol} ${result.leverage}x ${result.marginMode}`);
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    },
    {
      name: "ghost_cancel_order",
      label: "Cancel Order",
      description: "Cancel one or more specific pending orders by ID. Pass every target in a single call for one atomic confirm.",
      parameters: Type.Object({
        orders: Type.Array(
          Type.Object({
            id: Type.String({ description: "Order ID" }),
            symbol: Type.String({ description: "Trading symbol this order belongs to" }),
          }),
          {
            minItems: 1,
            maxItems: 10,
            description: "Orders to cancel. Each element carries its own id + symbol so mixed-market cancels are supported.",
          },
        ),
      }),
      async execute(_toolCallId, params) {
        try {
          const writeErr = await ensureCanWrite(hl, walletStore); if (writeErr) return writeErr;
          const seen = new Set<string>();
          const targets: Array<{ id: string; symbol: string }> = [];
          for (const o of params.orders) {
            if (seen.has(o.id)) continue;
            seen.add(o.id);
            targets.push({ id: o.id, symbol: o.symbol });
          }
          const settled = await Promise.allSettled(
            targets.map((t) => hl.cancelOrder(t.symbol, t.id)),
          );
          const outcomes = settled.map((outcome, i) => {
            if (outcome.status === "fulfilled") return `Cancelled #${targets[i].id}`;
            return `Failed #${targets[i].id} — ${getErrorMessage(outcome.reason)}`;
          });
          return textResult(outcomes.join("\n"));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    },
    {
      name: "ghost_cancel_all_orders",
      label: "Cancel All Orders",
      description: "Cancel ALL open pending orders as a sweep. Provide `symbol` to scope to one market; omit to cancel across every market. No per-order selection — this is all-or-nothing.",
      parameters: Type.Object({
        symbol: Type.Optional(Type.String({ description: "Trading symbol. When provided, cancel all open orders for that symbol only. When omitted, cancel across all markets." })),
      }),
      async execute(_toolCallId, params) {
        try {
          const writeErr = await ensureCanWrite(hl, walletStore); if (writeErr) return writeErr;
          const orders = await hl.getOpenOrders();
          let targets: OpenOrder[];
          let resolved: string | undefined;
          if (params.symbol) {
            resolved = hl.resolveSymbol(params.symbol);
            targets = orders.filter((o) => o.symbol.toUpperCase() === resolved);
          } else {
            targets = orders;
          }
          if (targets.length === 0) return textResult("No open orders to cancel.");
          const uniqueMarkets = new Set(targets.map((t) => t.symbol.toUpperCase()));
          const preposition = !resolved && uniqueMarkets.size > 1 ? "across" : "for";
          const results = await hl.cancelAllOrders(params.symbol);
          const label = resolved ?? (uniqueMarkets.size === 1 ? [...uniqueMarkets][0] : `${uniqueMarkets.size} markets`);
          return textResult(`Cancelled ${results.length} order(s) ${preposition} ${label}.`);
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    },
    {
      name: "ghost_emergency_close",
      label: "Emergency Close",
      description: "Close a position immediately at market price. Close specific symbol or ALL positions.",
      parameters: Type.Object({
        symbol: Type.Optional(Type.String({ description: "Symbol to close. Omit for ALL." })),
      }),
      async execute(_toolCallId, params) {
        try {
          const writeErr = await ensureCanWrite(hl, walletStore); if (writeErr) return writeErr;
          if (params.symbol) {
            const positions = await hl.getPositions();
            const resolved = hl.resolveSymbol(params.symbol);
            const pos = positions.find((p) => p.symbol.toUpperCase() === resolved);
            if (!pos) return errorResult(`No open position for ${resolved}`);
            const result = await hl.closePosition(params.symbol);
            return textResult(`Position CLOSED: ${result.symbol} ${result.side} | Fill: ${result.filledSize} @ ${result.avgFillPrice}`);
          }
          const positions = await hl.getPositions();
          if (positions.length === 0) return textResult("No open positions.");
          const results = [];
          for (const pos of positions) { results.push(`${(await hl.closePosition(pos.symbol)).symbol}: closed`); }
          return textResult(`Closed ${results.length} position(s):\n${results.join("\n")}`);
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    },
  ];
}
