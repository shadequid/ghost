import type { HTMLAttributes, ReactNode } from 'react';

interface SectionLabelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/**
 * Uppercase, tracked, muted mini header. Used inside sidebar widget bodies
 * (e.g. "Alerts (3)", "Watchlist") — not to be confused with the full
 * `widget-header` row which supports drag + hide actions.
 */
export function SectionLabel({ className = '', children, ...rest }: SectionLabelProps) {
  return (
    <div
      className={
        `text-label-caps uppercase text-[var(--color-text-secondary)] ${className}`.trim()
      }
      {...rest}
    >
      {children}
    </div>
  );
}
