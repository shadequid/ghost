/** Outbound-side helpers for the Telegram channel — chat-id parsing,
 *  typing indicator, HTML chunked send, and the grammY entities-snapshot
 *  transformer. */

import type { Api, Transformer } from "grammy";
import type { Logger } from "pino";
import type { ChannelFormatter } from "../types.js";

// --- parseChatId ---

/** Parse a Telegram chat id from the string form used across bus/approval state.
 *  Returns `null` for empty, non-numeric, or non-finite inputs so callers can
 *  surface the bad value instead of passing NaN to the Bot API. */
export function parseChatId(v: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// --- typing indicator ---

const TYPING_INTERVAL_MS = 4000;

/**
 * Per-channel typing indicator manager. Owns a Map of active intervals keyed
 * by chatId. `start` is idempotent (stops existing interval before starting).
 * `stopAll` is for clean shutdown.
 */
export class TypingManager {
  private readonly intervals = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private readonly api: Api, private readonly log: Logger) {}

  start(chatId: string): void {
    this.stop(chatId);
    const numericChatId = parseChatId(chatId);
    if (numericChatId === null) {
      this.log.warn({ chatId }, "startTyping called with invalid chatId — skipping");
      return;
    }
    const send = () => this.api.sendChatAction(numericChatId, "typing").catch(() => {});
    void send();
    this.intervals.set(chatId, setInterval(send, TYPING_INTERVAL_MS));
  }

  stop(chatId: string): void {
    const interval = this.intervals.get(chatId);
    if (interval) { clearInterval(interval); this.intervals.delete(chatId); }
  }

  stopAll(): void {
    for (const [, interval] of this.intervals) clearInterval(interval);
    this.intervals.clear();
  }
}

// --- HTML send helpers ---

export const MAX_MESSAGE_LEN = 4096;

export function safeFormat(formatter: ChannelFormatter, text: string, log?: Logger): string {
  try { return formatter.format(text); }
  catch (err) {
    log?.warn({ err, textSample: text.slice(0, 200) }, "formatter.format threw; returning raw");
    return text;
  }
}

export function chunkMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let breakAt = remaining.lastIndexOf("\n", maxLen);
    if (breakAt <= 0) breakAt = remaining.lastIndexOf(" ", maxLen);
    if (breakAt <= 0) breakAt = maxLen;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }
  return chunks;
}

/**
 * HTML send helpers: format a markdown payload, chunk to Telegram's 4096-char
 * limit, fall back to plain text if HTML parsing fails on any chunk.
 *
 * On HTML parse failure, re-chunk the pre-format source with the same
 * boundaries and resume from the failed chunk to avoid duplicating delivered
 * chunks.
 */
export async function sendFormattedHtml(
  api: Api,
  log: Logger,
  formatter: ChannelFormatter,
  numericChatId: number,
  rawContent: string,
  replyParams?: { message_id: number },
  opts?: { disableWebPreview?: boolean },
): Promise<void> {
  const formatted = safeFormat(formatter, rawContent, log);
  // A payload that formats to empty (e.g. a lone <chart />) must NOT be sent —
  // Telegram rejects empty text and the plain-text fallback would re-send rawContent.
  if (formatted.length === 0) return;
  const linkPreview = opts?.disableWebPreview ? { link_preview_options: { is_disabled: true } } : {};
  const htmlChunks = chunkMessage(formatted, MAX_MESSAGE_LEN);
  let htmlFailed = false;
  let failedAt = 0;
  for (let i = 0; i < htmlChunks.length; i++) {
    const chunk = htmlChunks[i]!;
    try {
      await api.sendMessage(numericChatId, chunk, {
        parse_mode: "HTML",
        reply_parameters: replyParams,
        ...linkPreview,
      });
    } catch (err) {
      log.warn({ err }, "sendMessage HTML failed, falling back to plain");
      htmlFailed = true;
      failedAt = i;
      break;
    }
  }
  if (!htmlFailed) return;
  const plainChunks = chunkMessage(rawContent, MAX_MESSAGE_LEN);
  for (let i = failedAt; i < plainChunks.length; i++) {
    const chunk = plainChunks[i]!;
    try {
      await api.sendMessage(numericChatId, chunk, {
        reply_parameters: replyParams,
        ...linkPreview,
      });
    } catch (err) {
      log.warn({ err }, "plain fallback send failed");
    }
  }
}

// --- snapshotEntities ---

/**
 * grammY transformer that shallow-copies the `entities` array on
 * `sendMessage` payloads before the request is handed down the chain.
 *
 * Why: `@grammyjs/auto-retry` re-serializes the same payload object after
 * `await backoff()`. A shared or mutated entities array would produce stale
 * offsets on replay. Shallow-copying here makes every retry attempt see a
 * stable snapshot regardless of caller-side mutation between attempts.
 *
 * MUST be registered AFTER `autoRetry()` so it ends up OUTER in the
 * transformer chain (grammY composes the most-recently registered as the
 * outermost wrapper):
 *
 *   bot.api.config.use(autoRetry());
 *   bot.api.config.use(snapshotEntities());
 */
const SNAPSHOT_TARGET_METHODS = new Set<string>(["sendMessage"]);

export function snapshotEntities(): Transformer {
  return async (prev, method, payload, signal) => {
    if (SNAPSHOT_TARGET_METHODS.has(method)) {
      const entities = (payload as { entities?: unknown }).entities;
      if (Array.isArray(entities)) {
        payload = { ...payload, entities: [...entities] } as typeof payload;
      }
    }
    return prev(method, payload, signal);
  };
}
