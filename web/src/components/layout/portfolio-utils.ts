import type { OpenOrder } from '@/lib/portfolio-context';

// Formatters + pure derivation helpers shared across PortfolioWidget
// and PortfolioConnected.

export function formatUsd(v: number): string {
  return `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compact USD for tight cells — uses shared formatter with a 10k threshold
// so that $1k–$9,999 render with commas (e.g. "$1,234") and only >=10k switch to "$12.34k".
export const COMPACT_THRESHOLD = 10_000;

export function formatPnl(v: number): string { return `${v >= 0 ? '+' : '-'}${formatUsd(v)}`; }
export function formatPct(v: number): string { return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`; }
export function formatSize(v: number): string { return v.toFixed(v >= 100 ? 1 : v >= 1 ? 2 : 4); }
export function formatPrice(v: number): string {
  if (v >= 1000) return `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
}

export interface PositionLike {
  side: string;
  entryPrice: number;
  size: number;
  margin: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

export function estimatePnl(p: PositionLike, livePrice: number | undefined): { pnl: number; pct: number } {
  if (livePrice === undefined) return { pnl: p.unrealizedPnl, pct: p.unrealizedPnlPct };
  // Recompute the USD PnL from the live price for second-by-second responsiveness.
  // The percentage stays at the API-supplied `unrealizedPnlPct`: on live, that is
  // Hyperliquid's `returnOnEquity`, which folds in funding/fee accruals that a
  // client-side (livePrice - entry) * size simply cannot reproduce. On paper, the
  // engine already computes it as (pnl / margin) * 100. Trusting the upstream pct
  // is what keeps Ghost's per-position ROE matching HL's own UI.
  const pnl = p.side === 'long' ? (livePrice - p.entryPrice) * p.size : (p.entryPrice - livePrice) * p.size;
  return { pnl, pct: p.unrealizedPnlPct };
}

export function truncateAddr(addr: string): string {
  return addr.length <= 14 ? addr : `${addr.slice(0, 6)}...${addr.slice(-8)}`;
}

export function getOrderTypeInfo(o: OpenOrder, posSide?: 'long' | 'short', entryPrice?: number) {
  const isTrigger = o.triggerPrice != null;
  let typeLabel = isTrigger ? 'Trigger' : 'Limit';
  let typeColor = isTrigger ? 'var(--color-text-tertiary)' : 'var(--color-text-tertiary)';
  let typeBg = isTrigger ? 'rgba(121,121,121,0.15)' : 'rgba(91,164,181,0.12)';

  if (o.orderType.toLowerCase().includes('stop')) { typeLabel = 'SL'; typeColor = 'var(--color-error-default)'; typeBg = 'var(--color-error-soft)'; }
  else if (o.orderType.toLowerCase().includes('take')) { typeLabel = 'TP'; typeColor = 'var(--color-brand-default)'; typeBg = 'var(--color-brand-soft)'; }
  else if (o.reduceOnly && posSide && entryPrice) {
    // Partial TPs are placed as reduce-only LIMIT orders (no triggerPrice),
    // so the trigger-only branch above misses them. Classify by limit/trigger
    // price vs entry on the same direction.
    const px = o.triggerPrice ?? o.price;
    if (px != null) {
      const isSl = posSide === 'long' ? px < entryPrice : px > entryPrice;
      if (isSl) { typeLabel = 'SL'; typeColor = 'var(--color-error-default)'; typeBg = 'var(--color-error-soft)'; }
      else { typeLabel = 'TP'; typeColor = 'var(--color-brand-default)'; typeBg = 'var(--color-brand-soft)'; }
    }
  }
  return { typeLabel, typeColor, typeBg, isTrigger };
}

export function getLinkedOrders(symbol: string, orders: OpenOrder[]) {
  return orders.filter((o) => o.symbol === symbol && (o.triggerPrice != null || o.reduceOnly));
}

export function getStandaloneOrders(orders: OpenOrder[], positionSymbols: Set<string>) {
  return orders.filter((o) => !positionSymbols.has(o.symbol) || (!o.triggerPrice && !o.reduceOnly));
}

// ─── shared widget-surface utilities ───────────────────────────────────────
// Align with the shared <Card> primitive's default border/radius (CR drift
// fix: was border-[var(--color-surface-overlay)] + rounded-md locally). The flex-col +
// stay local because <Card>'s default className doesn't include them.
export const CARD_EXTRA_CLS = 'flex flex-col';

// minWidth 0 + overflow hidden lets the row shrink gracefully in narrow containers
export const POS_ROW_CLS =
  'px-2.5 py-2.5 flex flex-col gap-2 transition-colors duration-fast ease-out min-w-0 overflow-hidden hover:bg-white/[0.03]';
