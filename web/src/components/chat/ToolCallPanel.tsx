import { memo, useEffect, useState } from 'react';
import type { ToolCallEntry } from '@/lib/chatTypes';

interface ToolCallPanelProps {
  entry: ToolCallEntry | null;
  onClose: () => void;
}

const PANEL_WIDTH = 420;
const ANIM_MS = 200;

const PRE_CLASS =
  'm-0 p-2.5 rounded-[4px] bg-[var(--color-surface-canvas)] border border-[var(--color-border-default)] ' +
  'text-caption text-[var(--color-text-primary)] ' +
  'overflow-x-auto whitespace-pre-wrap break-all max-h-[300px] overflow-y-auto';

const STATUS_BADGE_BASE =
  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[4px] text-footnote';

function StatusBadge({ entry }: { entry: ToolCallEntry }) {
  if (entry.status === 'running') {
    return (
      <span className={`${STATUS_BADGE_BASE} bg-[var(--color-warning-soft)] text-[var(--color-warning-text)]`}>
        running
      </span>
    );
  }
  return entry.success ? (
    <span className={`${STATUS_BADGE_BASE} bg-[var(--color-success-soft)] text-[var(--color-success-text)]`}>
      success
    </span>
  ) : (
    <span className={`${STATUS_BADGE_BASE} bg-[rgba(255,71,87,0.15)] text-[var(--color-error-text)]`}>
      error
    </span>
  );
}

function prettyFormat(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

export const ToolCallPanel = memo(function ToolCallPanel({ entry, onClose }: ToolCallPanelProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (entry) {
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [entry]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, ANIM_MS);
  };

  if (!entry) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[900] bg-black/35"
        style={{
          opacity: visible ? 1 : 0,
          transition: `opacity ${ANIM_MS}ms ease`,
        }}
        onClick={handleClose}
      />
      <div
        className={
          'fixed top-0 right-0 bottom-0 max-w-screen z-[901] ' +
          'bg-[#0a0f18] border-l border-[var(--color-border-default)] ' +
          'flex flex-col'
        }
        style={{
          width: PANEL_WIDTH,
          transform: visible ? 'translateX(0)' : `translateX(${PANEL_WIDTH}px)`,
          transition: `transform ${ANIM_MS}ms ease`,
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-default)] flex-shrink-0">
          <span className="text-body-sm-medium text-[var(--color-success-text)] overflow-hidden text-ellipsis whitespace-nowrap">
            {entry.name}
          </span>
          <button
            onClick={handleClose}
            aria-label="Close tool call panel"
            className={
              'bg-transparent border-none p-1.5 rounded-[4px] cursor-pointer ' +
              'flex items-center justify-center ' +
              'text-[var(--color-text-secondary)] transition-colors duration-fast ease-out ' +
              'hover:text-[var(--color-text-primary)] focus-visible:text-[var(--color-text-primary)]'
            }
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Meta */}
          <div className="flex gap-3 text-caption text-[var(--color-text-secondary)]">
            <StatusBadge entry={entry} />
            {entry.durationSecs != null && <span>{entry.durationSecs}s</span>}
            <span className="text-[var(--color-text-secondary)]">{entry.toolCallId.slice(0, 8)}</span>
          </div>

          {/* Args */}
          <div className="flex flex-col gap-1">
            <span className="text-footnote text-[var(--color-text-secondary)] uppercase tracking-[0.05em]">
              Arguments
            </span>
            <pre className={PRE_CLASS}>{prettyFormat(entry.argsFull ?? entry.argsHint ?? '(none)')}</pre>
          </div>

          {/* Result */}
          {entry.result && (
            <div className="flex flex-col gap-1">
              <span className="text-footnote text-[var(--color-text-secondary)] uppercase tracking-[0.05em]">
                Result
              </span>
              <pre className={PRE_CLASS}>{prettyFormat(entry.result)}</pre>
            </div>
          )}
        </div>
      </div>
    </>
  );
});
