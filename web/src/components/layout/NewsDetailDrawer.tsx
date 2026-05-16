import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import newsMicroscope from '@/assets/news-microscope.svg';
import newsFilter from '@/assets/news-filter.svg';
import { NewsRow } from './NewsRow';
import { type NewsArticle } from './news-utils';

export interface NewsDetailDrawerProps {
  open: boolean;
  articles: NewsArticle[];
  selectedId?: string | null;
  onClose: () => void;
  /** Open the article panel for `id`. */
  onOpenPanel: (id: string) => void;
  onDismiss: (id: string) => void;
  onFilterSource: (sourceId: string) => void;
  onOpenFilter: () => void;
}

/** News detail drawer — flat list of NewsRows. The selected article expansion
 *  moved to NewsArticlePanel (story 07-13); the drawer is now a pure list +
 *  source-filter chip. Portal to document.body so it composites above the
 *  app, with a scrim and slide-in animation. */
export function NewsDetailDrawer({
  open,
  articles,
  selectedId,
  onClose,
  onOpenPanel,
  onDismiss,
  onFilterSource,
  onOpenFilter,
}: NewsDetailDrawerProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  return createPortal(
    <>
      <div
        aria-hidden="true"
        data-drawer-scrim
        onClick={onClose}
        className={
          'fixed inset-0 z-[10001] bg-[var(--color-surface-scrim)] ' +
          'transition-opacity duration-base ease-out ' +
          (open ? 'opacity-100' : 'opacity-0 pointer-events-none')
        }
      />
      <aside
        role="dialog"
        aria-label="News articles"
        aria-modal="true"
        data-drawer-panel
        className={
          'fixed top-0 right-0 h-screen w-[408px] z-[10002] ' +
          'bg-[var(--color-surface-raised)] flex flex-col ' +
          'shadow-[-20px_4px_24px_0px_rgba(0,0,0,0.25)] ' +
          'transition-transform duration-base ease-out ' +
          (open ? 'translate-x-0' : 'translate-x-full pointer-events-none')
        }
      >
        <DrawerHeader onOpenFilter={onOpenFilter} onClose={onClose} />
        <div className="flex-1 overflow-y-auto">
          {articles.map((article, idx) => (
            <NewsRow
              key={article.id}
              article={article}
              menuOpen={menuOpenId === article.id}
              isLast={idx === articles.length - 1}
              selected={article.id === selectedId}
              inDrawer={true}
              menuRef={menuRef}
              onOpen={onOpenPanel}
              onToggleMenu={(id) => setMenuOpenId((prev) => prev === id ? null : id)}
              onDismiss={onDismiss}
              onFilterSource={onFilterSource}
              onCloseMenu={() => setMenuOpenId(null)}
            />
          ))}
        </div>
      </aside>
    </>,
    document.body,
  );
}

function DrawerHeader({ onOpenFilter, onClose }: { onOpenFilter: () => void; onClose: () => void }) {
  return (
    <div className="flex h-[58px] items-center justify-between py-1 px-4 shrink-0 bg-surface-raised">
      <div className="flex items-center gap-2">
        <img src={newsMicroscope} alt="" aria-hidden="true" width={22} height={22} className="block" />
        <span className="text-body-md-semibold text-text-primary leading-[1.5]">NEWS</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Manage news sources"
          title="Manage news sources"
          onClick={onOpenFilter}
          className="bg-transparent border-none cursor-pointer text-text-tertiary hover:text-text-primary transition-colors duration-fast ease-out p-0 inline-flex items-center justify-center"
        >
          <img src={newsFilter} alt="" aria-hidden="true" width={15} height={15} className="block" />
        </button>
        <button
          type="button"
          aria-label="Close (Esc)"
          title="Close (Esc)"
          onClick={onClose}
          className="inline-flex items-center justify-center h-[21px] px-[10px] rounded-[2px] border border-[var(--color-border-strong)] bg-transparent text-[11px] leading-none text-text-secondary cursor-pointer transition-colors duration-fast ease-out hover:text-text-primary hover:border-[var(--color-text-tertiary)]"
        >
          ESC
        </button>
      </div>
    </div>
  );
}
