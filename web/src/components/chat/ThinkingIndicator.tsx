import { formatLabel } from './thinking-utils.js';
import type { ThinkingPhase } from './thinking-utils.js';

interface ThinkingIndicatorProps {
  phase: ThinkingPhase;
  detail?: string;
}

export function ThinkingIndicator({ phase, detail }: ThinkingIndicatorProps) {
  return (
    <span
      className={
        'inline-flex items-center gap-2 whitespace-nowrap ' +
        'text-body-sm text-[var(--color-text-secondary)] transition-opacity duration-base ease-out'
      }
    >
      {/* data-pulse-dots is the hook for the reduced-motion CSS rule in
          index.css — freezes the dots while keeping them visible. */}
      <span data-pulse-dots className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-[var(--color-brand-default)]"
            style={{ animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </span>
      <span className="transition-opacity duration-base ease-out">{formatLabel(phase, detail)}</span>
    </span>
  );
}
