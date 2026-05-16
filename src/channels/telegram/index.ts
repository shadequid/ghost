/** Telegram channel adapter — grammY bot, pairing, slash commands. */

import { Bot, InputFile, type Context } from "grammy";
import type { BotCommand } from "grammy/types";
import { autoRetry } from "@grammyjs/auto-retry";
import { BaseChannel } from "../base.js";
import type { MessageBus } from "../../bus/queue.js";
import type { OutboundMessage } from "../../bus/types.js";
import type { Logger } from "pino";
import { TelegramFormatter } from "./format/index.js";
import { parseChatId, TypingManager, sendFormattedHtml, snapshotEntities } from "./helpers.js";
import { registerTelegramHandlers, type HandlerDeps } from "./handlers.js";
import type { EventBus } from "../../bus/events.js";
import type { ApprovalManager } from "../../gateway/approval.js";
import { ApprovalLifecycle } from "./approval.js";
import type { PairingService } from "../../pairing/service.js";
import type { PairingStore } from "../../pairing/store.js";
import type { CommandServices } from "./commands/types.js";
import type { TelegramChannelConfig } from "../../config/schema.js";
import { ChannelEvents } from "../../events/pairing-events.js";
import { redactToken } from "../../helpers/redact.js";
import { ChannelId } from "../types.js";
import type { ChartRenderer } from "./chart-renderer.js";
import { extractCharts } from "./format/tags.js";

type TelegramCtx = Context;

export type { CommandServices } from "./commands/types.js";

const BOT_COMMANDS: BotCommand[] = [
  { command: "start", description: "Start the bot" },
  { command: "portfolio", description: "Snapshot: equity, PnL, and open positions per wallet" },
  { command: "positions", description: "Open positions in detail — size, entry, liq, margin (optional symbol filter)" },
  { command: "news", description: "Show recent news" },
  { command: "price", description: "Show price + 24h + funding for a symbol (e.g. /price BTC)" },
  { command: "alerts", description: "List fired alerts and active price targets" },
];

export class TelegramChannel extends BaseChannel<TelegramChannelConfig> {
  readonly name = ChannelId.Telegram;
  readonly displayName = "Telegram";

  private readonly bot: Bot<TelegramCtx>;
  private readonly typing: TypingManager;
  private readonly approvals: ApprovalLifecycle;
  private readonly log: Logger;
  private readonly formatter = new TelegramFormatter();
  private readonly chartRenderer: ChartRenderer | undefined;
  private unsubscribeEvents: (() => void) | null = null;
  // Background promise from `bot.start()` — only resolves when long-polling stops.
  // Stored so `stop()` can drain it without blocking start()'s caller.
  private pollingPromise: Promise<void> | null = null;
  private readonly eventBus: EventBus;
  private readonly approvalManager: ApprovalManager;
  private readonly commandService: CommandServices;
  private readonly pairingService: PairingService;
  private readonly token: string;

  constructor(
    config: TelegramChannelConfig,
    token: string,
    bus: MessageBus,
    logger: Logger,
    eventBus: EventBus,
    approvalManager: ApprovalManager,
    pairingStore: PairingStore,
    commandService: CommandServices,
    pairingService: PairingService,
    chartRenderer?: ChartRenderer,
  ) {
    super(config, bus, logger, pairingStore);
    this.log = logger;
    this.eventBus = eventBus;
    this.approvalManager = approvalManager;
    this.pairingService = pairingService;
    this.commandService = commandService;
    this.token = token;
    this.chartRenderer = chartRenderer;

    this.bot = new Bot<TelegramCtx>(token);
    this.typing = new TypingManager(this.bot.api, this.log);
    this.approvals = new ApprovalLifecycle(this.bot.api, this.log, this.approvalManager, this.name);
    this.bot.api.config.use(autoRetry());
    // Snapshot `entities` BEFORE auto-retry caches the payload. Must register
    // after autoRetry so it sits outer in the chain.
    this.bot.api.config.use(snapshotEntities());
  }

  private async onUnauthorizedDm(
    ctx: { reply: (text: string, opts?: Record<string, unknown>) => Promise<unknown> },
    senderId: string,
    senderUsername: string | undefined,
  ): Promise<void> {
    const identityLabel = senderUsername
      ? `Your Telegram user id: ${senderId} (@${senderUsername})`
      : `Your Telegram user id: ${senderId}`;
    await this.pairingService.issueChallenge({
      channelId: ChannelId.Telegram,
      identity: senderId,
      username: senderUsername,
      identityLabel,
      sendReply: async (text) => { await ctx.reply(text); },
      onReplyError: (err) => this.log.warn({ err, senderId }, "pairing challenge reply failed"),
    });
  }

