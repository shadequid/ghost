import type { ReactNode } from 'react';

/**
 * Compact bordered alert used for auth result (success / error) and
 * inline errors. Right-side `×` clears the message via `onClose`.
 *
 * Shared between XAuthModal and TelegramSetupModal — keep visuals in
 * sync if you tweak one.
 */
export function AlertBox({
  kind, text, onClose,
}: { kind: 'error' | 'success'; text: string; onClose: () => void }) {
  const isError = kind === 'error';
  const iconColor = isError ? 'var(--color-error-default)' : 'var(--color-success-default)';
  const boxCls = isError
    ? 'border-[rgba(239,68,68,0.4)] bg-[var(--color-error-soft)] text-[var(--color-error-text)]'
    : 'border-[rgba(34,197,94,0.4)] bg-[var(--color-success-soft)] text-[var(--color-success-text)]';
  return (
    <div className={`flex items-center gap-2 border rounded-[4px] px-3 py-2 text-caption ${boxCls}`}>
      {isError ? (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
          <path d="M6 1.2 11 10.5H1z" stroke={iconColor} strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M6 5v2.2" stroke={iconColor} strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="6" cy="8.8" r="0.6" fill={iconColor} />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="flex-shrink-0">
          <path d="M2.5 6.2 5 8.6l4.5-5" stroke={iconColor} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <span className="flex-1">{text}</span>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="bg-transparent border-none p-0 ml-1 text-[color:currentColor] opacity-60 text-label-lg leading-none cursor-pointer hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-fast ease-out"
      >×</button>
    </div>
  );
}

/** Section divider with hairlines on each side — e.g. "Followed accounts". */
export function Divider({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-4 mb-3 text-body-sm text-[var(--color-text-secondary)]">
      <div className="flex-1 h-px bg-border" />
      <span>{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
