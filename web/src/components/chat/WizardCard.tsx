import { memo } from 'react';
import type { WizardCardData } from '@/lib/wizard-card-types';
import type { ActionCardStatus } from '@/lib/action-card-types';
import { WizardCardOpenPosition } from './WizardCard.OpenPosition';
import { WizardCardGeneric } from './WizardCard.Generic';

interface WizardCardProps {
  data: WizardCardData;
  /**
   * Lifecycle of the paired ActionCard. Drives:
   *  - top-stripe color (warning pending → success executed → error failed
   *    → muted cancelled/expired)
   *  - title tone + status badge inside the open-position variant
   * Defaults to 'pending' so existing replay paths render unchanged.
   */
  status?: ActionCardStatus;
}

const BORDER_BY_STATUS: Record<ActionCardStatus, string> = {
  pending: 'border-[var(--color-warning-default)]',
  approved: 'border-[var(--color-warning-default)]',
  executing: 'border-[var(--color-warning-default)]',
  executed: 'border-[var(--color-success-default)]',
  failed: 'border-[var(--color-error-default)]',
  rejected: 'border-[var(--color-border-strong)]',
  expired: 'border-[var(--color-border-strong)]',
};

const CARD_CLASS =
  'bg-surface-raised border-t rounded-[var(--radius-fig-sm)] ' +
  'p-5 text-body-md text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.45)] ' +
  // Read-only data card — constrain narrower than the chat column so trade
  // details read as a compact summary, not a wall of horizontal space.
  // Wrapped element (MessageBubble) uses `items-start`, so the card aligns
  // to the column's left edge automatically. Top-stripe color tracks the
  // paired ActionCard's status — see BORDER_BY_STATUS.
  'relative w-full max-w-[420px] flex flex-col gap-[11px]';

export const WizardCard = memo(function WizardCard({ data, status }: WizardCardProps) {
  const effectiveStatus: ActionCardStatus = status ?? 'pending';
  return (
    <div
      className={`${CARD_CLASS} ${BORDER_BY_STATUS[effectiveStatus]}`}
      role="region"
      aria-label="Order details"
    >
      {data.kind === 'open_position' ? (
        <WizardCardOpenPosition data={data} status={effectiveStatus} />
      ) : (
        <WizardCardGeneric data={data} />
      )}
    </div>
  );
});
