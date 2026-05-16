import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { splitSymbol } from './symbol-utils';

function EmptyCoinsIcon() {
  return (
    <svg width="46" height="33" viewBox="0 0 46 33" fill="none" aria-hidden="true">
      <g clipPath="url(#empty-coins-clip)">
        <path d="M19.5368 0.40625C32.6208 3.35985 36.7756 20.5949 26.2077 29.3535C16.7223 37.2163 2.27836 31.6287 0.239975 19.3779C0.159369 18.8942 0.172824 18.3439 0.0202484 17.8867C0.0662684 16.9891 -0.0430775 16.0313 0.0202484 15.1416C0.491517 8.48232 5.40862 2.4319 11.6824 0.661133L14.7673 0.0458984H17.448L19.5368 0.40625ZM19.5564 8.51465C17.6038 6.56204 14.4377 6.56203 12.4851 8.51465L8.02513 12.9746C6.07251 14.9272 6.07252 18.0933 8.02513 20.0459L12.4851 24.5059C14.4377 26.4585 17.6038 26.4585 19.5564 24.5059L24.0163 20.0459C25.969 18.0933 25.969 14.9272 24.0163 12.9746L19.5564 8.51465Z" fill="#6E7480" />
        <path d="M16.125 18.4349C15.51 18.4349 15 17.9249 15 17.3099V13.3149C15 12.6999 15.51 12.1899 16.125 12.1899C16.74 12.1899 17.25 12.6999 17.25 13.3149V17.3099C17.25 17.9399 16.74 18.4349 16.125 18.4349Z" fill="#3BF7BF" />
        <circle cx="16.15" cy="20.3399" r="1.15" fill="#3BF7BF" />
        <path d="M31.2376 0.0450013C38.6476 0.593641 44.9876 6.88039 45.8762 14.4188C47.2964 26.4653 36.1863 35.86 24.9178 32.1975C25.6 31.6646 26.338 31.2123 27.0145 30.6685C32.9745 25.8802 35.2497 17.6497 32.6502 10.3128C31.2463 6.34944 28.4423 3.01828 24.9187 0.87681C25.4283 0.644769 25.9992 0.503184 26.5452 0.386181C27.0912 0.269177 27.9232 0.0862968 28.4615 0.0440181C29.2417 -0.0179251 30.4556 -0.0139922 31.2386 0.0440181L31.2376 0.0450013Z" fill="#6E7480" />
      </g>
      <defs>
        <clipPath id="empty-coins-clip">
          <rect width="46" height="33" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

export interface WatchlistAddDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Full token universe (already pre-filtered by search). */
  tokens: string[];
  prices: Record<string, number>;
  prevDayPrices: Record<string, number>;
  /** Per-symbol max leverage from Hyperliquid universe metadata. Missing
   *  entries → badge hidden for that row. */
  maxLeverages: Record<string, number>;
  /** Symbols already on the user's watchlist. */
  watchlistSet: Set<string>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onToggle: (symbol: string) => void;
}

export function WatchlistAddDrawer({
  open,
  onClose,
  tokens,
  prices,
  prevDayPrices,
  maxLeverages,
  watchlistSet,
  searchQuery,
  onSearchChange,
  onToggle,
}: WatchlistAddDrawerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

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

  // Freeze list order while drawer is open. The parent sorts
  // favs to the top, so toggling a token mid-scroll reorders the list and
  // the row physically jumps under the user's cursor — the click then
  // lands on a different (or no) row. Snapshot the order on open and only
  // surface new search results / new symbols at the bottom while open.
  const stableTokens = useMemo(() => {
    if (!open) return tokens;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const sym of tokens) {
      if (!seen.has(sym)) {
        seen.add(sym);
        out.push(sym);
      }
    }
    return out;
    // Deliberately only re-derived when the search query changes — favorite
    // toggles must NOT reorder the list mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchQuery]);

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
        aria-label="Add to watchlist"
        aria-modal="true"
        data-drawer-panel
        className={
          'fixed top-0 left-0 h-screen w-[424px] z-[10002] ' +
          'bg-[var(--color-surface-base)] flex flex-col ' +
          'shadow-[20px_4px_24px_0px_rgba(0,0,0,0.25)] ' +
          'transition-transform duration-base ease-out ' +
          (open ? 'translate-x-0' : '-translate-x-full pointer-events-none')
        }
      >
        <DrawerHeader onClose={onClose} />
        <SearchBox
          inputRef={inputRef}
          value={searchQuery}
          onChange={onSearchChange}
          onEnter={() => {
            if (stableTokens.length > 0) onToggle(stableTokens[0]);
          }}
        />
        <TokenList
          tokens={stableTokens}
          prices={prices}
          prevDayPrices={prevDayPrices}
          maxLeverages={maxLeverages}
          watchlistSet={watchlistSet}
          onToggle={onToggle}
          searchQuery={searchQuery}
        />
      </aside>
    </>,
    document.body,
  );
}

function DrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 pt-[27px] pb-4 shrink-0">
      <div className="flex items-center gap-3">
        <GhostHeaderIcon />
        <span className="text-body-md-semibold text-white">Add watchlist</span>
      </div>
      <button
        type="button"
        aria-label="Close"
        data-watchlist-edit
        onClick={onClose}
        className={
          'w-7 h-7 inline-flex items-center justify-center rounded-[4px] ' +
          'bg-transparent border-none cursor-pointer ' +
          'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] ' +
          'btn-press transition-colors duration-fast ease-out'
        }
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

interface SearchBoxProps {
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
}

function SearchBox({ inputRef, value, onChange, onEnter }: SearchBoxProps) {
  return (
    <div className="px-[17px] pb-3 shrink-0">
      <div
        className={
          'flex h-[45px] items-center gap-3 px-4 rounded-[4px] ' +
          'bg-[var(--color-surface-canvas)] border border-[var(--color-border-default)] ' +
          'focus-within:border-[var(--color-brand-default)] ' +
          'transition-colors duration-fast ease-out'
        }
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          aria-hidden="true"
          className="text-[var(--color-text-muted)] flex-none"
        >
          <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12.5 12.5 L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onEnter();
            }
          }}
          placeholder="Search token"
          aria-label="Search tokens"
          className={
            'flex-1 min-w-0 bg-transparent border-none ' +
            'text-body-md text-text-primary ' +
            'placeholder:text-[var(--color-text-muted)] ' +
            'outline-none focus:outline-none focus-visible:outline-none'
          }
        />
      </div>
    </div>
  );
}

