/** Abstract base channel. All channels extend this. */

import type { MessageBus } from "../bus/queue.js";
import type { OutboundMessage } from "../bus/types.js";
import type { Logger } from "pino";
import type { PairingStore } from "../pairing/store.js";

/** Sender identity — either a bare id string, or an {id, username} pair.
 *  Allowlist matches against either the numeric id OR the username. */
export type SenderIdentity = string | { id: string; username?: string };

/** Fields every channel config carries. Subclass-specific schemas extend this
 *  via Zod inference, so e.g. TelegramChannelConfig already includes these. */
export interface BaseChannelConfig {
  enabled?: boolean;
  streaming?: boolean;
}

export abstract class BaseChannel<TConfig extends BaseChannelConfig = BaseChannelConfig> {
  abstract readonly name: string;
  abstract readonly displayName: string;

  protected readonly config: TConfig;
  protected readonly bus: MessageBus;
  protected readonly logger: Logger;
  protected readonly pairingStore: PairingStore;
  protected _running = false;

  constructor(
    config: TConfig,
    bus: MessageBus,
    logger: Logger,
    pairingStore: PairingStore,
  ) {
    this.config = config;
    this.bus = bus;
    this.logger = logger;
    this.pairingStore = pairingStore;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;

  async sendDelta(_chatId: string, _delta: string, _metadata?: Record<string, unknown>): Promise<void> {
    throw new Error(`channel ${this.name} does not support streaming — sendDelta must not be called`);
  }

  get supportsStreaming(): boolean {
    const streaming = this.config.streaming;
    return Boolean(streaming) && Object.getPrototypeOf(this).sendDelta !== BaseChannel.prototype.sendDelta;
  }

  get isRunning(): boolean {
    return this._running;
  }

  /** Allow-list source — PairingStore owns the dynamic allowlist. */
  protected getAllowList(): string[] {
    return this.pairingStore.listAllowlistIdentities(this.name);
  }

  /** Allow-list check. Accepts either a bare id string or an {id, username} pair.
   *  Matching rules (any match wins):
   *   - allowList contains `*` → allowed
   *   - entry equals numeric id
   *   - entry (case-insensitive, with or without leading `@`) equals username
   *  On deny, emits a `debug` log so silent drops are diagnosable. */
  isAllowed(identity: SenderIdentity): boolean {
    const allowList = this.getAllowList();
    const senderId = typeof identity === "string" ? identity : identity.id;
    const senderUsername = typeof identity === "string" ? undefined : identity.username;

    if (allowList.length === 0) {
      // Empty is OK when the caller layers another policy on top (e.g.,
      // Telegram pairing). Callers that want a loud warning should check
      // via their own policy resolution.
      return false;
    }
    if (allowList.includes("*")) return true;
    if (allowList.includes(String(senderId))) return true;

    if (senderUsername) {
      const normalized = senderUsername.toLowerCase();
      for (const entry of allowList) {
        const stripped = entry.startsWith("@") ? entry.slice(1) : entry;
        if (stripped.toLowerCase() === normalized) return true;
      }
    }

    this.logger.debug(
      { channel: this.name, senderId, senderUsername, allowList },
      "channel allowlist denied — message dropped",
    );
    return false;
  }

  async handleMessage(
    identity: SenderIdentity,
    chatId: string,
    content: string,
    media?: string[],
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.isAllowed(identity)) return;

    const senderId = typeof identity === "string" ? identity : identity.id;
    const meta = { ...(metadata ?? {}) };

    this.bus.publishInbound({
      channel: this.name,
      senderId: String(senderId),
      chatId: String(chatId),
      content,
      timestamp: Date.now(),
      media: media ?? [],
      metadata: meta,
    });
  }
}
