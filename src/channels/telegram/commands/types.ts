/**
 * Shared types for Telegram command handlers.
 *
 * Handlers call services directly (NOT through the tool registry) so they can
 * aggregate across all wallets and produce LLM-style markdown that flows
 * through `TelegramFormatter.format`.
 */

import type { Logger } from "pino";
import type { ITradingClient } from "../../../services/interfaces/trading-client.js";
import type { IWalletStore } from "../../../services/interfaces/wallet-store.js";
import type { NewsService } from "../../../services/news.js";
import type { AlertRulesService } from "../../../services/alert-rules.js";
import type { PriceCache } from "../../../services/price-cache.js";

/**
 * Narrow surface each slash-handler depends on. Typed as `Pick<…>` of the
 * concrete service classes so test stubs don't need `as unknown as` casts and
 * future service additions don't accidentally widen the slash-command surface.
 */
export type CommandNewsService = Pick<
  NewsService,
  "getArticles" | "getUnshownArticles" | "markArticlesShown" | "getSourceNames"
>;

export type CommandAlertRulesService = Pick<AlertRulesService, "list" | "remove">;

export type CommandPriceCache = Pick<PriceCache, "get">;

/** Service surface every slash-command handler depends on. Shared by the
 *  channel (constructor injection) and handlers (runtime context). */
export interface CommandServices {
  tradingClient: ITradingClient;
  walletStore: IWalletStore;
  newsService: CommandNewsService;
  alertRules: CommandAlertRulesService;
  priceCache: CommandPriceCache;
}

export interface CommandCtx extends CommandServices {
  /** Telegram chat id of the sender — used by /news as the per-chat key for
   *  pagination state. */
  chatId: string;
  log: Logger;
}

/** Handlers return a markdown/tag string the formatter understands. Returning
 *  `string[]` makes the dispatcher send each entry as a separate Telegram
 *  message — used by /portfolio so multi-wallet output renders one message per
 *  wallet instead of one long combined message that risks the 4096-char limit
 *  and is hard to scroll/forward.
 *
 *  `args` are whitespace-split tokens after the command (e.g. `/price BTC`
 *  passes `["BTC"]`). Required: the dispatcher always passes an array, even
 *  when empty — codifying that contract prevents handler-tests-only crashes
 *  when callers forget to pass `[]`. */
export type CommandHandler = (ctx: CommandCtx, args: readonly string[]) => Promise<string | string[]>;

/** Truncate any table-style row list at 30 rows; append +N footer. */
export const MAX_TABLE_ROWS = 30;

export function truncateRows<T>(rows: T[]): { rows: T[]; truncatedFooter: string | null } {
  if (rows.length <= MAX_TABLE_ROWS) return { rows, truncatedFooter: null };
  const remaining = rows.length - MAX_TABLE_ROWS;
  return {
    rows: rows.slice(0, MAX_TABLE_ROWS),
    truncatedFooter: `… +${remaining} more — ask the agent for the full list`,
  };
}

/** Truncate Hyperliquid addresses for header lines. */
export function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/** Direction emoji for a signed change — green up, red down, white flat.
 *  Used on the directional metrics that traders scan first (24h %, unrealized
 *  PnL spotlight). NOT used per-row in lists — the +/- sign is enough there. */
export function dirEmoji(n: number): string {
  if (n > 0) return "🟢";
  if (n < 0) return "🔴";
  return "⚪";
}

/** Signed percent with a leading `+` for positives so the eye reads the sign
 *  without scanning. */
export function fmtSignedPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Strip markdown emphasis markers (`*`, `_`, `` ` ``) from arbitrary text
 * before interpolating into the formatter pipeline. The formatter rewrites
 * `**X**` → `<b>X</b>`, `*X*` → `<i>X</i>`, etc. — when the source is
 * LLM-generated (e.g. the /news summary), the model may emit incidental
 * markdown that turns into unintended bold/italic. Drop the markers
 * outright; the underscored words remain readable.
 */
export function escapeMarkdownEmphasis(s: string): string {
  return s.replace(/[*_`]/g, "");
}
