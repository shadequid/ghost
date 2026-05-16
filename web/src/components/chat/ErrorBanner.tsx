import { useState } from 'react';
import { friendlyError } from '@/lib/error-messages';

interface ErrorBannerProps {
  raw: string;
  onDismiss?: () => void;
  onRetry?: () => void;
}

export function ErrorBanner({ raw, onDismiss, onRetry }: ErrorBannerProps) {
  const [showDetail, setShowDetail] = useState(false);
  const { message, detail } = friendlyError(raw);

  return (
    <>
      <div
        role="alert"
        aria-live="assertive"
        className={
          'px-4 py-2 bg-[rgba(255,71,87,0.06)] border-b border-[rgba(255,71,87,0.3)] ' +
          'flex items-center gap-2 text-body-sm text-[var(--color-error-text)]'
        }
        style={{ animation: 'error-banner-slide-in 260ms var(--ease-out, ease-out) both' }}
      >
        <span className="flex-1">⚠ {message}</span>
        <button
          onClick={() => setShowDetail(p => !p)}
          className={
            'bg-transparent border-none text-[var(--color-text-secondary)] text-footnote cursor-pointer ' +
            'px-1'
          }
          aria-expanded={showDetail}
        >
          {showDetail ? '▾ Hide' : '▸ Details'}
        </button>
        {onRetry && (
          <button
            onClick={onRetry}
            className={
              'flex items-center gap-1 px-2 py-1 ' +
              'bg-[rgba(255,71,87,0.08)] border border-[rgba(255,71,87,0.3)] rounded-[4px] ' +
              'text-[var(--color-error-text)] text-footnote cursor-pointer ' +
              'transition-colors duration-fast ease-out ' +
              'hover:bg-[rgba(255,71,87,0.15)] focus-visible:bg-[rgba(255,71,87,0.15)]'
            }
          >↻ Retry</button>
        )}
        {onDismiss && (
          <button
            onClick={() => { onDismiss(); setShowDetail(false); }}
            className="bg-transparent border-none text-[var(--color-error-text)] cursor-pointer p-1.5"
            aria-label="Dismiss error"
          >✕</button>
        )}
      </div>
      {showDetail && (
        <div
          className={
            'text-footnote text-[var(--color-text-secondary)] ' +
            'px-4 pt-1 pb-2 bg-[rgba(255,71,87,0.06)]'
          }
        >
          {detail}
        </div>
      )}
    </>
  );
}