interface TokenListProps {
  tokens: string[];
  prices: Record<string, number>;
  prevDayPrices: Record<string, number>;
  maxLeverages: Record<string, number>;
  watchlistSet: Set<string>;
  onToggle: (sym: string) => void;
  searchQuery: string;
}

function TokenList({ tokens, prices, prevDayPrices, maxLeverages, watchlistSet, onToggle, searchQuery }: TokenListProps) {
  if (tokens.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        <div className="flex flex-col items-center gap-[14px] pt-[90px] px-4">
          <EmptyCoinsIcon />
          <p className="m-0 text-body-md text-[var(--color-text-tertiary)] text-center">
            {searchQuery
              ? <>No results for &ldquo;{searchQuery.toLowerCase()}&rdquo;</>
              : 'No tokens available'}
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto pb-2">
      {tokens.map((sym) => {
        const isFav = watchlistSet.has(sym);
        const price = prices[sym];
        const prev = prevDayPrices[sym];
        const change =
          price != null && prev != null && prev > 0 ? ((price - prev) / prev) * 100 : null;
        const maxLev = maxLeverages[sym];
        return (
          <TokenRow
            key={sym}
            symbol={sym}
            isFav={isFav}
            price={price}
            change={change}
            maxLeverage={typeof maxLev === 'number' && maxLev > 0 ? maxLev : null}
            onToggle={() => onToggle(sym)}
          />
        );
      })}
    </div>
  );
}

interface TokenRowProps {
  symbol: string;
  isFav: boolean;
  price: number | undefined;
  change: number | null;
  maxLeverage: number | null;
  onToggle: () => void;
}

function TokenRow({ symbol, isFav, price, change, maxLeverage, onToggle }: TokenRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={isFav}
      aria-label={isFav ? `Remove ${symbol} from watchlist` : `Add ${symbol} to watchlist`}
      className={
        'group w-full flex h-[42px] items-center justify-between p-4 ' +
        'bg-transparent border-none text-left cursor-pointer ' +
        'transition-colors duration-fast ease-out ' +
        'hover:bg-white/[0.03] focus-visible:bg-white/[0.04]'
      }
    >
      <div className="flex items-center gap-2">
        <StarIcon filled={isFav} />
        <SymbolWithDex symbol={symbol} />
        {maxLeverage != null && <LeverageBadge value={maxLeverage} />}
      </div>
      <div className="flex items-center gap-1 [font-variant-numeric:tabular-nums]">
        <span className="text-body-sm text-text-primary">
          {price != null ? formatPrice(price) : '--'}
        </span>
        <ChangeChip pct={change} />
      </div>
    </button>
  );
}

