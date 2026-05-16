/**
 * /positions — detailed open positions per wallet.
 *
 * Drill-down companion to /portfolio's compact list. Each position renders
 * as a bold header line (`**BTC** · Long 10x · cross`) plus plain
 * `Label: value` rows for size, entry, mark, PnL, liquidation, and margin
 * so the trader can read everything the exchange exposes for the position
 * without leaving Telegram.
 *
 * Layout matches /portfolio's balance block — plain rows, no bullet
 * markers. Telegram's proportional font defeats character-padded columns,
 * so each row reads independently.
 *
 * Multi-wallet → one message per wallet (handler returns string[]).
 *
 * Optional arg `/positions BTC` filters to one symbol.
 */

import type { Position } from "../../../services/interfaces/trading-types.js";
import type { CommandHandler } from "./types.js";
import { fmtSignedPct, truncateAddress, truncateRows } from "./types.js";

function fmtUsd2(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedUsd(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${fmtUsd2(Math.abs(n))}`;
}

function fmtPriceMaybe(n: number | null): string {
  return n === null ? "—" : `$${fmtUsd2(n)}`;
}

function fmtSize(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Indent + hyphen + space prefix for each row. The hyphen is U+2010 to
 *  bypass the formatter's `^[ \t]*[-*]` bullet rewriter (which would
 *  otherwise turn ASCII `-` into `•`). Same convention as /portfolio. */
const INDENT_BULLET = "   ‐ ";

function renderPosition(p: Position): string {
  const sideLabel = p.side === "long" ? "Long" : "Short";
  const header = `**${p.symbol}** · ${sideLabel} ${p.leverage}x · ${p.marginMode}`;
  // Indented `‐ Label: value` rows — same shape as /portfolio's balance
  // block. Each field on its own line so entry/mark/liq/margin read
  // top-to-bottom without slash-combining.
  const body = [
    `${INDENT_BULLET}Size: ${fmtSize(p.size)}`,
    `${INDENT_BULLET}Entry: ${fmtPriceMaybe(p.entryPrice)}`,
    `${INDENT_BULLET}Mark: ${fmtPriceMaybe(p.markPrice)}`,
    `${INDENT_BULLET}PnL: ${fmtSignedUsd(p.unrealizedPnl)} (${fmtSignedPct(p.unrealizedPnlPct)})`,
    `${INDENT_BULLET}Liq: ${fmtPriceMaybe(p.liquidationPrice)}`,
    `${INDENT_BULLET}Margin: $${fmtUsd2(p.margin)}`,
  ].join("\n");
  return `${header}\n${body}`;
}

function renderWallet(walletLabel: string | null, positions: Position[]): string {
  const lines: string[] = [];
  const header = walletLabel
    ? `**Positions (${positions.length})** · ${walletLabel}`
    : `**Positions (${positions.length})**`;
  lines.push(header);
  if (positions.length === 0) {
    lines.push("");
    lines.push("No open positions.");
    return lines.join("\n");
  }
  const { rows, truncatedFooter } = truncateRows(positions);
  for (const p of rows) {
    lines.push("");
    lines.push(renderPosition(p));
  }
  if (truncatedFooter) {
    lines.push("");
    lines.push(truncatedFooter);
  }
  return lines.join("\n");
}

function renderError(walletLabel: string | null, reason: unknown): string {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const header = walletLabel ? `**Positions** · ${walletLabel}` : "**Positions**";
  return `${header}\n\n(failed: ${msg})`;
}

export const positionsHandler: CommandHandler = async ({ tradingClient, walletStore }, args) => {
  if (args.length > 1) {
    return "Usage: `/positions` or `/positions <symbol>` — e.g. `/positions BTC`";
  }
  const filterSymbol = args[0]?.toUpperCase() ?? null;

  const wallets = walletStore.listWallets();
  if (wallets.length === 0) {
    return "No wallet connected. Use the agent to connect one.";
  }

  const messages: string[] = [];
  const single = wallets.length === 1;
  for (const w of wallets) {
    const label = single ? null : truncateAddress(w.address);
    const res = await tradingClient.getPositions(w.address)
      .then(positions => ({ ok: true as const, positions }))
      .catch(err => ({ ok: false as const, err }));
    if (!res.ok) {
      messages.push(renderError(label, res.err));
      continue;
    }
    const positions = filterSymbol
      ? res.positions.filter(p => p.symbol === filterSymbol)
      : res.positions;
    messages.push(renderWallet(label, positions));
  }

  return single ? messages[0]! : messages;
};
