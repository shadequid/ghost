/**
 * /price <SYM> — `<SYMBOL> Price` header + indented `‐ Label: value` rows
 * for Price, Volume, Open Interest, Funding (and Oracle when it diverges
 * from mark). Same layout convention as /portfolio + /positions.
 *
 * The leading `‐` is U+2010 (not ASCII `-`) so the formatter pipeline's
 * bullet rewriter can't turn it into `•`. Visually identical on every
 * Telegram client.
 *
 * The Price row carries the direction emoji (🟢/🔴/⚪) on the 24h
 * percentage — the only up/down signal in /price, since traders scan
 * direction first and details second.
 *
 * Oracle row appears only when it diverges from mark by
 * > ORACLE_SPREAD_THRESHOLD; otherwise it's noise.
 *
 * Funding rate from Hyperliquid is per-hour. We render it as basis points
 * per hour (rate * 1e4) — `bps/h` is what traders read fast.
 *
 * Usage error (missing/extra arg) returns a short hint instead of throwing.
 */

import type { CommandHandler } from "./types.js";
import { dirEmoji, fmtSignedPct } from "./types.js";

/** Indent + hyphen + space prefix for each row. The hyphen is U+2010 to
 *  bypass the formatter's `^[ \t]*[-*]` bullet rewriter — same convention
 *  as /portfolio + /positions. */
const INDENT_BULLET = "   ‐ ";

/** Compact USD formatter for large totals (volume, OI). Caller's
 *  responsibility to pass non-negative values — Volume24h and openInterest
 *  are always >= 0 from Hyperliquid. */
function compactUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

/** Spotlight price: comma-thousands, 2 decimals, leading `$`. */
function fmtSpotlight(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtBlockNumber(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Hyperliquid funding rate is hourly. bps/h = rate * 1e4. */
function fmtFundingBpsPerHour(rate: number): string {
  const bps = rate * 10000;
  const sign = bps > 0 ? "+" : "";
  return `${sign}${bps.toFixed(2)} bps/h`;
}

/** Mark/oracle spread above this fraction is the only case worth showing
 *  oracle separately — below it the two prints are visually identical. */
const ORACLE_SPREAD_THRESHOLD = 0.0005; // 0.05%

export const priceHandler: CommandHandler = async ({ tradingClient }, args) => {
  if (args.length !== 1) {
    return "Usage: `/price <symbol>` — e.g. `/price BTC`";
  }
  const symbol = args[0]!.toUpperCase();

  let t: Awaited<ReturnType<typeof tradingClient.getTicker>>;
  try {
    t = await tradingClient.getTicker(symbol);
  } catch (err) {
    // Friendly path for the dominant /price error: typo / unsupported
    // symbol. The live client throws `Unknown asset: <symbol>` — match
    // that and any "not found" phrasing that names the symbol. Looser
    // patterns (bare "invalid"/"unknown") match transient 4xx wrappers
    // like `Hyperliquid info: 400 invalid request`, which we propagate so
    // the user doesn't blame their symbol for a network outage.
    const msg = err instanceof Error ? err.message : String(err);
    const symRe = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    const looksLikeNotFound =
      /^Unknown asset:/i.test(msg) ||
      (/not found|no such symbol/i.test(msg) && symRe.test(msg));
    if (looksLikeNotFound) {
      return `Symbol \`${symbol}\` not found on Hyperliquid.`;
    }
    throw err;
  }

  const lines: string[] = [`**${t.symbol} Price**`];
  lines.push(
    `${INDENT_BULLET}Price: ${fmtSpotlight(t.markPrice)} ${dirEmoji(t.priceChangePct24h)} ${fmtSignedPct(t.priceChangePct24h)} (24h)`,
  );
  const showOracle = Math.abs(t.markPrice - t.oraclePrice) / t.markPrice > ORACLE_SPREAD_THRESHOLD;
  if (showOracle) lines.push(`${INDENT_BULLET}Oracle: ${fmtBlockNumber(t.oraclePrice)}`);
  lines.push(`${INDENT_BULLET}Volume 24h: ${compactUsd(t.volume24h)}`);
  lines.push(`${INDENT_BULLET}Open Interest: ${compactUsd(t.openInterest)}`);
  lines.push(`${INDENT_BULLET}Funding: ${fmtFundingBpsPerHour(t.fundingRate)}`);

  return lines.join("\n");
};
