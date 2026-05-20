/**
 * Confirm policy — sidecar registry of tools that require a user confirm
 * card before they execute, plus a per-tool describer table that
 * mechanically formats the card content (title + bullets) from the tool's
 * params.
 *
 * Single source of truth: the agent does NOT author confirm cards. Live
 * testing of the agent-authored approach showed cargo-culting (titles
 * copied verbatim into bullets, bullet rules ignored). Reverting to
 * code-side describers gives deterministic, auditable card content.
 *
 * Trade-off: titles are English-only mechanical strings. The agent's chat
 * advisory above the card already speaks the user's language, so the
 * confirm card can stay neutral and structural.
 *
 * Describer rules:
 *   - Pure sync. No network calls. No service lookups.
 *   - Deterministic from params alone.
 *   - English only. Title always ends with `?`.
 *   - One row per safety datum (Side / Entry / SL / TP / etc).
 *
 * Why a sidecar instead of a field on AgentTool: pi-agent-core's AgentTool
 * interface doesn't model approval semantics (and shouldn't — that's a
 * Ghost concern). Extending AgentTool would either require a fork or
 * polluting the upstream type with an opinionated extra field.
 */

import { formatUsd } from "../helpers/formatters.js";
import {
  composeGenericWizard,
  composeOpenPositionWizard,
} from "./wizard-data.js";
import type { WizardCardData, WizardGenericRow } from "./wizard-data.js";

/** Tool names that require an orchestrator-level confirm card. */
export const CONFIRMABLE_TOOLS: ReadonlySet<string> = new Set([
  "ghost_place_order",
  "ghost_cancel_order",
  "ghost_cancel_all_orders",
  "ghost_emergency_close",
  "ghost_set_sl_tp",
  "ghost_bracket_order",
  "ghost_partial_close",
  "ghost_adjust_margin",
]);

export function isConfirmable(toolName: string): boolean {
  return CONFIRMABLE_TOOLS.has(toolName);
}

export interface ConfirmDescription {
  title: string;
  bullets: string[];
  wizard?: WizardCardData;
  suggestedValue?: string;
}