  private resolveDmAccess(identity: { id: string; username?: string }): "allow" | "challenge" {
    return this.isAllowed(identity) ? "allow" : "challenge";
  }

  async start(): Promise<void> {
    this._running = true;

    await this.bot.api.getMe(); // validates token and surfaces grammY errors early

    try {
      await this.bot.api.setMyCommands(BOT_COMMANDS);
    } catch (err) {
      this.log.warn({ err }, "failed to register bot commands");
    }

    this.unsubscribeEvents = this.eventBus.subscribe((e) => {
      if (e.type === "trading.approval.requested") {
        void this.approvals.onRequested(e.payload);
      } else if (e.type === "trading.approval.resolved") {
        void this.approvals.onResolved(e.payload);
      }
    });

    registerTelegramHandlers(this.bot, this.buildHandlerDeps());

    // grammY's `bot.start()` only resolves when polling STOPS — resolve via
    // `onStart` callback and keep the long-poll promise for `stop()` to drain.
    return await new Promise<void>((resolve, reject) => {
      let settled = false;
      this.pollingPromise = this.bot
        .start({
          onStart: () => {
            this.log.info("bot started");
            if (!settled) { settled = true; resolve(); }
          },
        })
        .then(() => undefined)
        .catch((err: unknown) => {
          this._running = false;
          if (!settled) {
            settled = true;
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const raw = err instanceof Error ? err.message : String(err);
          const safeMsg = redactToken(raw, this.token);
          this.log.warn({ msg: safeMsg }, "telegram polling stopped unexpectedly");
          this.eventBus.publish(ChannelEvents.stateChanged({
            channel: ChannelId.Telegram,
            state: "disconnected",
          }));
        });
    });
  }

  private buildHandlerDeps(): HandlerDeps {
    return {
      log: this.log,
      config: this.config,
      api: this.bot.api,
      approvals: this.approvals,
      typing: this.typing,
      pairingService: this.pairingService,
      approvalManager: this.approvalManager,
      formatter: this.formatter,
      commandService: this.commandService,
      isAllowed: (identity) => this.isAllowed(identity),
      resolveDmAccess: (identity) => this.resolveDmAccess(identity),
      onUnauthorizedDm: (ctx, senderId, senderUsername) => this.onUnauthorizedDm(ctx, senderId, senderUsername),
      handleMessage: (identity, chatId, text, media, metadata) => this.handleMessage(identity, chatId, text, media, metadata),
    };
  }

  async stop(): Promise<void> {
    this._running = false;
    if (this.unsubscribeEvents) { this.unsubscribeEvents(); this.unsubscribeEvents = null; }
    this.typing.stopAll();
    this.approvals.clear();
    await this.bot.stop();
    if (this.pollingPromise) {
      await this.pollingPromise.catch(() => { /* already logged in start() */ });
      this.pollingPromise = null;
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    const chatId = msg.chatId;
    this.typing.stop(chatId);

    const numericChatId = parseChatId(chatId);
    if (numericChatId === null) {
      this.log.warn({ chatId }, "outbound message has invalid chatId — dropping");
      return;
    }

    if (!msg.content) return;

    // Extract <chart> specs from RAW content before sending. sendFormattedHtml
    // expects raw markdown — it runs the formatter internally and falls back
    // to plain text on Telegram HTML parse failure. Pre-formatting here (e.g.
    // formatWithCharts) would cause sendFormattedHtml to re-escape `<b>` to
    // `&lt;b&gt;` and `&gt;` to `&amp;gt;`, breaking bold + literal `>` in output.
    const { text: chartStripped, charts } = extractCharts(msg.content);
    const segments = this.formatter.splitIntoSegments(chartStripped);
    const replyParams = msg.replyTo ? { message_id: Number(msg.replyTo) } : undefined;
    for (const segment of segments) {
      await sendFormattedHtml(this.bot.api, this.log, this.formatter, numericChatId, segment.content, replyParams);
    }

    // Send chart screenshots after all prose segments. When chartRenderer is
    // absent or fails, log and skip silently — the prose segments above
    // already carry the trader-facing context, so a missing chart should
    // not spam an extra Telegram message.
    for (const spec of charts) {
      if (!this.chartRenderer) {
        this.log.debug({ spec }, "chart renderer unavailable; skipping screenshot");
        continue;
      }
      try {
        const png = await this.chartRenderer.snapshot(spec);
        const file = new InputFile(png, `${spec.symbol}-${spec.interval}.png`);
        await this.bot.api.sendPhoto(numericChatId, file);
      } catch (err) {
        this.log.warn({ err, spec }, "chart screenshot failed; skipping");
      }
    }
  }

}
