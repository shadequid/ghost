import type { WizardOpenPosition } from '@/lib/wizard-card-types';
import type { ActionCardStatus } from '@/lib/action-card-types';

function fmtPrice(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  let digits: number;
  if (abs === 0) digits = 0;
  else if (abs < 0.01) digits = 6;
  else if (abs < 1) digits = 4;
  else if (abs < 100) digits = 2;
  else digits = 0;
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: digits })}`;
}

interface Props {
  data: WizardOpenPosition;
  status?: ActionCardStatus;
}

interface StatusBadgeMeta {
  pill: string;
  label: string;
  titleTone?: string;
}

const STATUS_BADGE: Partial<Record<ActionCardStatus, StatusBadgeMeta>> = {
  executed: {
    pill: 'bg-[var(--color-success-subtle)] text-[var(--color-success-text)]',
    label: 'Executed',
    titleTone: 'text-[var(--color-success-text)]',
  },
  rejected: {
    pill: 'bg-[var(--color-surface-base)] text-text-tertiary',
    label: 'Cancelled',
    titleTone: 'text-text-tertiary',
  },
  expired: {
    pill: 'bg-[var(--color-surface-base)] text-text-tertiary',
    label: 'Cancelled',
    titleTone: 'text-text-tertiary',
  },
  failed: {
    pill: 'bg-[var(--color-error-subtle)] text-[var(--color-error-text)]',
    label: 'Failed',
    titleTone: 'text-[var(--color-error-text)]',
  },
};

export function WizardCardOpenPosition({ data, status }: Props) {
  const directionLabel = data.side === 'long' ? 'LONG' : 'SHORT';
  const badge = status ? STATUS_BADGE[status] : undefined;
  const showEntry = data.orderType === 'limit' && data.entryPrice !== undefined;

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className={`text-body-lg-semibold ${badge?.titleTone ?? 'text-text-primary'}`}>
          Open {data.symbol} {directionLabel} {data.leverage}x
        </div>
        {badge && (
          <span
            aria-label={badge.label}
            className={`inline-flex h-6 items-center justify-center rounded-full px-2.5 text-body-sm font-medium ${badge.pill}`}
          >
            {badge.label}
          </span>
        )}
      </div>

      <div className="flex justify-between text-body-lg">
        <span>Size: {data.size} {data.symbol}</span>
        <span className="capitalize">{data.orderType}</span>
      </div>

      {showEntry && (
        <div className="border-y border-dashed border-[var(--color-border-strong)] py-2 flex justify-between">
          <span className="text-body-sm text-text-tertiary">Entry Price</span>
          <span className="text-body-lg">{fmtPrice(data.entryPrice)}</span>
        </div>
      )}

      {data.stopLoss !== undefined && (
        <div className="flex items-center justify-between bg-[var(--color-surface-base)] border-l border-[var(--color-error-default)] rounded-[3px] px-3 h-[35px] text-body-md">
          <span className="text-text-secondary">Stop loss</span>
          <span className="text-text-primary">{fmtPrice(data.stopLoss)}</span>
        </div>
      )}

      {data.takeProfit !== undefined && (
        <div className="flex items-center justify-between bg-[var(--color-surface-base)] border-l border-[var(--color-success-default)] rounded-[3px] px-3 h-[35px] text-body-md">
          <span className="text-text-secondary">Take profit</span>
          <span className="text-text-primary">{fmtPrice(data.takeProfit)}</span>
        </div>
      )}
    </>
  );
}