function SymbolWithDex({ symbol }: { symbol: string }) {
  const { dex, base } = splitSymbol(symbol);
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-body-md text-text-primary">{base}</span>
      {dex && (
        <span
          className={
            'inline-flex items-center justify-center h-[18px] px-2 rounded-[2px] ' +
            'bg-[rgba(59,247,191,0.08)] text-brand-default text-caption leading-none'
          }
          aria-label={`HIP-3 dex ${dex}`}
          title={`HIP-3 dex ${dex}`}
        >
          {dex.toUpperCase()}
        </span>
      )}
    </span>
  );
}

function LeverageBadge({ value }: { value: number }) {
  return (
    <span
      className={
        'inline-flex items-center justify-center h-[18px] px-2 rounded-[2px] ' +
        'bg-[rgba(59,247,191,0.08)] text-brand-default ' +
        'text-caption leading-none ' +
        '[font-variant-numeric:tabular-nums]'
      }
      aria-label={`Max leverage ${value}x`}
    >
      {value}x
    </span>
  );
}

function StarIcon({ filled }: { filled: boolean }) {
  const color = filled ? 'var(--color-brand-default)' : 'var(--color-text-muted)';
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill={filled ? 'var(--color-brand-default)' : 'none'} aria-hidden="true">
      <path
        d="M7 1.5L8.71 5.13L12.5 5.78L9.75 8.5L10.42 12.25L7 10.5L3.58 12.25L4.25 8.5L1.5 5.78L5.29 5.13L7 1.5Z"
        stroke={color}
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChangeChip({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-body-sm text-text-muted">--</span>;
  const isUp = pct >= 0;
  const color = isUp ? 'var(--color-success-default)' : 'var(--color-error-text)';
  return (
    <div className="flex items-center gap-0.5">
      <svg width="8" height="6" viewBox="0 0 8 6" fill="none" aria-hidden="true" className={isUp ? '' : 'rotate-180'}>
        <path d="M4 0L8 6H0L4 0Z" fill={color} />
      </svg>
      <span className="text-body-sm [font-variant-numeric:tabular-nums]" style={{ color }}>
        {Math.abs(pct).toFixed(2)}%
      </span>
    </div>
  );
}

function GhostHeaderIcon() {
  return (
    <svg width="26" height="31" viewBox="0 0 26 31" fill="none" aria-hidden="true">
      <path
        d="M24.8806 22.2613C24.4178 19.0825 23.946 15.8943 23.2747 12.7556C21.7517 5.63365 20.642 0.722784 12.0789 1.61512C5.83391 2.26514 5.05875 8.83489 4.03022 13.969C3.52713 16.4795 2.98681 19.3324 2.7042 21.8666C2.62905 22.5363 2.48706 22.9197 2.99373 23.4774C4.26743 24.8788 6.52132 22.3196 7.74681 22.3889C8.61626 22.4388 9.0658 23.1839 9.77514 23.4919C11.951 24.4377 12.4231 22.5982 13.831 22.6275C14.7434 22.647 15.0748 23.3899 15.8523 23.6177C18.0223 24.2533 18.5063 22.3132 20.0337 22.3826C20.5644 22.407 20.9437 22.8392 21.3993 23.0669C22.4715 23.6051 23.8797 24.3989 24.622 23.3766C24.8532 23.0588 24.9354 22.652 24.8781 22.2613H24.8806ZM13.7607 15.6231C10.1454 15.6231 7.21464 12.9213 7.21464 9.58951C7.21464 6.25775 10.1454 3.55598 13.7607 3.55598C17.376 3.55598 20.3067 6.25775 20.3067 9.58951C20.3067 12.9213 17.376 15.6231 13.7607 15.6231Z"
        fill="var(--color-brand-default)"
      />
      <circle cx="6.5" cy="27.5" r="1.5" fill="var(--color-brand-default)" />
      <circle cx="13.5" cy="27.5" r="1.5" fill="var(--color-brand-default)" />
      <circle cx="20.5" cy="27.5" r="1.5" fill="var(--color-brand-default)" />
    </svg>
  );
}

function formatPrice(v: number): string {
  if (v >= 10_000) return `$${(v / 1000).toFixed(1)}k`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}
