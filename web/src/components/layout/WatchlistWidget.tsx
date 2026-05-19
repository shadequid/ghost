import { useState, useEffect, useCallback, useMemo, createContext, useContext, type ReactNode } from 'react';
import { useGateway } from '@/hooks/useGateway';
import { useChartPanel } from '@/components/chart/ChartPanelContext-internals';
import { WatchlistAddDrawer } from './WatchlistAddDrawer';
import { SymbolBadges } from './SymbolBadges';

interface WatchlistEditCtx {
  isEditing: boolean;
  setIsEditing: (v: boolean) => void;
}

const WatchlistEditContext = createContext<WatchlistEditCtx>({
  isEditing: false, setIsEditing: () => {},
});

export function WatchlistEditProvider({ children }: { children: ReactNode }) {
  const [isEditing, setIsEditing] = useState(false);
  const value = useMemo(() => ({ isEditing, setIsEditing }), [isEditing]);
  return <WatchlistEditContext.Provider value={value}>{children}</WatchlistEditContext.Provider>;
}

function useWatchlistEditing(): [boolean, (v: boolean) => void] {
  const ctx = useContext(WatchlistEditContext);
  return [ctx.isEditing, ctx.setIsEditing];
}

function EmptyCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-4 py-6 flex flex-col items-center gap-2.5">
      <div className="w-10 h-10 rounded-[4px] bg-[rgba(0,184,255,0.04)] border border-[rgba(0,184,255,0.1)] flex items-center justify-center">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00b8ff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      </div>
      <div className="flex flex-col items-center gap-[3px]">
        <span className="text-caption text-[var(--color-text-secondary)]">{title}</span>
        <span className="text-footnote text-[var(--color-text-secondary)] text-center leading-[1.4]">{subtitle}</span>
      </div>
    </div>
  );
}

