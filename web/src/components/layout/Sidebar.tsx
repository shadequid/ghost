import { useEffect, useState } from 'react';
import { PortfolioWidget } from './PortfolioWidget';
import { WatchlistWidget, WatchlistEditProvider } from './WatchlistWidget';
import { NewsWidget } from './NewsWidget';
import { TweetsWidget } from './TweetsWidget';
import { usePortfolio } from '@/hooks/usePortfolio';
import { WidgetRow, type WidgetDef } from './WidgetRow';
import { loadWidgetState, subscribeWidgetVisibility } from '@/lib/widget-visibility';

/** Per-position widget allocation (Figma 3-column layout, node 215:1115).
 * Left column hosts wallet + watchlist; right column hosts feeds. */
const LEFT_WIDGET_IDS = new Set(['portfolio', 'watchlist']);
const RIGHT_WIDGET_IDS = new Set(['tweets', 'news']);

const ALL_WIDGETS: WidgetDef[] = [
  { id: 'portfolio', icon: '◈', iconColor: 'var(--color-brand-default)', label: 'Portfolio', component: PortfolioWidget },
  { id: 'watchlist', icon: '◉', iconColor: '#00b8ff', label: 'Watchlist', component: WatchlistWidget },
  { id: 'tweets', icon: '𝕏', iconColor: '#00b8ff', label: 'Tweets', component: TweetsWidget },
  { id: 'news', icon: '✦', iconColor: '#a136ff', label: 'News', component: NewsWidget },
];

export const DEFAULT_ORDER = ALL_WIDGETS.map((w) => w.id);

interface WidgetState { order: string[]; hidden: Set<string> }

/** Reconcile persisted state against DEFAULT_ORDER so new widgets get
 *  inserted at their canonical position when storage is older than code. */
function loadState(): WidgetState {
  const knownIds = new Set(DEFAULT_ORDER);
  const persisted = loadWidgetState();
  if (!persisted) {
    return { order: [...DEFAULT_ORDER], hidden: new Set<string>() };
  }
  const filteredOrder = persisted.order.filter((id) => knownIds.has(id));
  const order = [...filteredOrder];
  for (const id of DEFAULT_ORDER) {
    if (order.includes(id)) continue;
    const defaultIdx = DEFAULT_ORDER.indexOf(id);
    let insertAt = order.length;
    for (let i = defaultIdx + 1; i < DEFAULT_ORDER.length; i++) {
      const neighborIdx = order.indexOf(DEFAULT_ORDER[i]);
      if (neighborIdx >= 0) { insertAt = neighborIdx; break; }
    }
    order.splice(insertAt, 0, id);
  }
  const hidden = new Set<string>();
  for (const id of persisted.hidden) {
    if (knownIds.has(id)) hidden.add(id);
  }
  return { order, hidden };
}

const WALLET_REQUIRED_WIDGETS = new Set<string>();

interface SidebarProps {
  /** Which column this Sidebar instance renders. The 3-column Figma
   * layout splits widgets across two sidebars; pass `'left'` or
   * `'right'` to filter the widget set. Defaults to `'left'`. */
  position?: 'left' | 'right';
}

export default function Sidebar({ position = 'left' }: SidebarProps) {
  const { status: walletStatus } = usePortfolio();
  const hasWallet = walletStatus !== 'no-wallet' && walletStatus !== 'idle';
  const [state, setState] = useState(loadState);

  // Re-load whenever another part of the UI (e.g. SystemMenuDropdown's
  // "Show X" toggle) flips a widget's hidden flag.
  useEffect(() => subscribeWidgetVisibility(() => setState(loadState())), []);

  const positionFilter = position === 'left' ? LEFT_WIDGET_IDS : RIGHT_WIDGET_IDS;
  const availableWidgets = ALL_WIDGETS.filter(
    (w) => positionFilter.has(w.id) && (!WALLET_REQUIRED_WIDGETS.has(w.id) || hasWallet),
  );
  const visibleIds = state.order.filter((id) => !state.hidden.has(id) && positionFilter.has(id));
  const visibleWidgets = visibleIds.map((id) => availableWidgets.find((w) => w.id === id)!).filter(Boolean);

  // -mt-8 pulls scroll content into topbar zone; the decoration inside the first
  // widget has z-index>topbar so it paints over the opaque topbar at scroll=0,
  // then clips naturally as it scrolls past the scroll container's top edge.
  const asideCls = 'w-[320px] min-w-[320px] min-h-0 bg-[var(--color-surface-canvas)] flex flex-col';
  const scrollCls = `flex-1 overflow-y-auto ${position === 'right' ? '' : 'px-4 pb-3 space-y-3'} -mt-8`;
  return (
    <WatchlistEditProvider>
      <aside className={asideCls}>
        <div className={scrollCls}>
          {visibleWidgets.length === 0 && (
            <div className="bg-[var(--color-surface-base)] border border-white/10 rounded-[4px] px-4 py-6 flex flex-col items-center gap-2 text-center">
              <div className="text-[24px] text-[var(--color-text-secondary)]">☰</div>
              <div className="text-body-sm-medium text-[var(--color-text-secondary)]">No widgets visible</div>
            </div>
          )}
          {visibleWidgets.map((w) => <WidgetRow key={w.id} widget={w} />)}
        </div>
      </aside>
    </WatchlistEditProvider>
  );
}
