import { Avatar } from '@/components/ui';
import newsMenu from '@/assets/news-menu.svg';
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
        + (selected ? 'bg-surface-base ' : 'hover:bg-white/[0.02] ')
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
            className="bg-transparent border-none cursor-pointer text-text-tertiary hover:text-text-primary hover:bg-white/[0.05] transition-colors duration-fast inline-flex items-center justify-center w-7 h-7 rounded-[4px] -mr-1"
            title="More"
            aria-label="Article actions"
            onClick={(e) => { e.stopPropagation(); onToggleMenu(article.id); }}
          >
            <img src={newsMenu} alt="" aria-hidden="true" width={3.158} height={12} className="block" />
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
