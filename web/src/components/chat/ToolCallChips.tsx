import { memo } from 'react';
import type { ToolCallEntry } from '@/lib/chatTypes';

interface ToolCallChipsProps {
  toolCalls: ToolCallEntry[];
  onSelect: (entry: ToolCallEntry) => void;
}

function statusColor(entry: ToolCallEntry): string {
  if (entry.status === 'running') return 'var(--color-warning-text)';
  return entry.success ? 'var(--color-success-text)' : 'var(--color-error-default)';
}

function stripPrefix(name: string): string {
  return name.replace(/^mcp__ghost__/, '').replace(/^ghost_/, '');
}

export const ToolCallChips = memo(function ToolCallChips({ toolCalls, onSelect }: ToolCallChipsProps) {
  if (toolCalls.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {toolCalls.map((tc) => (
        <button
          key={tc.toolCallId}
          className={
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] ' +
            'text-caption ' +
            'border border-[var(--color-border-default)] bg-[rgba(15,22,33,0.6)] text-[var(--color-text-secondary)] cursor-pointer ' +
            'transition-colors duration-fast ease-out ' +
            'hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-primary)] ' +
            'focus-visible:border-[var(--color-border-strong)] focus-visible:text-[var(--color-text-primary)]'
          }
          title={tc.argsHint}
          onClick={() => onSelect(tc)}
        >
          <span
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: statusColor(tc) }}
          />
          <span>{stripPrefix(tc.name)}</span>
          {tc.durationSecs != null && (
            <span className="text-footnote text-[var(--color-text-secondary)]">{tc.durationSecs}s</span>
          )}
        </button>
      ))}
    </div>
  );
});
