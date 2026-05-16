/**
 * /alerts — Telegram fast-path for the watchlist alert surface.
 *
 *   /alerts            list current price targets
 *   /alerts history    last 20 fired
 *   /alerts clear      delete every active alert
 */

import type { CommandHandler } from "./types.js";

const INDENT_BULLET = "   ‐ ";
const HISTORY_LIMIT = 20;

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffMs = Date.now() - t;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

export const alertsHandler: CommandHandler = async (ctx, args) => {
  const sub = (args[0] ?? "").toLowerCase();

  if (sub === "history") {
    const fired = ctx.alertRules
      .list({ includeFired: true })
      .filter((a) => a.firedAt)
      .slice(0, HISTORY_LIMIT);
    if (fired.length === 0) return "No history.";
    const lines = [`**Alert history** (${fired.length})`, ""];
    for (const a of fired) {
      const arrow = a.condition === "above" ? "▲" : "▼";
      const when = a.firedAt ? fmtRelative(a.firedAt) : "?";
      const note = a.note ? ` — _${a.note}_` : "";
      lines.push(`${INDENT_BULLET}${a.symbol} ${arrow} ${a.condition} ${fmtUsd(a.price)}  ·  ${when}${note}`);
    }
    return lines.join("\n");
  }

  if (sub === "clear") {
    const active = ctx.alertRules.list();
    if (active.length === 0) return "Nothing to clear.";
    let removed = 0;
    for (const a of active) {
      if (ctx.alertRules.remove(a.id)) removed++;
    }
    return `Cleared ${removed}.`;
  }

  if (sub.length > 0) {
    return `Unknown: \`${sub}\`. Use \`/alerts\`, \`/alerts history\`, or \`/alerts clear\`.`;
  }

  const active = ctx.alertRules.list();
  if (active.length === 0) return "No alerts.";
  const lines = [`**Alerts** (${active.length})`, ""];
  for (const a of active) {
    const arrow = a.condition === "above" ? "▲" : "▼";
    const cached = ctx.priceCache.get(a.symbol);
    let dist = "";
    if (cached) {
      const diff = a.price - cached.price;
      const pct = cached.price !== 0 ? (Math.abs(diff) / cached.price) * 100 : 0;
      const sign = diff >= 0 ? "+" : "-";
      dist = `  ·  now ${fmtUsd(cached.price)} (${sign}${fmtUsd(Math.abs(diff))} / ${pct.toFixed(2)}%)`;
    }
    const note = a.note ? ` — _${a.note}_` : "";
    lines.push(`${INDENT_BULLET}${a.symbol} ${arrow} ${a.condition} ${fmtUsd(a.price)}${dist}${note}`);
  }
  return lines.join("\n");
};
