/**
 * Slash-command dispatcher for the Telegram channel.
 *
 * Maps /portfolio, /positions, /news, /price, /alerts to handlers that bypass
 * the LLM and call services directly.
 */

import { portfolioHandler } from "./portfolio.js";
import { positionsHandler } from "./positions.js";
import { newsHandler } from "./news.js";
import { priceHandler } from "./price.js";
import { alertsHandler } from "./alerts.js";
import type { CommandHandler } from "./types.js";

export type { CommandCtx, CommandHandler } from "./types.js";

export const SLASH_COMMANDS: Record<string, CommandHandler> = {
  "/portfolio": portfolioHandler,
  "/positions": positionsHandler,
  "/news": newsHandler,
  "/price": priceHandler,
  "/alerts": alertsHandler,
};

/**
 * Look up a slash-command handler by the first token of an inbound message.
 * Strips the `@botname` suffix grammY appends in group chats.
 */
export function findCommandHandler(firstToken: string): CommandHandler | null {
  if (!firstToken.startsWith("/")) return null;
  const at = firstToken.indexOf("@");
  const cmd = at >= 0 ? firstToken.slice(0, at) : firstToken;
  return SLASH_COMMANDS[cmd] ?? null;
}
