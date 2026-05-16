/**
 * Telegram approval flow: keyboard + callback parser + text-decision matcher
 * + per-channel state machine (ApprovalLifecycle class).
 *
 * In one file because the state machine consumes every other helper here —
 * splitting was over-modularization.
 */

import { InlineKeyboard } from "grammy";
import type { Api } from "grammy";
import type { Logger } from "pino";
import type { ApprovalManager, ApprovalPreview } from "../../gateway/approval.js";
import { parseChatId } from "./helpers.js";
import { ChannelId } from "../types.js";

export function buildApprovalKeyboard(approvalId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Confirm", `approve:${approvalId}`)
    .text("❌ Cancel",  `reject:${approvalId}`);
}

export function parseCallbackData(data: string): { decision: "approved" | "rejected"; approvalId: string } | null {
  const match = /^(approve|reject):([0-9a-f-]{36})$/i.exec(data);
  if (!match) return null;
  return {
    decision: match[1].toLowerCase() === "approve" ? "approved" : "rejected",
    approvalId: match[2],
  };
}

const YES_RE = /^(yes|y|confirm)$/i;
const NO_RE  = /^(no|n|cancel)$/i;

export function matchTextDecision(text: string): "approved" | "rejected" | null {
  const t = text.trim();
  if (YES_RE.test(t)) return "approved";
  if (NO_RE.test(t)) return "rejected";
  return null;
}

export function formatApprovalPreview(preview: ApprovalPreview): string {
  const out: string[] = [];
  out.push(`<b>${escapeHtml(preview.actionLabel)}</b>`);
  out.push("");
  if (preview.steps && preview.steps.length > 0) {
    preview.steps.forEach((s, i) => out.push(`${i + 1}. ${escapeHtml(s)}`));
    if (preview.lines && preview.lines.length > 0) {
      out.push("");
      for (const line of preview.lines) out.push(escapeHtml(line));
    }
  } else {
    const body = previewBody(preview);
    for (const line of body) out.push(escapeHtml(line));
  }
  out.push("");
  out.push("<i>Tap a button or reply <b>yes</b>/<b>no</b>.</i>");
  return out.join("\n");
}

