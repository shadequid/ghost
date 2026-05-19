import { Avatar } from '@/components/ui';
import {
  type NewsArticle,
  SOURCE_NAMES,
  MENU_ITEM_CLS,
  timeAgo,
  sourceLogoUrl,
} from './news-utils';

interface NewsRowProps {
  article: NewsArticle;
  menuOpen: boolean;
  isLast: boolean;
  selected?: boolean;
  inDrawer?: boolean;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onOpen: (id: string) => void;
  onToggleMenu: (id: string) => void;
  onDismiss: (id: string) => void;
  onFilterSource: (sourceId: string) => void;
  onCloseMenu: () => void;
}

/** Single news article row — Figma node 305:4037.
 *  Header: avatar + source/time + (optional coin chip) + ⋮ menu.
 *  Body: title (13px) on its own line. Click row to open the detail drawer. */
export function NewsRow({
  article,
  menuOpen,
  isLast,
  selected = false,
  inDrawer = false,
  menuRef,
  onOpen,
  onToggleMenu,
  onDismiss,
  onFilterSource,
  onCloseMenu,
}: NewsRowProps) {
  const sourceName = SOURCE_NAMES[article.sourceId] ?? article.sourceId;

  return (
    <div
      className={
        'relative flex flex-col gap-2 py-3 px-4 cursor-pointer transition-colors duration-fast ease-out '
        + (selected ? 'bg-brand-subtle ' : 'hover:bg-white/[0.02] ')
        + (inDrawer
          ? 'border-t border-l border-border-subtle'
          : (isLast ? '' : 'border-b border-border-subtle'))
      }
      onClick={() => onOpen(article.id)}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar
            url={sourceLogoUrl(article.sourceId)}
            seed={article.sourceId}
            label={sourceName}
            size={24}
          />
          <div className="flex flex-col leading-[1.5] min-w-0">
            <button
              type="button"
              className="bg-transparent border-none p-0 text-left text-number-sm text-text-primary whitespace-nowrap overflow-hidden text-ellipsis cursor-pointer hover:text-brand-default transition-colors duration-fast"
              title={`Filter by ${sourceName}`}
              onClick={(e) => { e.stopPropagation(); onFilterSource(article.sourceId); }}
            >{sourceName}</button>
            <span className="text-footnote text-text-secondary">
              {timeAgo(article.publishedAt)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {article.coins.length > 0 && (
            <div className="flex items-center gap-1">
              {article.coins.slice(0, 3).map((coin) => (
                <span
                  key={coin}
                  className="bg-brand-subtle h-[20px] flex items-center justify-center px-[7px] rounded-[3px] text-label-sm text-brand-default whitespace-nowrap"
                >
                  {coin}
                </span>
              ))}
              {article.coins.length > 3 && (
                <span className="bg-brand-subtle h-[20px] flex items-center justify-center px-[7px] rounded-[3px] text-label-sm text-brand-default opacity-60 whitespace-nowrap">
                  +{article.coins.length - 3}
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            className="bg-transparent border-none cursor-pointer text-text-muted hover:text-text-primary hover:bg-white/[0.05] transition-colors duration-fast inline-flex items-center justify-center w-7 h-7 rounded-[4px] -mr-1"
            title="More"
            aria-label="Article actions"
            onClick={(e) => { e.stopPropagation(); onToggleMenu(article.id); }}
          >
            {/* Vertical 3-dot — inline so it inherits `currentColor` from the
                button's text-* class (Figma node I841:8860;278:1952). */}
            <svg width="3.158" height="12" viewBox="0 0 3.1582 12" fill="currentColor" aria-hidden="true">
              <path d="M1.5791 8.8418C2.45102 8.84187 3.15812 9.54898 3.1582 10.4209C3.1582 11.2929 2.45107 11.9999 1.5791 12C0.707066 12 0 11.2929 0 10.4209C7.84657e-05 9.54894 0.707114 8.8418 1.5791 8.8418ZM1.5791 4.4209C2.45107 4.42097 3.1582 5.12802 3.1582 6C3.1582 6.87198 2.45107 7.57903 1.5791 7.5791C0.707066 7.5791 0 6.87203 0 6C6.57142e-06 5.12798 0.70707 4.4209 1.5791 4.4209ZM1.5791 0C2.45107 7.60165e-05 3.1582 0.70712 3.1582 1.5791C3.15812 2.45101 2.45102 3.15813 1.5791 3.1582C0.707117 3.1582 8.33614e-05 2.45106 0 1.5791C0 0.707073 0.707066 0 1.5791 0Z" />
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <div
          ref={menuRef}
          className="absolute right-3 top-10 z-50 bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[6px] shadow-[0_4px_16px_rgba(0,0,0,0.6)] min-w-[170px] py-1"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={MENU_ITEM_CLS}
            onClick={() => { onDismiss(article.id); onCloseMenu(); }}
          >Dismiss</button>
          <button
            className={MENU_ITEM_CLS}
            onClick={() => {
              window.open(article.url, '_blank', 'noopener,noreferrer');
              onCloseMenu();
            }}
          >Open article ↗</button>
        </div>
      )}

      <div className="text-body-sm text-text-primary">{article.title}</div>
    </div>
  );
}