function formatPrice(v: number): string {
  const dp = v >= 1 ? 2 : 4;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

const SHELL_CLS = 'flex flex-col gap-2';

function WatchlistInternalHeader() {
  const [isEditing, setIsEditing] = useWatchlistEditing();

  return (
    <div className="h-[38px] flex items-center justify-between px-2.5 bg-surface-base border-l border-border-subtle shrink-0">
      <span className="text-body-md-semibold text-text-secondary">WATCHLIST</span>
      <button
        type="button"
        data-watchlist-edit
        aria-label={isEditing ? 'Done editing watchlist' : 'Add token to watchlist'}
        aria-pressed={isEditing}
        onClick={(e) => { e.stopPropagation(); setIsEditing(!isEditing); }}
        className={
          'bg-transparent border-none cursor-pointer transition-colors duration-fast ease-out p-0 inline-flex items-center justify-center '
          + (isEditing ? 'text-brand-default' : 'text-text-tertiary hover:text-text-primary')
        }
      >
        {isEditing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 1.5V10.5M1.5 6H10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>
    </div>
  );
}

// TradingView-style 24h change formatters. Color follows the sign of the
// 24h delta — green up, red down, muted when unknown. The signed prefix
// is part of the formatted string so the row reads as a single number,
// not a glyph + magnitude pair.
function formatChange(v: number): string {
  const abs = Math.abs(v);
  const dp = abs >= 100 ? 2 : abs >= 1 ? 2 : 4;
  const body = abs.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (v >= 0 ? '+' : '-') + body;
}

function formatPct(v: number): string {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function changeColor(v: number | null): string {
  if (v == null) return 'var(--color-text-secondary)';
  return v >= 0 ? 'var(--color-success-default)' : 'var(--color-error-text)';
}

interface TokenData {
  tokens: string[];
  prices: Record<string, number>;
  prevDayPrices: Record<string, number>;
}

interface WatchlistItem {
  symbol: string;
  addedAt: string;
  notes?: string;
}

export function WatchlistWidget() {
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [tokenData, setTokenData] = useState<TokenData>({ tokens: [], prices: {}, prevDayPrices: {} });
  const [isEditing, setIsEditing] = useWatchlistEditing();
  const [searchQuery, setSearchQuery] = useState('');
  const { request, connected, subscribe } = useGateway();
  const panel = useChartPanel();

  const loadWatchlist = useCallback(() => {
    if (!connected) return;
    request<{ items: WatchlistItem[] }>('trading.watchlist.list', {})
      .then((res) => setWatchlistItems(res.items ?? []))
      .catch(() => {});
  }, [connected, request]);

  const fetchTokens = useCallback(() => {
    if (!connected) return;
    request<TokenData>('trading.tokens.list', {})
      .then((res) => {
        // On transient HL outage the gateway returns empty maps. Preserve
        // the last-known prices so the UI doesn't flash to blank state
        // until the next successful poll.
        setTokenData((prev) => ({
          ...res,
          prices: Object.keys(res.prices).length > 0 ? res.prices : prev.prices,
          prevDayPrices: Object.keys(res.prevDayPrices).length > 0 ? res.prevDayPrices : prev.prevDayPrices,
        }));
      })
      .catch(() => {});
  }, [connected, request]);

  useEffect(() => {
    loadWatchlist();
    fetchTokens();
  }, [loadWatchlist, fetchTokens]);

  // Metadata refresh — token universe + leverage tiers change on the order
  // of hours, not seconds. Prices arrive via WS (`trading.price.update`).
  useEffect(() => {
    if (!connected) return;
    const id = window.setInterval(() => fetchTokens(), 60_000);
    return () => window.clearInterval(id);
  }, [connected, fetchTokens]);

  useEffect(() => {
    return subscribe((evt) => {
      if (evt.event === 'trading.watchlist.changed' || evt.event === 'chat.done') {
        loadWatchlist();
      }
      if (evt.event === 'trading.price.update') {
        const { symbol, price, prevDayPrice } = evt.payload as { symbol: string; price: number; prevDayPrice?: number };
        setTokenData((prev) => {
          const priceUnchanged = prev.prices[symbol] === price;
          // Only update prevDayPrices when a fresh value arrives — preserve the
          // last-known value on ticks that don't carry prevDay (e.g. Binance WS).
          const prevDayUnchanged = prevDayPrice === undefined
            || prev.prevDayPrices[symbol] === prevDayPrice;
          if (priceUnchanged && prevDayUnchanged) return prev;
          return {
            ...prev,
            prices: priceUnchanged ? prev.prices : { ...prev.prices, [symbol]: price },
            prevDayPrices: prevDayPrice !== undefined
              ? { ...prev.prevDayPrices, [symbol]: prevDayPrice }
              : prev.prevDayPrices,
          };
        });
      }
    });
  }, [subscribe, loadWatchlist]);

  // Drawer owns its own input focus; this widget just resets the search
  // when the drawer closes.
  useEffect(() => {
    if (!isEditing) setSearchQuery('');
  }, [isEditing]);

  const symbols = useMemo(() => watchlistItems.map((i) => i.symbol), [watchlistItems]);
  const watchlistSet = useMemo(() => new Set(symbols), [symbols]);
  const { prices, prevDayPrices, tokens: allTokens } = tokenData;
  const hasPrices = Object.keys(prices).length > 0;

  const filteredTokens = useMemo(() => {
    const list = searchQuery
      ? allTokens.filter((sym) => sym.toUpperCase().includes(searchQuery.toUpperCase()))
      : allTokens;
    const fav = list.filter((sym) => watchlistSet.has(sym));
    const rest = list.filter((sym) => !watchlistSet.has(sym));
    return [...fav, ...rest];
  }, [allTokens, searchQuery, watchlistSet]);

  const toggleToken = useCallback((sym: string) => {
    const method = watchlistSet.has(sym) ? 'trading.watchlist.remove' : 'trading.watchlist.add';
    request(method, { symbol: sym })
      .then(() => loadWatchlist())
      .catch(() => {});
  }, [watchlistSet, request, loadWatchlist]);

  function renderAddDrawer() {
    return (
      <WatchlistAddDrawer
        open={isEditing}
        onClose={() => setIsEditing(false)}
        tokens={filteredTokens}
        prices={prices}
        prevDayPrices={prevDayPrices}
        watchlistSet={watchlistSet}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onToggle={toggleToken}
      />
    );
  }

  // Loading state
  if (symbols.length === 0 && !hasPrices && connected) {
    return (
      <div className={SHELL_CLS}>
        <WatchlistInternalHeader />
        <EmptyCard title="Loading prices…" subtitle="Fetching latest market data" />
        {renderAddDrawer()}
      </div>
    );
  }

  // Empty state
  if (symbols.length === 0) {
    return (
      <div className={SHELL_CLS}>
        <WatchlistInternalHeader />
        <EmptyCard title="No favorites yet" subtitle="Click + to add tokens to your watchlist" />
        {renderAddDrawer()}
      </div>
    );
  }

  return (
    <div className={SHELL_CLS}>
      <WatchlistInternalHeader />
      <div className="flex flex-col pb-2">
        {symbols.map((sym) => {
          const price = prices[sym];
          const prevDay = prevDayPrices[sym];
          const hasChange = price != null && prevDay != null && prevDay > 0;
          const changeVal = hasChange ? price - prevDay : null;
          const changePct = hasChange ? ((price - prevDay) / prevDay) * 100 : null;
          const color = changeColor(changePct);
          return (
            <div
              key={sym}
              // TradingView-style row: symbol on the left, then a right-
              // aligned trio — current price, 24h change value, 24h change %.
              // All three numbers share one color driven by the sign of the
              // 24h delta (green up, red down, muted when unknown).
              className="group flex h-[42px] items-center justify-between gap-2 py-4 px-2.5 cursor-pointer transition-colors duration-fast ease-out hover:bg-white/[0.03]"
              onClick={() => panel?.open({ symbol: sym })}
            >
              <div className="flex items-center gap-1.5 text-body-md text-text-primary min-w-0">
                <SymbolBadges symbol={sym} />
              </div>
              <div className="flex items-center gap-3 text-body-sm [font-variant-numeric:tabular-nums]">
                {/* Price stays white — TradingView convention. Only the
                    change columns carry the green/red/muted color so the
                    eye lands on direction signal, not the current price. */}
                <span className="text-text-primary">{price != null ? formatPrice(price) : '--'}</span>
                <span style={{ color }}>{changeVal != null ? formatChange(changeVal) : '--'}</span>
                <span style={{ color }}>{changePct != null ? formatPct(changePct) : '--'}</span>
              </div>
            </div>
          );
        })}
      </div>

      {renderAddDrawer()}
    </div>
  );
}
