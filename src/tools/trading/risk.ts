/**
 * Risk management tools: SL/TP, bracket orders, partial close, margin.
 *
 * Tools here are pure executors — see `orders.ts` for the orchestrator-level
 * confirm interception design. Confirm card content (title + bullets) is
 * generated mechanically by the per-tool describer table in
 * `services/confirm-policy.ts`. The agent does NOT author confirm cards.
 *
 * Invariant: 1 tool call = 1 step in the batched-confirm bullet list.
 * `ghost_set_sl_tp` therefore creates fresh trigger(s) only — moving an
 * existing SL or TP is the agent's job to express as TWO tool calls in
 * the same response: `ghost_cancel_order(...)` for the old trigger plus
 * `ghost_set_sl_tp(...)` for the new one. The orchestrator batches them
 * into a single confirm card with two bullets.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./types.js";
import type { ITradingClient } from "../../services/interfaces/trading-client.js";
import type { IWalletStore } from "../../services/interfaces/wallet-store.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";
import { formatUsd } from "../../helpers/formatters.js";
import { ensureConnected } from "./ensure-connected.js";

async function ensureCanWrite(hl: ITradingClient, walletStore: IWalletStore) {
  if (hl.canWrite) return null;
  await ensureConnected(hl, walletStore);
  if (hl.canWrite) return null;
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

export function createRiskTools(hl: ITradingClient, walletStore: IWalletStore): AnyAgentTool[] {
  return [
    {
      name: "ghost_set_sl_tp",
      label: "Set SL/TP",
      description: "Set stop-loss and/or take-profit on an existing position. Creates fresh trigger order(s) — does NOT cancel any existing orders. To MOVE an existing SL or TP, emit two tool calls in the same response: `ghost_cancel_order(...)` for the old trigger followed by `ghost_set_sl_tp(...)` for the new one. The orchestrator batches them into one confirm card.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol" }),
        stopLoss: Type.Optional(Type.Number({ description: "Stop-loss price" })),
        takeProfit: Type.Optional(Type.Number({ description: "Take-profit price" })),
      }),
      async execute(_toolCallId, params) {
        try {
          const writeErr = await ensureCanWrite(hl, walletStore); if (writeErr) return writeErr;
          if (!params.stopLoss && !params.takeProfit) return errorResult("Provide stopLoss or takeProfit.");
          const positions = await hl.getPositions();
          const resolved = hl.resolveSymbol(params.symbol);
          const pos = positions.find((p) => p.symbol.toUpperCase() === resolved);
          if (!pos) return errorResult(`No open position for ${resolved}`);
          const closeSide = pos.side === "long" ? "sell" : "buy";

          const results: string[] = [];
          if (params.stopLoss) {
            const r = await hl.placeOrder({ symbol: params.symbol, side: closeSide, size: pos.size, price: params.stopLoss, orderType: "stop_market", reduceOnly: true });
            results.push(`Stop Loss set: ${formatUsd(params.stopLoss)} (${r.status})`);
          }
          if (params.takeProfit) {
            const r = await hl.placeOrder({ symbol: params.symbol, side: closeSide, size: pos.size, price: params.takeProfit, orderType: "take_profit", reduceOnly: true });
            results.push(`Take Profit set: ${formatUsd(params.takeProfit)} (${r.status})`);
          }
          return textResult(results.join("\n"));
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    },
    {
      name: "ghost_bracket_order",
      label: "Bracket Order",
      description: "Place entry + SL + TP in one action. Shows R:R ratio and risk amount.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol" }),
        side: Type.String({ description: "'buy' or 'sell'" }),
        size: Type.Number({ description: "Size in base asset units (e.g. BTC, not USD). For $1000 notional at $69000/BTC: size = 1000/69000 = 0.0145" }),
        entryPrice: Type.Optional(Type.Number({ description: "Entry price (limit). Omit for market." })),
        stopLoss: Type.Number({ description: "Stop-loss price" }),
        takeProfit: Type.Number({ description: "Take-profit price" }),
        leverage: Type.Optional(Type.Number({ description: "Leverage multiplier" })),
      }),
      async execute(_toolCallId, params) {
        try {
          const writeErr = await ensureCanWrite(hl, walletStore); if (writeErr) return writeErr;
          const side = params.side as "buy" | "sell";
          if (side !== "buy" && side !== "sell") return errorResult("Side must be 'buy' or 'sell'");
          if (params.size <= 0) return errorResult("Size must be greater than 0.");
          const entryPx = params.entryPrice ?? (await hl.getTicker(params.symbol)).markPrice;
          const risk = Math.abs(entryPx - params.stopLoss) * params.size;
          const reward = Math.abs(params.takeProfit - entryPx) * params.size;
          if (params.leverage) await hl.setLeverage(params.symbol, params.leverage);
          const entry = await hl.placeOrder({ symbol: params.symbol, side, size: params.size, price: params.entryPrice, orderType: params.entryPrice ? "limit" : "market" });
          const closeSide = (side === "buy" ? "sell" : "buy") as "buy" | "sell";
          const sl = await hl.placeOrder({ symbol: params.symbol, side: closeSide, size: params.size, price: params.stopLoss, orderType: "stop_market", reduceOnly: true });
          const tp = await hl.placeOrder({ symbol: params.symbol, side: closeSide, size: params.size, price: params.takeProfit, orderType: "take_profit", reduceOnly: true });
          return textResult(`Bracket placed:\n  Entry: ${entry.status}${entry.avgFillPrice ? ` @ ${entry.avgFillPrice}` : ""}\n  Stop Loss: ${sl.status} @ ${formatUsd(params.stopLoss)}\n  Take Profit: ${tp.status} @ ${formatUsd(params.takeProfit)}\n  Risk Reward Ratio: 1 to ${risk > 0 ? (reward / risk).toFixed(1) : "∞"}`);
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    },
    {
      name: "ghost_partial_close",
      label: "Partial Close",
      description: "Close part of a position by percentage or size. Shows PnL on closed and remaining.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol" }),
        percentage: Type.Optional(Type.Number({ description: "Percentage to close (1-100)" })),
        size: Type.Optional(Type.Number({ description: "Exact size to close" })),
      }),
      async execute(_toolCallId, params) {
        try {
          const writeErr = await ensureCanWrite(hl, walletStore); if (writeErr) return writeErr;
          if (params.percentage === undefined && params.size === undefined) return errorResult("Provide percentage or size.");
          if ((params.percentage !== undefined && params.percentage <= 0) || (params.size !== undefined && params.size <= 0)) return errorResult("Value must be greater than 0.");
          const positions = await hl.getPositions();
          const resolved = hl.resolveSymbol(params.symbol);
          const pos = positions.find((p) => p.symbol.toUpperCase() === resolved);
          if (!pos) return errorResult(`No open position for ${resolved}`);
          const pct = params.percentage ?? ((params.size! / pos.size) * 100);
          const closeSize = params.size ?? (pos.size * pct / 100);
          const remainSize = pos.size - closeSize;
          const result = await hl.partialClose(params.symbol, pct);
          return textResult(`Partial close: ${result.symbol} ${pct.toFixed(0)}% | ${result.status}${result.filledSize ? ` | Filled: ${result.filledSize}` : ""}\nRemaining: ~${remainSize.toFixed(4)}`);
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    },
    {
      name: "ghost_adjust_margin",
      label: "Adjust Margin",
      description: "Add or withdraw margin for an ISOLATED position. Fails on cross-margin positions — on cross, all positions share account equity, so per-position margin adjustment doesn't apply.",
      parameters: Type.Object({
        symbol: Type.String({ description: "Trading symbol" }),
        amount: Type.Number({ description: "Margin to add (positive) or withdraw (negative)" }),
      }),
      async execute(_toolCallId, params) {
        try {
          const writeErr = await ensureCanWrite(hl, walletStore); if (writeErr) return writeErr;
          const positions = await hl.getPositions();
          const resolved = hl.resolveSymbol(params.symbol);
          const pos = positions.find((p) => p.symbol.toUpperCase() === resolved);
          if (!pos) return errorResult(`No open position for ${resolved}`);
          if (pos.marginMode !== "isolated") {
            return errorResult(`${resolved} is on ${pos.marginMode} margin — adjusting per-position margin only works for isolated positions. To change exposure on cross, reduce size or deposit account-level margin.`);
          }
          const action = params.amount > 0 ? "Add" : "Withdraw";
          await hl.adjustMargin(params.symbol, params.amount);
          const updated = await hl.getPositions();
          const newPos = updated.find((p) => p.symbol.toUpperCase() === resolved);
          const newMargin = newPos ? formatUsd(newPos.margin) : "unknown";
          const newLiq = newPos?.liquidationPrice !== null && newPos?.liquidationPrice !== undefined ? formatUsd(newPos.liquidationPrice) : "N/A";
          return textResult(`Margin adjusted: ${action} ${formatUsd(Math.abs(params.amount))} for ${resolved}\nNew margin: ${newMargin} | New liq: ${newLiq}`);
        } catch (e: unknown) { return errorResult(getErrorMessage(e)); }
      },
    },
  ];
}
