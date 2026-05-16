import { useState, useEffect, useCallback } from 'react';

const TIMEOUT_MS = 5 * 60 * 1000;

type Decision = 'pending' | 'yes' | 'no' | 'expired';

const statusColors: Record<Decision, string> = {
  pending: 'var(--color-warning-text)',
  yes: 'var(--color-success-text)',
  no: 'var(--color-error-text)',
  expired: 'var(--color-text-muted)',
};

const statusIcons: Record<Decision, string> = {
  pending: '\u{1F7E1}',
  yes: '\u2705',
  no: '\u274C',
  expired: '\u23F1',
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, '0')}`;
}

interface InlineConfirmButtonsProps {
  onAction: (text: string) => void;
}

export function InlineConfirmButtons({ onAction }: InlineConfirmButtonsProps) {
  const [decision, setDecision] = useState<Decision>('pending');
  const [createdAt] = useState(Date.now);
  const [remainingMs, setRemainingMs] = useState(TIMEOUT_MS);

  const isPending = decision === 'pending';

  useEffect(() => {
    if (!isPending) return;
    const interval = setInterval(() => {
      const left = Math.max(0, TIMEOUT_MS - (Date.now() - createdAt));
      setRemainingMs(left);
      if (left <= 0) setDecision('expired');
    }, 1000);
    return () => clearInterval(interval);
  }, [isPending, createdAt]);

  useEffect(() => {
    if (!isPending) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); setDecision('yes'); onAction('yes'); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setDecision('no'); onAction('no'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isPending, onAction]);

  const handleYes = useCallback(() => { if (isPending) { setDecision('yes'); onAction('yes'); } }, [isPending, onAction]);
  const handleNo = useCallback(() => { if (isPending) { setDecision('no'); onAction('no'); } }, [isPending, onAction]);

  const color = statusColors[decision];

  return (
    <div className="mt-2.5 pt-2.5 border-t border-[rgba(121,121,121,0.15)] flex flex-col gap-2">
      <div
        className="flex items-center gap-2 text-caption uppercase tracking-[0.5px]"
        style={{ color }}
      >
        <span>{statusIcons[decision]}</span>
        <span>
          {isPending ? 'Awaiting Confirmation' : decision === 'yes' ? 'Approved' : decision === 'no' ? 'Rejected' : 'Expired'}
        </span>
      </div>

      {isPending ? (
        <>
          <div className="flex justify-end gap-2.5">
            <button
              onClick={handleNo}
              className={
                'bg-transparent border border-[var(--color-border-default)] rounded-[4px] px-4 py-1.5 ' +
                'text-[var(--color-text-secondary)] text-body-sm-medium cursor-pointer ' +
                'transition-colors duration-base ease-out ' +
                'hover:bg-[var(--color-error-subtle)] hover:border-[rgba(239,68,68,0.3)] hover:text-[var(--color-error-text)] ' +
                'focus-visible:bg-[var(--color-error-subtle)] focus-visible:border-[rgba(239,68,68,0.3)] focus-visible:text-[var(--color-error-text)]'
              }
            >Reject</button>
            <button
              onClick={handleYes}
              className={
                'bg-[var(--color-success-subtle)] border border-[rgba(34,197,94,0.35)] rounded-[4px] px-4 py-1.5 ' +
                'text-[var(--color-success-text)] text-body-sm-medium cursor-pointer ' +
                'transition-colors duration-base ease-out ' +
                'hover:bg-[var(--color-success-soft)] hover:border-[rgba(34,197,94,0.5)] ' +
                'focus-visible:bg-[var(--color-success-soft)] focus-visible:border-[rgba(34,197,94,0.5)]'
              }
            >{'\u2713'} Approve</button>
          </div>
          <div className="text-footnote text-[var(--color-text-secondary)] text-center">
            {'\u2328'} Enter to approve · Esc to reject · {formatCountdown(remainingMs)} left
          </div>
        </>
      ) : null}
    </div>
  );
}
