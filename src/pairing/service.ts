import type { Logger } from "pino";
import { buildPairingReply } from "./pairing-messages.js";
import type { PairingStore, PairingRequestRow } from "./store.js";
import type { EventBus } from "../bus/events.js";
import { PairingEvents } from "../events/pairing-events.js";

export interface IssueChallengeParams {
  channelId: string;
  identity: string;
  /** Channel-native handle (e.g. Telegram @username). Persisted so the
   *  dashboard can render `@name` instead of the raw numeric id after approval. */
  username?: string;
  /** Optional human-readable label: "Your Telegram user id: 123 (@alice)".
   *  When omitted the service builds a generic "Your <channelId> id: <identity>" line. */
  identityLabel?: string;
  sendReply: (text: string) => Promise<void>;
  onReplyError?: (err: unknown) => void;
}

export class PairingService {
  constructor(
    private readonly store: PairingStore,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
  ) {}

  /** Ensure a pending pairing request exists for this sender.
   *  If newly created: calls sendReply with the challenge text + emits pairing.request.created.
   *  Idempotent: repeat calls from the same sender within the TTL window do nothing. */
  async issueChallenge(
    params: IssueChallengeParams,
  ): Promise<{ created: boolean; code?: string }> {
    const { channelId, identity, username, identityLabel, sendReply, onReplyError } = params;
    const idLine = identityLabel ?? `Your ${channelId} id: ${identity}`;

    const result = this.store.upsertRequest({
      channel: channelId,
      senderId: identity,
      username,
    });

    if (result.kind === "existing") return { created: false };

    if (result.kind === "limit_reached") {
      this.logger.warn({ channel: channelId, senderId: identity }, "pairing pending ceiling reached — polite-rejecting request");
      try {
        await sendReply("Too many pending pairing requests right now. Please try again later.");
      } catch (err) {
        onReplyError?.(err);
      }
      return { created: false };
    }

    const text = buildPairingReply({ idLine, code: result.code });
    try {
      await sendReply(text);
    } catch (err) {
      onReplyError?.(err);
    }

    this.eventBus.publish(PairingEvents.created({
      channel: channelId,
      code: result.code,
      senderId: identity,
      username: null,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60 * 60 * 1000,
    }));

    return { created: true, code: result.code };
  }

  /** Owner-side: approve a pending request by code.
   *  Adds identity to allowlist, removes pending request, emits pairing.request.approved. */
  approveRequest(
    channelId: string,
    code: string,
    telegramHandle?: string,
  ): { approved: boolean; identity?: string } {
    const result = this.store.approveRequest(channelId, code);
    if (!result) return { approved: false };

    this.eventBus.publish(PairingEvents.approved({
      channel: channelId,
      code,
      senderId: result.id,
      username: telegramHandle ?? result.entry.username,
    }));

    return { approved: true, identity: result.id };
  }

  /** Remove an identity from the channel allowlist and emit pairing.allowlist.removed.
   *  Returns true if the entry existed and was removed, false if it was not found. */
  revoke(channelId: string, identity: string): boolean {
    const removed = this.store.removeAllowlist(channelId, identity);
    if (removed) {
      this.eventBus.publish(PairingEvents.allowlistRemoved({ channel: channelId, identity }));
    }
    return removed;
  }

  /** Pending pairing requests for a channel. */
  listRequests(channelId: string): PairingRequestRow[] {
    return this.store.listRequests(channelId);
  }

  /** Current allowed identities for a channel. */
  listAllowlist(channelId: string): string[] {
    return this.store.listAllowlistIdentities(channelId);
  }
}