function previewBody(preview: ApprovalPreview): string[] {
  if (preview.lines && preview.lines.length > 0) return preview.lines;
  const fallback: string[] = [];
  if (preview.summary) fallback.push(preview.summary);
  if (preview.details) {
    for (const [k, v] of Object.entries(preview.details)) {
      fallback.push(`${k}: ${String(v)}`);
    }
  }
  if (preview.warnings) {
    for (const w of preview.warnings) fallback.push(`⚠ ${w}`);
  }
  return fallback;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Validate a Telegram callback's permission to resolve an approval.
 * Returns `{ok: true}` on success; `{ok: false, reason}` on reject.
 */
export function validateApprovalCallback(
  origin: { channel: string; chatId: string } | null,
): { ok: true } | { ok: false; reason: string } {
  if (!origin) return { ok: false, reason: "unknown or expired approval" };
  if (origin.channel !== ChannelId.Telegram) {
    return { ok: false, reason: "approval belongs to another channel" };
  }
  return { ok: true };
}

export type CallbackResolution =
  | { kind: "ignore" }
  | { kind: "reject"; reply: string }
  | { kind: "resolve"; approvalId: string; decision: "approved" | "rejected" };

/**
 * Decide what to do with a Telegram approval callback given the raw callback
 * data + a way to fetch the approval's origin. Pure — all side effects
 * (answerCallbackQuery, approvalManager.resolve) stay in the caller.
 */
export function resolveApprovalCallback(
  callbackData: string,
  getOrigin: (id: string) => { channel: string; chatId: string } | null,
): CallbackResolution {
  const parsed = parseCallbackData(callbackData);
  if (!parsed) return { kind: "ignore" };
  const check = validateApprovalCallback(getOrigin(parsed.approvalId));
  if (!check.ok) return { kind: "reject", reply: check.reason };
  return { kind: "resolve", approvalId: parsed.approvalId, decision: parsed.decision };
}

// --- State machine ---

interface PendingEntry { messageId: number; chatId: string }

export interface ApprovalRequestedPayload {
  approvalId: string;
  preview: ApprovalPreview;
  origin: { channel: string; chatId: string } | null;
}

export interface ApprovalResolvedPayload {
  approvalId: string;
  decision: "approved" | "rejected" | "expired";
}

/**
 * Approval state machine for Telegram. Owns the `pending` map keyed by
 * approvalId. Each entry has the chatId and the messageId of the sent
 * confirmation message (messageId = -1 reserves the slot before the async
 * send completes so a concurrent `onResolved` can find and delete it).
 *
 * Authorization is NOT this class's concern — callers check `isAllowed` at
 * the handler level and call into `resolveByText` only when authorized.
 */
export class ApprovalLifecycle {
  // messageId = -1 indicates the slot was reserved before sendMessage
  // completed (reserve first so a concurrent resolved event finds + cleans it).
  private readonly pending = new Map<string, PendingEntry>();

  constructor(
    private readonly api: Api,
    private readonly log: Logger,
    private readonly approvalManager: ApprovalManager,
    private readonly channelName: string,
  ) {}

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  clear(): void {
    this.pending.clear();
  }

  async onRequested(p: ApprovalRequestedPayload): Promise<void> {
    if (p.origin && p.origin.channel !== this.channelName) {
      this.log.debug({ approvalId: p.approvalId, originChannel: p.origin.channel }, "approval origin not telegram — ignored");
      return;
    }
    if (!p.origin) {
      this.log.warn({ approvalId: p.approvalId }, "broadcast approval without origin — skipping");
      return;
    }
    const chatId = p.origin.chatId;
    const numericChatId = parseChatId(chatId);
    if (numericChatId === null) {
      this.log.warn({ approvalId: p.approvalId, chatId }, "approval origin has invalid chatId — skipping");
      return;
    }
    const text = formatApprovalPreview(p.preview);
    const keyboard = buildApprovalKeyboard(p.approvalId);
    // Reserve the slot BEFORE the async send so a concurrent onResolved
    // can find and clean it up. messageId=-1 until the send returns.
    this.pending.set(p.approvalId, { messageId: -1, chatId });
    try {
      const sent = await this.api.sendMessage(numericChatId, text, {
        parse_mode: "HTML", reply_markup: keyboard,
      });
      const entry = this.pending.get(p.approvalId);
      // If entry is gone, onResolved deleted it mid-await — don't re-insert.
      if (entry) entry.messageId = sent.message_id;
    } catch (err) {
      this.pending.delete(p.approvalId);
      this.log.warn({ err, approvalId: p.approvalId }, "failed to post approval");
    }
  }

  async onResolved(p: ApprovalResolvedPayload): Promise<void> {
    const entry = this.pending.get(p.approvalId);
    if (!entry) return;
    this.pending.delete(p.approvalId);
    if (entry.messageId < 0) return;
    const numericChatId = parseChatId(entry.chatId);
    if (numericChatId === null) {
      this.log.warn({ approvalId: p.approvalId, chatId: entry.chatId }, "approval entry has invalid chatId — skipping teardown");
      return;
    }
    const suffix = p.decision === "approved" ? "✅ Confirmed"
                 : p.decision === "rejected" ? "❌ Cancelled"
                 : "⏱️ Expired — no action taken";
    try {
      await this.api.editMessageReplyMarkup(numericChatId, entry.messageId, { reply_markup: undefined });
    } catch (err) {
      this.log.debug({ err, approvalId: p.approvalId }, "editMessageReplyMarkup failed");
    }
    try {
      await this.api.sendMessage(numericChatId, suffix, {
        reply_parameters: { message_id: entry.messageId },
      });
    } catch (err) {
      this.log.debug({ err, approvalId: p.approvalId }, "approval suffix send failed");
    }
  }

  /**
   * Try to resolve an active approval via a text reply from the same chat.
   * Returns `true` if a pending approval matched (caller should NOT process
   * the message further). Returns `false` if no match (caller proceeds to
   * normal message handling).
   *
   * Caller MUST check authorization before invoking — this class trusts that
   * the sender is allowed to act on pending approvals.
   */
  resolveByText(chatId: string, text: string): boolean {
    for (const [approvalId, entry] of this.pending) {
      if (entry.chatId !== chatId) continue;
      // messageId === -1: reserved-but-not-yet-sent — skip to avoid
      // eating a decision meant for a newer fully-sent approval.
      if (entry.messageId < 0) continue;
      const decision = matchTextDecision(text);
      if (decision) {
        this.approvalManager.resolve(approvalId, decision);
        return true;
      }
      // Free-text reply while confirm pending → soft rejection with reason.
      this.approvalManager.resolve(approvalId, "rejected", text);
      return true;
    }
    return false;
  }
}
