/**
 * Trading confirmation service.
 *
 * DaemonConfirmService: broadcasts confirmation card via EventBus, awaits
 * user decision through ApprovalManager promise (web + Telegram channels).
 *
 * The `confirm(title, body)` API takes a structured body that distinguishes
 * supporting bullets from numbered actions:
 *   - Single-tool confirms set `body.lines` and leave `steps` empty.
 *   - Multi-tool confirms set `body.steps` (numbered actions) and may also
 *     set `body.lines` for net-effect / supporting bullets.
 * Renderers (web card, Telegram) display verbatim; the service itself
 * does no parsing or reshaping.
 *
 * Rejections may carry an optional `reason` text (option 3 from web,
 * free-text reply on Telegram). The reason flows back into the agent loop
 * as a synthetic tool result so the LLM can adapt instead of retrying.
 *
 * Auto-cancel: there is none. Confirms wait indefinitely for an explicit
 * user decision. The 5-min timer was dropped per trader feedback
 * (panic-flicker on partial fills); the only remaining `expired` decision
 * comes from a same-session `create()` taking the slot of a stale pending
 * approval (see `ApprovalManager.expire`).
 */

import type { ApprovalManager, ApprovalPreview } from "../gateway/approval.js";
import type { EventBus } from "../bus/events.js";
import type { Orchestrator } from "../agent/orchestrator.js";
import { ApprovalEvents } from "../events/approval-events.js";

export interface ConfirmDecision {
  decision: "approved" | "rejected";
  /** Optional user-supplied free-text reason from the reject card. */
  reason?: string;
}

/**
 * Body of a confirm card.
 * - `lines`: supporting bullets, rendered with `•` markers (web) or
 *   plain bullets (Telegram). Always optional — empty for action-only cards.
 * - `steps`: numbered action steps, rendered with `1.`/`2.` prefixes. When
 *   set, the renderer treats this as a multi-step plan; when undefined the
 *   confirm is a single action and everything goes in `lines`.
 */
export interface ConfirmBody {
  lines?: string[];
  steps?: string[];
}

export interface ConfirmExtras {
  wizard?: import("./wizard-data.js").WizardCardData;
  suggestedValue?: string;
  /** Symbol attached to the approval preview for renderer-side direction
   *  inference and display. */
  symbol?: string;
}

export interface ConfirmService {
  confirm(title: string, body: ConfirmBody, extras?: ConfirmExtras): Promise<ConfirmDecision>;
}

// ---------------------------------------------------------------------------
// Daemon mode (web + Telegram)
// ---------------------------------------------------------------------------

function buildPreview(title: string, body: ConfirmBody, extras?: ConfirmExtras): ApprovalPreview {
  const lines = (body.lines ?? []).filter((l) => l !== undefined && l !== null);
  const steps = (body.steps ?? []).filter((s) => s !== undefined && s !== null);
  // Legacy shape preserved for any consumer that still reads structured fields
  // (e.g. older session JSONL fixtures). New rendering paths read lines/steps.
  const details: Record<string, string> = {};
  const warnings: string[] = [];
  for (const line of lines) {
    if (line.startsWith("⚠")) {
      warnings.push(line.replace(/^⚠\s*/, ""));
      continue;
    }
    for (const part of line.split("|")) {
      const sep = part.indexOf(":");
      if (sep > 0) details[part.slice(0, sep).trim()] = part.slice(sep + 1).trim();
    }
  }
  const blob = [title, ...steps, ...lines].join(" ").toLowerCase();
  // `summary` is the legacy ApprovalPreview field for non-flat-list payloads.
  // Never fall back to `title` — that would echo the title as a duplicate
  // bullet on renderers whose legacy fallback path pushes `summary` (web
  // ConfirmationCard.fallbackLines, telegram previewBody) when `lines` is
  // empty. Tools that legitimately have no bullets ship `lines: []`; the
  // renderers respect an explicit empty list and skip the fallback.
  const summary = steps[0] ?? lines[0];
  // Always emit `lines` (even when empty) so renderers can distinguish
  // "no bullets, intentionally" from "legacy payload with no field at all".
  // Frontend ConfirmationCard's legacy fallback is gated on `lines === undefined`.
  return {
    action: title.toLowerCase().replace(/\s+/g, "_"),
    actionLabel: title,
    lines,
    steps: steps.length > 0 ? steps : undefined,
    summary,
    details,
    warnings: warnings.length > 0 ? warnings : undefined,
    symbol: extras?.symbol,
    direction: blob.includes("buy") || blob.includes("long")
      ? "long"
      : blob.includes("sell") || blob.includes("short")
        ? "short"
        : undefined,
    wizard: extras?.wizard,
    suggestedValue: extras?.suggestedValue,
  };
}

export class DaemonConfirmService implements ConfirmService {
  constructor(
    private readonly approvalManager: ApprovalManager,
    private readonly eventBus: EventBus,
    private readonly orchestrator: Orchestrator,
  ) {}

  async confirm(title: string, body: ConfirmBody, extras?: ConfirmExtras): Promise<ConfirmDecision> {
    const preview = buildPreview(title, body, extras);
    const sessionKey = `trade:${crypto.randomUUID().slice(0, 8)}`;
    const preText = this.orchestrator.getCurrentTurnText();
    const origin = this.orchestrator.getCurrentTurnOrigin();
    if (!origin) {
      throw new Error("trading approval requires a channel origin");
    }

    const { approvalId, promise, createdAtMs } =
      this.approvalManager.create(sessionKey, preview, origin);
    this.eventBus.publish(ApprovalEvents.tradingRequested({
      approvalId, sessionKey, preview, createdAtMs, preText, origin,
    }));

    const decision = await promise;
    this.eventBus.publish(ApprovalEvents.tradingResolved({
      approvalId, decision, ts: Date.now(),
    }));
    if (decision === "approved") return { decision: "approved" };
    const reason = this.approvalManager.getReason(approvalId) ?? undefined;
    return { decision: "rejected", reason };
  }
}
