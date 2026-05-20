import type { WizardCardData } from './wizard-card-types';

export interface ConfirmationData {
  approvalId: string;
  action: string;
  actionLabel: string;
  /**
   * Supporting bullets exactly as the tool composed them. Renderer shows
   * one row per entry with a `•` marker. For multi-step plans this carries
   * the net-effect / context lines; the numbered actions live on `steps`.
   * Optional so on-disk session JSONL written before the flat-list
   * migration still loads — the card falls back to summary + details +
   * warnings when both `lines` and `steps` are missing.
   */
  lines?: string[];
  /**
   * Numbered action steps for multi-tool confirms. Renderer prefixes each
   * with "1." / "2." Single-action confirms leave this undefined.
   */
  steps?: string[];
  /**
   * Legacy single-line summary. Optional: present on pre-flat-list session
   * JSONL playback and on tools that ship a meaningful summary line; absent
   * on tools whose describer returns `lines: []` (e.g. cancel-all, emergency
   * close) — those rely on the title alone.
   */
  summary?: string;
  details: Record<string, string | number>;
  symbol?: string;
  riskAssessment?: string;
  warnings?: string[];
  direction?: 'long' | 'short';
  /** Structured data view shipped alongside the confirm preview. Frontend
   *  renders the WizardCard (read-only) above the ActionCard when present.
   */
  wizard?: WizardCardData;
  /** Hint that user free-text should be treated as a custom value override
   *  rather than "discuss more" — typically the LLM's proposed default
   *  (e.g. suggested size). */
  suggestedValue?: string;
}

/**
 * `expired` is retained for back-compat with stored sessions and for any
 * future "session aborted / disconnected" signal — production no longer
 * emits it from a timer (the 5-min auto-cancel was dropped per the v2
 * mock signoff). Keep the variant so the card can still render historical
 * confirms cleanly.
 */
export type ConfirmationStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'executing'
  | 'executed'
  | 'failed';
