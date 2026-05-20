export type ActionCardStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'executing'
  | 'executed'
  | 'failed';

export interface ActionCardSingleStep {
  mode: 'single';
  approvalId: string;
  title: string;
  helper?: string;
  /**
   * Per-action labels for multi-tool batched confirms (e.g. "Sửa TP" =
   * cancel old TP + set new TP). When present, rendered as a numbered
   * list between title and the Confirm/Cancel buttons so the user can
   * see exactly which actions the single approval covers. Empty / unset
   * for single-tool confirms — the title already names the one action.
   */
  actions?: string[];
  /**
   * When set, the user's free-text reply should be interpreted as an
   * override value (passed to the agent), not as "discuss more".
   */
  suggestedValue?: string;
}

export type ActionCardData = ActionCardSingleStep;
