export { BaseChannel } from "./base.js";
export { MessageDispatcher, type DispatcherConfig } from "./dispatcher.js";
export { ChannelManager, ChannelAlreadyRegisteredError, ChannelNotFoundError, ChannelStartTimeoutError } from "./manager.js";
export { ChannelId, CHANNEL_IDS } from "./types.js";

// Plugin registry — single source of truth for all registered channel plugins.
import { telegramPlugin } from "./telegram/plugin.js";
export const CHANNEL_PLUGINS = [telegramPlugin] as const;

// ---------------------------------------------------------------------------
// Outbound dispatch — resolve active channels and fan out messages.
// ---------------------------------------------------------------------------

import type { PairingStore } from "../pairing/store.js";
import type { EventBus } from "../bus/events.js";
import type { MessageBus } from "../bus/queue.js";
import type { Logger } from "pino";
import type { ChannelManager } from "./manager.js";
import { ClientEvents } from "../events/client-events.js";
import { ChannelId } from "./types.js";

export type OutboundChannel =
  | { kind: "web" }
  | { kind: typeof ChannelId.Telegram; chatId: string };

export interface OutboundChannelsDeps {
  channelManager: ChannelManager;
  pairingStore: PairingStore;
  logger: Logger;
}

export interface DispatchDeps {
  eventBus: EventBus;
  bus: MessageBus;
  /** Source label for `chat.proactive` event payload + Telegram outbound metadata. */
  source: string;
  /**
   * Stable identifier shared between the web `chat.proactive` event and the
   * session-log assistant message. The client dedup machinery keys on this id
   * to avoid double-rendering when a history reload races a live event.
   * Callers should generate once with `crypto.randomUUID()` and pass the same
   * value to both dispatchOutbound and the session.addMessage call.
   */
  id?: string;
  logger: Logger;
}

/** Return the channels that should receive the next outbound message. */
export function getOutboundChannels(deps: OutboundChannelsDeps): OutboundChannel[] {
  const channels: OutboundChannel[] = [{ kind: "web" }];
  if (deps.channelManager.isActive(ChannelId.Telegram)) {
    const chatId = deps.pairingStore.getPrimaryChatId(ChannelId.Telegram);
    if (chatId) {
      channels.push({ kind: ChannelId.Telegram, chatId });
    } else {
      deps.logger.warn(
        "telegram channel active but no primary chatId — skipping telegram (web still delivers)",
      );
    }
  }
  return channels;
}

/**
 * Dispatch `body` to all channels sequentially.
 * Web → eventBus publishes `chat.proactive` (canonical activity log).
 * Telegram → bus.publishOutbound (consumed by telegram channel worker).
 * One channel failing does NOT block the others — error is logged, channel omitted from `delivered`.
 */
export async function dispatchOutbound(
  channels: OutboundChannel[],
  body: string,
  deps: DispatchDeps,
): Promise<{ delivered: OutboundChannel["kind"][] }> {
  const delivered: OutboundChannel["kind"][] = [];
  for (const ch of channels) {
    try {
      if (ch.kind === "web") {
        deps.eventBus.publish(
          ClientEvents.proactive({ id: deps.id, source: deps.source, content: body, ts: Date.now() }),
        );
        delivered.push("web");
      } else {
        deps.bus.publishOutbound({
          channel: ChannelId.Telegram,
          chatId: ch.chatId,
          content: body,
          media: [],
          metadata: { _proactive: true, _source: deps.source },
        });
        delivered.push(ChannelId.Telegram);
      }
    } catch (err) {
      deps.logger.warn({ err, channel: ch.kind }, "channel dispatch failed");
    }
  }
  return { delivered };
}
