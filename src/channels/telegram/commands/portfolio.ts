/**
 * /portfolio — overview-only account snapshot per wallet.
 *
 * Per-wallet message:
 *   **Portfolio** | <wallet label>
 *      ‐ Equity: $X
 *      ‐ Free margin: $X
 *      ‐ Used margin: $X
 *
 *   **Positions (N)**
 *      ‐ <symbol> <Long|Short>  <PnL$> (<PnL%>)
 *
 * Layout: bold section header, then indented `‐` rows. The leading hyphen
 * is U+2010 (not ASCII `-`) so the formatter pipeline's bullet converter
 * doesn't rewrite it to `•` — visually identical, semantically inert.
 *
 * Open orders and per-position detail (entry/leverage/liq/margin/TP/SL)
 * are intentionally dropped — overview is "scan in 2-3s". Drill-downs go
 * through `/positions <SYM>`.
 *
 * Multi-wallet → one message per wallet (handler returns string[]) so each
 * wallet stays under Telegram's 4096-char limit and is forwardable on its own.
 */

import type { Balance, Position } from "../../../services/interfaces/trading-types.js";
import type { CommandHandler } from "./types.js";
import { fmtSignedPct, truncateAddress, truncateRows } from "./types.js";

/** Indent + hyphen + space prefix for each row. The hyphen is U+2010 to
 *  bypass the formatter's `^[ \t]*[-*]` bullet rewriter (which would
 *  otherwise turn ASCII `-` into `•`). Visually identical to a regular
 *  hyphen on every Telegram client. */
const INDENT_BULLET = "   ‐ ";

function fmtUsd2(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtSignedUsd(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${fmtUsd2(Math.abs(n))}`;
}

function fmtSide(side: "long" | "short"): string {
  return side === "long" ? "Long" : "Short";
}

function renderPositionsList(positions: Position[]): string {
  return positions
    .map((p) =>
      `${INDENT_BULLET}${p.symbol} ${fmtSide(p.side)}  ${fmtSignedUsd(p.unrealizedPnl)} (${fmtSignedPct(p.unrealizedPnlPct)})`,
    )
    .join("\n");
}

function renderWallet(
  walletLabel: string,
  bal: Balance,
  positions: Position[],
): string {
  const lines: string[] = [];
  lines.push(`**Portfolio** | ${walletLabel}`);
  lines.push(`${INDENT_BULLET}Equity: $${fmtUsd2(bal.totalEquity)}`);
  lines.push(`${INDENT_BULLET}Free margin: $${fmtUsd2(bal.availableBalance)}`);
  lines.push(`${INDENT_BULLET}Used margin: $${fmtUsd2(bal.usedMargin)}`);

  if (positions.length > 0) {
    const { rows, truncatedFooter } = truncateRows(positions);
    lines.push("");
    lines.push(`**Positions (${positions.length})**`);
    lines.push(renderPositionsList(rows));
    if (truncatedFooter) lines.push(truncatedFooter);
  }

  return lines.join("\n");
}

function renderError(walletLabel: string, reason: unknown): string {
  const msg = reason instanceof Error ? reason.message : String(reason);
  return `**Portfolio** | ${walletLabel}\n\n(failed: ${msg})`;
}

export const portfolioHandler: CommandHandler = async ({ tradingClient, walletStore }) => {
  const wallets = walletStore.listWallets();
  if (wallets.length === 0) {
    return "No wallet connected. Use the agent to connect one.";
  }

  const messages: string[] = [];
  for (const w of wallets) {
    // Always show the wallet label — even with one wallet, the address
    // anchors which account the snapshot is for and lets the user verify
    // before acting on it.
    const label = truncateAddress(w.address);
    const [balRes, posRes] = await Promise.allSettled([
      tradingClient.getBalance(w.address),
      tradingClient.getPositions(w.address),
    ]);
    if (balRes.status !== "fulfilled") {
      messages.push(renderError(label, balRes.reason));
      continue;
    }
    const positions = posRes.status === "fulfilled" ? posRes.value : [];
    messages.push(renderWallet(label, balRes.value, positions));
  }

  return wallets.length === 1 ? messages[0]! : messages;
};
