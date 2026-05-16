import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Dashed border variant, used in sidebar edit mode. */
  dashed?: boolean;
  children: ReactNode;
}

/**
 * Widget card surface — Figma `surface-base` with a hairline border and a
 * soft brand-mint glow. Used by sidebar widgets (AlertsWidget, WatchlistWidget,
 * empty states in WidgetRow, etc).
 */
export function Card({ dashed = false, className = '', children, ...rest }: CardProps) {
  const border = dashed
    ? 'border border-dashed border-[var(--color-border-strong)]'
    : 'border border-[var(--color-border-subtle)]';
  return (
    <div
      className={
        `bg-[var(--color-surface-base)] rounded-[2px] shadow-[0_0_20px_rgba(59,247,191,0.03)] ${border} ${className}`.trim()
      }
      {...rest}
    >
      {children}
    </div>
  );
}
