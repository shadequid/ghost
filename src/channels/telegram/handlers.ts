/**
 * grammY handler registration: callback queries, text, and bot commands.
 * Decoupled from `TelegramChannel` via the `HandlerDeps` contract.
 */

import type { Api, Bot, Context } from "grammy";
import type { Logger } from "pino";
import type { ApprovalManager } from "../../gateway/approval.js";
import type { PairingService } from "../../pairing/service.js";
import type { TelegramChannelConfig } from "../../config/schema.js";
import type { ApprovalLifecycle } from "./approval.js";
import type { TypingManager } from "./helpers.js";
import type { CommandServices } from "./commands/types.js";
import type { ChannelFormatter } from "../types.js";
import { resolveApprovalCallback } from "./approval.js";
import { findCommandHandler } from "./commands/index.js";
import { parseChatId, sendFormattedHtml } from "./helpers.js";

export interface HandlerDeps {
  log: Logger;
  config: TelegramChannelConfig;
  api: Api;
  approvals: ApprovalLifecycle;
  typing: TypingManager;
  pairingService: PairingService;
  approvalManager: ApprovalManager;
  formatter: ChannelFormatter;
  commandService: CommandServices;
  isAllowed: (identity: { id: string; username?: string }) => boolean;
  resolveDmAccess: (identity: { id: string; username?: string }) => "allow" | "challenge";
  onUnauthorizedDm: (
    ctx: { reply: (text: string, opts?: Record<string, unknown>) => Promise<unknown> },
    senderId: string,
    senderUsername: string | undefined,
  ) => Promise<void>;
  handleMessage: (
    identity: { id: string; username?: string },
    chatId: string,
    text: string,
    media?: string[],
    metadata?: Record<string, unknown>,
  ) => Promise<void>;
}

export function registerTelegramHandlers(bot: Bot<Context>, deps: HandlerDeps): void {
  registerCallbackQueryHandler(bot, deps);
  registerTextHandler(bot, deps);
  registerBotCommandHandler(bot, deps);
}

function registerCallbackQueryHandler(bot: Bot<Context>, deps: HandlerDeps): void {
  bot.callbackQuery(/^(approve|reject):/, async (ctx) => {
    const fromId = ctx.from?.id;
    const fromUsername = ctx.from?.username;
    if (!fromId || !deps.isAllowed({ id: String(fromId), username: fromUsername })) {
      deps.log.warn({ fromId, fromUsername }, "unauthorized approval callback rejected");
      await ctx.answerCallbackQuery("Not authorized").catch(() => {});
      return;
    }
    const data = ctx.callbackQuery.data ?? "";
    const action = resolveApprovalCallback(data, (id) => deps.approvalManager.getOrigin(id));
    if (action.kind === "ignore") {
      deps.log.warn({ data }, "malformed approval callback ignored");
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    if (action.kind === "reject") {
      await ctx.answerCallbackQuery(action.reply).catch(() => {});
      return;
    }
    const ok = deps.approvalManager.resolve(action.approvalId, action.decision);
    await ctx.answerCallbackQuery(ok ? "Done" : "Already resolved")
      .catch((err) => deps.log.debug({ err }, "answerCallbackQuery failed"));
  });
}

function registerTextHandler(bot: Bot<Context>, deps: HandlerDeps): void {
  bot.on("message:text", async (ctx, next) => {
    const msg = ctx.message;
    // Forward bot commands to the next handler in the Composer chain.
    // An early `return` without `await next()` blocks the slash-command handler.
    if (msg.entities?.some(e => e.type === "bot_command" && e.offset === 0)) {
      await next();
      return;
    }
    if (!msg.from) return;
    const senderId = String(msg.from.id);
    const senderUsername = msg.from.username;
    const chatId = String(msg.chat.id);

    if (
      deps.approvals.hasPending() &&
      deps.isAllowed({ id: senderId, username: senderUsername })
    ) {
      if (deps.approvals.resolveByText(chatId, msg.text)) return;
    }

    if (msg.chat.type !== "private") return;
    const decision = deps.resolveDmAccess({ id: senderId, username: senderUsername });
    if (decision === "challenge") {
      await deps.onUnauthorizedDm(ctx, senderId, senderUsername);
      return;
    }

    const reactEmoji = deps.config.reactEmoji;
    if (reactEmoji) {
      try { await ctx.react(reactEmoji as never); } catch { /* ignore */ }
    }

    deps.typing.start(chatId);
    await deps.handleMessage({ id: senderId, username: senderUsername }, chatId, msg.text, undefined, {
      message_id: String(msg.message_id),
      reply_to: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
    });
  });
}

function registerBotCommandHandler(bot: Bot<Context>, deps: HandlerDeps): void {
  bot.on("message:entities:bot_command", async (ctx) => {
    const tokens = (ctx.message.text ?? "").trim().split(/\s+/);
    const cmd = tokens[0] ?? "";
    const args = tokens.slice(1);
    const senderId = String(ctx.message.from.id);
    const senderUsername = ctx.message.from.username;
    const chatId = String(ctx.message.chat.id);

    if (cmd === "/start" || cmd.startsWith("/start@")) {
      if (ctx.message.chat.type !== "private") return;
      const decision = deps.resolveDmAccess({ id: senderId, username: senderUsername });
      if (decision === "challenge") {
        await deps.onUnauthorizedDm(ctx, senderId, senderUsername);
        return;
      }
      const name = ctx.message.from.first_name ?? "there";
      await ctx.reply(`Hi ${name}! I'm Ghost, your AI trading companion.\n\nSend me a message and I'll respond.`);
      return;
    }

    const handler = findCommandHandler(cmd);
    if (handler) {
      if (!deps.isAllowed({ id: senderId, username: senderUsername })) return;
      const numericChatId = parseChatId(chatId);
      if (numericChatId === null) {
        deps.log.warn({ chatId, cmd }, "slash command on invalid chatId — dropping");
        return;
      }
      deps.typing.start(chatId);
      try {
        const reply = await handler({
          chatId,
          tradingClient: deps.commandService.tradingClient,
          walletStore: deps.commandService.walletStore,
          newsService: deps.commandService.newsService,
          alertRules: deps.commandService.alertRules,
          priceCache: deps.commandService.priceCache,
          log: deps.log,
        }, args);
        const messages = Array.isArray(reply) ? reply : [reply];
        for (const md of messages) {
          await sendFormattedHtml(deps.api, deps.log, deps.formatter, numericChatId, md, undefined, { disableWebPreview: true });
        }
      } catch (err) {
        deps.log.warn({ err, cmd }, "slash command failed");
        const message = err instanceof Error ? err.message : String(err);
        try {
          await deps.api.sendMessage(numericChatId, `${cmd} failed: ${message}`);
        } catch (sendErr) {
          deps.log.debug({ sendErr }, "failed to send slash command error");
        }
      } finally {
        deps.typing.stop(chatId);
      }
      return;
    }

    deps.typing.start(chatId);
    await deps.handleMessage({ id: senderId, username: senderUsername }, chatId, ctx.message.text ?? cmd);
  });
}
