import { randomUUID } from "node:crypto";
import type { ApprovalOrigin } from "../events/approval-events.js";

const RESOLVED_GRACE_MS = 60_000;

/**
 * `expired` is retained on the decision union for stored session JSONL
 * back-compat; production no longer auto-expires pending confirms.
 */
export type ApprovalDecision = "approved" | "rejected" | "expired";

export interface ApprovalPreview {
  action: string;
  actionLabel: string;
  /**
   * Flat list of message lines exactly as the tool composed them. The web
   * card and the Telegram render both display these verbatim — no parsing,
   * no key/value reshuffling. For multi-step confirms `lines` carries the
   * supporting/info bullets only; the numbered actions live on `steps`.
   * Optional in the type because legacy session JSONL written before this
   * field existed may omit it; consumers fall back to `summary` + `details`
   * + `warnings` in that case.
   */
  lines?: string[];
  /**
   * Numbered action steps for multi-tool confirms. When present the renderer
   * emits "1." / "2." prefixes; `lines` then carries supporting bullets only.
   * Single-tool confirms leave `steps` undefined and put everything in `lines`.
   */
  steps?: string[];
  /**
   * Legacy single-line summary used by pre-flat-list session JSONL
   * playback and by renderers' fallback paths when `lines` is undefined.
   * Optional now: tools that legitimately have no bullets (e.g.
   * `cancel_all_orders`, `emergency_close`) leave it unset rather than
   * echoing the title — that would create a bullet duplicating the title
   * via the renderer fallback paths.
   */
  summary?: string;
  details: Record<string, string | number>;
  symbol?: string;
  riskAssessment?: string;
  warnings?: string[];
  direction?: "long" | "short";
  /**
   * Optional structured data view shipped alongside the approval preview.
   * When present, frontend renders the WizardCard (read-only) above the
   * ActionCard.
   */
  wizard?: import("../services/wizard-data.js").WizardCardData;
  /**
   * Hint to the frontend that the user's free-text response should be
   * interpreted as a custom value override (e.g. "Size: $1000?" with
   * suggestedValue "1000" — free text "500" means use 500 instead).
   * When unset, free text is treated as "discuss more" chat.
   */
  suggestedValue?: string;
}

interface PendingApproval {
  approvalId: string;
  sessionKey: string;
  preview: ApprovalPreview;
  origin: ApprovalOrigin | null;
  createdAtMs: number;
  decision?: ApprovalDecision;
  /** Free-text reason captured with a rejection (web option-3 input, telegram free-text reply). */
  reason?: string;
  resolve: (decision: ApprovalDecision) => void;
  promise: Promise<ApprovalDecision>;
}

export class ApprovalManager {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly bySession = new Map<string, string>();
  private seq = 0;

  nextSeq(): number {
    return ++this.seq;
  }

  create(
    sessionKey: string,
    preview: ApprovalPreview,
    origin?: ApprovalOrigin | null,
  ): {
    approvalId: string;
    promise: Promise<ApprovalDecision>;
    createdAtMs: number;
  } {
    // If a previous pending approval exists for this session, mark it
    // expired so its waiter unblocks. This is the only path that ever
    // produces an `expired` decision now that the 5-minute auto-cancel
    // timer is gone.
    const existing = this.bySession.get(sessionKey);
    if (existing) this.expire(existing);

    const approvalId = randomUUID();
    const now = Date.now();
    let resolveFn!: (d: ApprovalDecision) => void;
    const promise = new Promise<ApprovalDecision>((r) => { resolveFn = r; });

    const entry: PendingApproval = {
      approvalId, sessionKey, preview,
      origin: origin ?? null,
      createdAtMs: now,
      resolve: resolveFn, promise,
    };

    this.pending.set(approvalId, entry);
    this.bySession.set(sessionKey, approvalId);
    return { approvalId, promise, createdAtMs: now };
  }

  resolve(approvalId: string, decision: "approved" | "rejected", reason?: string): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry || entry.decision) return false;
    entry.decision = decision;
    if (decision === "rejected" && reason && reason.trim().length > 0) {
      entry.reason = reason.trim();
    }
    entry.resolve(decision);
    this.bySession.delete(entry.sessionKey);
    setTimeout(() => this.pending.delete(approvalId), RESOLVED_GRACE_MS);
    return true;
  }

  /** Returns the reject reason for a resolved approval, if one was supplied. */
  getReason(approvalId: string): string | null {
    return this.pending.get(approvalId)?.reason ?? null;
  }

  getPreview(approvalId: string): ApprovalPreview | undefined {
    return this.pending.get(approvalId)?.preview;
  }

  getPending(sessionKey: string): { approvalId: string; preview: ApprovalPreview; createdAtMs: number } | null {
    const id = this.bySession.get(sessionKey);
    if (!id) return null;
    const entry = this.pending.get(id);
    if (!entry || entry.decision) return null;
    return { approvalId: entry.approvalId, preview: entry.preview, createdAtMs: entry.createdAtMs };
  }

  getDecision(approvalId: string): ApprovalDecision | null {
    return this.pending.get(approvalId)?.decision ?? null;
  }

  getOrigin(approvalId: string): ApprovalOrigin | null {
    return this.pending.get(approvalId)?.origin ?? null;
  }

  awaitDecision(approvalId: string): Promise<ApprovalDecision> | null {
    return this.pending.get(approvalId)?.promise ?? null;
  }

  /**
   * Mark a pending approval expired and unblock its waiter. Called only
   * when a new approval claims the same `sessionKey` (see `create`).
   * No timer-based expiry exists — the trader's confirm waits indefinitely
   * for an explicit decision.
   */
  private expire(approvalId: string): void {
    const entry = this.pending.get(approvalId);
    if (!entry || entry.decision) return;
    entry.decision = "expired";
    entry.resolve("expired");
    this.bySession.delete(entry.sessionKey);
    setTimeout(() => this.pending.delete(approvalId), RESOLVED_GRACE_MS);
  }
}