export type ConfirmDescriber = (
  params: Record<string, unknown>,
) => ConfirmDescription;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getString(params: Record<string, unknown>, key: string): string | undefined {
  const v = params[key];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

function getNumber(params: Record<string, unknown>, key: string): number | undefined {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function upper(s: string | undefined): string {
  return s ? s.toUpperCase() : "";
}

/**
 * Compact USD format for confirm titles: omit decimals when the value is a
 * whole number, otherwise 2dp. Avoids visual noise like `$78,000.00` while
 * keeping precision for fractional levels (e.g. `$80,909.50`). Always
 * comma-separated thousands; locale-safe (manual comma insertion).
 */
function formatUsdCompact(value: number): string {
  const isWhole = Number.isInteger(value);
  const int = Math.trunc(value);
  const intStr = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (isWhole) return `$${intStr}`;
  const dec = Math.abs(value - int).toFixed(2).slice(1);
  return `$${intStr}${dec}`;
}

/** Map raw "buy"/"sell" → human-facing "Long"/"Short". */
function sideLabel(side: string | undefined): string {
  if (!side) return "";
  const s = side.toLowerCase();
  if (s === "buy" || s === "long") return "Long";
  if (s === "sell" || s === "short") return "Short";
  return side;
}

// ---------------------------------------------------------------------------
// Per-tool describers
// ---------------------------------------------------------------------------

function describePlaceOrder(params: Record<string, unknown>): ConfirmDescription {
  const symbol = upper(getString(params, "symbol"));
  const side = sideLabel(getString(params, "side"));
  const leverage = getNumber(params, "leverage");
  const size = getNumber(params, "size");
  const orderType = getString(params, "orderType")?.toLowerCase() ?? "market";
  const price = getNumber(params, "price");
  const sizeStr = size !== undefined ? `${size}` : "";
  const levSuffix = leverage && leverage > 0 ? ` ${leverage}x` : "";

  // Concise title for single-step UI; bullets restore the side/leverage scan
  // line. Multi-step batched cards inline the bullets into the step label
  // (see runtime.ts) so safety data is never lost.
  const sideRow = leverage && leverage > 0
    ? `Side: ${side} ${leverage}x`
    : `Side: ${side}`;

  // Entry comes from tool params (limit only). Market orders leave it
  // undefined — card mirrors what the agent stated; estimates belong in
  // the chat advisory, not in backend-derived fields.
  const wizard = composeOpenPositionWizard({
    symbol: getString(params, "symbol") ?? "",
    side: getString(params, "side") ?? "buy",
    size: getNumber(params, "size") ?? 0,
    leverage: getNumber(params, "leverage"),
    orderType: getString(params, "orderType"),
    entryPrice: price,
  });

  if (orderType === "limit" && price !== undefined) {
    return {
      title: `Place limit order: ${side} ${sizeStr} ${symbol} @ ${formatUsd(price)}?`,
      bullets: [sideRow],
      wizard,
    };
  }

  // market
  return {
    title: `Place market order: ${side} ${sizeStr} ${symbol}?`,
    bullets: [sideRow],
    wizard,
  };
}

function describeBracketOrder(params: Record<string, unknown>): ConfirmDescription {
  const symbol = upper(getString(params, "symbol"));
  const side = sideLabel(getString(params, "side"));
  const leverage = getNumber(params, "leverage");
  const size = getNumber(params, "size");
  // `ghost_bracket_order` schema has no `orderType` — it's derived from the
  // presence of `entryPrice` (limit when set, market otherwise). Mirror the
  // executor's rule (`risk.ts:98`) so the wizard label matches what fires.
  const rawOrderType = getString(params, "orderType")?.toLowerCase();
  const entryPrice = getNumber(params, "entryPrice") ?? getNumber(params, "price");
  const orderType = rawOrderType ?? (entryPrice !== undefined ? "limit" : "market");
  const stopLoss = getNumber(params, "stopLoss");
  const takeProfit = getNumber(params, "takeProfit");

  const sizeStr = size !== undefined ? `${size}` : "";
  const levSuffix = leverage && leverage > 0 ? ` ${leverage}x` : "";

  // Concise title; SL/TP move into bullets for the single-step card. Multi-
  // step batched cards inline these bullets into the step label (see
  // runtime.ts) so safety data is never lost in either path.
  const title = `Place bracket: ${side} ${sizeStr} ${symbol}${levSuffix}?`;

  const isLimit = orderType === "limit" && entryPrice !== undefined;
  const entryRow = isLimit
    ? `Entry: limit @ ${formatUsd(entryPrice as number)}`
    : "Entry: market";
  const bullets: string[] = [entryRow];
  if (stopLoss !== undefined) bullets.push(`SL: ${formatUsdCompact(stopLoss)}`);
  if (takeProfit !== undefined) bullets.push(`TP: ${formatUsdCompact(takeProfit)}`);

  const wizard = composeOpenPositionWizard({
    symbol: getString(params, "symbol") ?? "",
    side: getString(params, "side") ?? "buy",
    size: getNumber(params, "size") ?? 0,
    leverage: getNumber(params, "leverage"),
    orderType,
    entryPrice,
    stopLoss: getNumber(params, "stopLoss"),
    takeProfit: getNumber(params, "takeProfit"),
  });

  return { title, bullets, wizard };
}

function describeSetSlTp(params: Record<string, unknown>): ConfirmDescription {
  const symbol = upper(getString(params, "symbol"));
  const stopLoss = getNumber(params, "stopLoss");
  const takeProfit = getNumber(params, "takeProfit");

  // No wizard. The conversation text above already carries the rationale
  // (cluster, pivot, expected loss in $), and the ActionCard title + bullets
  // restate the SL/TP price — a separate two-line wizard adds no new info.
  // Multi-step batched cards inline bullets into the step label
  // (see runtime.ts) so the levels still survive in that path.
  if (stopLoss !== undefined && takeProfit !== undefined) {
    return {
      title: `Set SL and TP for ${symbol}?`,
      bullets: [`SL: ${formatUsdCompact(stopLoss)}`, `TP: ${formatUsdCompact(takeProfit)}`],
    };
  }
  if (stopLoss !== undefined) {
    return {
      title: `Set stop loss for ${symbol}?`,
      bullets: [`SL: ${formatUsdCompact(stopLoss)}`],
    };
  }
  if (takeProfit !== undefined) {
    return {
      title: `Set take profit for ${symbol}?`,
      bullets: [`TP: ${formatUsdCompact(takeProfit)}`],
    };
  }
  // No SL/TP — boring fallback. The tool will error at execute time.
  return { title: `Set SL/TP for ${symbol}?`, bullets: [] };
}

function describeCancelOrder(params: Record<string, unknown>): ConfirmDescription {
  // ghost_cancel_order takes orders: [{id, symbol}], not a top-level symbol.
  const orders = Array.isArray(params.orders) ? params.orders : [];
  const symbols = new Set<string>();
  for (const o of orders) {
    if (o && typeof o === "object") {
      const sym = (o as { symbol?: unknown }).symbol;
      if (typeof sym === "string" && sym.trim().length > 0) {
        symbols.add(sym.toUpperCase());
      }
    }
  }
  const count = orders.length;
  if (count === 0) {
    // Schema enforces minItems:1, this is defense-in-depth.
    return { title: "Cancel order?", bullets: [] };
  }
  if (count === 1) {
    const only = [...symbols][0];
    if (only) return { title: `Cancel order on ${only}?`, bullets: [] };
    return { title: "Cancel order?", bullets: [] };
  }
  // Multiple orders.
  if (symbols.size === 1) {
    const only = [...symbols][0];
    return { title: `Cancel ${count} orders on ${only}?`, bullets: [] };
  }
  return { title: `Cancel ${count} orders?`, bullets: [] };
}

function describeCancelAllOrders(params: Record<string, unknown>): ConfirmDescription {
  const symbol = upper(getString(params, "symbol"));
  if (symbol) {
    return { title: `Cancel all open orders on ${symbol}?`, bullets: [] };
  }
  return { title: "Cancel all open orders?", bullets: [] };
}

function describeEmergencyClose(params: Record<string, unknown>): ConfirmDescription {
  const symbol = upper(getString(params, "symbol"));
  if (symbol) {
    return { title: `Close ${symbol} position at market?`, bullets: [] };
  }
  return { title: "Close all positions at market?", bullets: [] };
}

function describePartialClose(params: Record<string, unknown>): ConfirmDescription {
  const symbol = upper(getString(params, "symbol"));
  const pct = getNumber(params, "percentage");
  const size = getNumber(params, "size");
  const sizeBefore = getNumber(params, "sizeBefore");

  const rows: WizardGenericRow[] = [];
  if (pct !== undefined) rows.push({ label: "Close %", value: `${pct}%` });
  if (size !== undefined) rows.push({ label: "Size", value: `${size} ${symbol}` });
  if (sizeBefore !== undefined && pct !== undefined) {
    const sizeAfter = sizeBefore * (1 - pct / 100);
    rows.push({ label: "Size before", value: `${sizeBefore}`, tone: "muted" });
    rows.push({ label: "Size after", value: `${sizeAfter}` });
  }
  const wizard = rows.length > 0
    ? composeGenericWizard([{ label: `${symbol} partial close`, rows }])
    : undefined;

  if (pct !== undefined) {
    const pctStr = Number.isInteger(pct) ? `${pct}` : pct.toFixed(0);
    return { title: `Close ${pctStr}% of ${symbol} position?`, bullets: [], wizard };
  }
  if (size !== undefined) {
    // Match chat-table convention: `<size> <SYMBOL>` (see formatPosition in
    // helpers/formatters.ts — "Size: 0.5" with symbol carried separately).
    return { title: `Close ${size} ${symbol} position?`, bullets: [], wizard };
  }
  return { title: `Close part of ${symbol} position?`, bullets: [], wizard };
}

function describeAdjustMargin(params: Record<string, unknown>): ConfirmDescription {
  const symbol = upper(getString(params, "symbol"));
  const amount = getNumber(params, "amount");
  if (amount === undefined) {
    return { title: `Adjust margin on ${symbol}?`, bullets: [] };
  }
  const sign = amount >= 0 ? "+" : "−";
  const rows: WizardGenericRow[] = [
    {
      label: "Margin change",
      value: `${sign}${formatUsd(Math.abs(amount))}`,
      tone: amount >= 0 ? "reward" : "risk",
    },
  ];
  const wizard = composeGenericWizard([{ label: `${symbol} margin adjust`, rows }]);

  if (amount >= 0) {
    return { title: `Add ${formatUsd(amount)} margin to ${symbol}?`, bullets: [], wizard };
  }
  return { title: `Reduce ${formatUsd(Math.abs(amount))} margin on ${symbol}?`, bullets: [], wizard };
}

// ---------------------------------------------------------------------------
// Registry + entry point
// ---------------------------------------------------------------------------

export const CONFIRM_DESCRIBERS: Record<string, ConfirmDescriber> = {
  ghost_place_order: describePlaceOrder,
  ghost_bracket_order: describeBracketOrder,
  ghost_set_sl_tp: describeSetSlTp,
  ghost_cancel_order: describeCancelOrder,
  ghost_cancel_all_orders: describeCancelAllOrders,
  ghost_emergency_close: describeEmergencyClose,
  ghost_partial_close: describePartialClose,
  ghost_adjust_margin: describeAdjustMargin,
};

/**
 * Build the confirm card content for a single tool call. Looks up the
 * per-tool describer in `CONFIRM_DESCRIBERS`; falls back to a generic
 * "Confirm <toolName>?" title when the tool name is unknown (defensive —
 * every confirmable tool should have a describer registered above).
 */
export function describeConfirm(toolName: string, params: unknown): ConfirmDescription {
  const safeParams =
    params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const describer = CONFIRM_DESCRIBERS[toolName];
  if (describer) return describer(safeParams);
  // Verb-first fallback (no "Confirm" prefix) — `prefixConfirmTitle` is the
  // single source of the word "Confirm" so we don't double it for unknown
  // tools when the runtime caller wraps the title.
  return { title: `Run ${toolName}?`, bullets: [] };
}

