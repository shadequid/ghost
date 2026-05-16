import { memo, useEffect } from 'react';
import { TerminalModal } from '@/components/TerminalModal';

interface LinkPreviewModalProps {
  url: string;
  onClose: () => void;
  onConfirm: () => void;
}

export const LinkPreviewModal = memo(function LinkPreviewModal({ url, onClose, onConfirm }: LinkPreviewModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onConfirm]);

  return (
    <TerminalModal open title="External Link" onClose={onClose} width={600}>
      <div
        className={
          'text-body-sm text-[var(--color-brand-default)] break-all ' +
          'bg-[var(--color-surface-canvas)] rounded-[4px] px-3.5 py-2.5 ' +
          'border border-[var(--color-border-subtle)]'
        }
      >
        {url}
      </div>
      <div className="flex justify-end gap-2.5 mt-4">
        <button
          onClick={onClose}
          className={
            'bg-transparent border border-[var(--color-border-default)] rounded-[4px] ' +
            'px-5 py-2 text-[var(--color-text-secondary)] text-body-sm cursor-pointer ' +
            'transition-colors duration-base ease-out ' +
            'hover:bg-white/5 focus-visible:bg-white/5'
          }
        >Cancel</button>
        <button
          onClick={onConfirm}
          className={
            'bg-[var(--color-brand-subtle)] border border-[var(--color-brand-soft)] rounded-[4px] ' +
            'px-5 py-2 text-[var(--color-brand-default)] text-body-sm-medium cursor-pointer ' +
            'transition-colors duration-base ease-out ' +
            'hover:bg-[var(--color-brand-soft)] focus-visible:bg-[var(--color-brand-soft)]'
          }
        >Open in new tab</button>
      </div>
    </TerminalModal>
  );
});
