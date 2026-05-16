import type { ReactNode } from 'react';
import { Card } from './Card';

interface EmptyStateProps {
  icon?: ReactNode;
  text: string;
  /** Wrap in a Card surface. Default: true. */
  card?: boolean;
  /** Card dashed border (edit-mode hint). */
  dashed?: boolean;
}

/**
 * Standard "no data yet" row used across sidebar widgets. Icon + muted label,
 * optionally wrapped in the widget card surface.
 */
export function EmptyState({ icon, text, card = true, dashed = false }: EmptyStateProps) {
  const inner = (
    <div className="flex items-center gap-2 px-4 py-3">
      {icon}
      <span className="text-caption text-[#3a4a5a]">{text}</span>
    </div>
  );
  if (!card) return inner;
  return <Card dashed={dashed}>{inner}</Card>;
}
