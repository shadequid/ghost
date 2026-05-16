import { useEffect, useState, type ReactNode } from 'react';
import { TerminalModal } from '@/components/TerminalModal';
import { useGateway } from '@/hooks/useGateway';
import { formatUsdCompact, formatPnlCompact } from '@/lib/format';
import { formatPrice, formatSize } from './portfolio-utils';

// Recent trade history surfaced in the dashboard. Server returns up
// to 1000 fills across the last 30 days; client paginates 20 per page.

interface Fill {
  walletAddress: string;
  tradeId: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  fee: number;
  feeToken: string;
  realizedPnl: number;
  timestamp: number;
}

const PAGE_SIZE = 10;
const LOOKBACK_HOURS = 24 * 30;

interface Props {
  open: boolean;
  onClose: () => void;
  walletScope: 'all' | string;
}

export function TradeHistoryModal({ open, onClose, walletScope }: Props) {
  const { request } = useGateway();
  const [fills, setFills] = useState<Fill[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = () => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const payload: Record<string, unknown> = { lookbackHours: LOOKBACK_HOURS };
    if (walletScope === 'all') payload.all = true;
    else payload.address = walletScope;

    request<{ fills: Fill[] }>('trading.fills.list', payload)
      .then((res) => {
        if (cancelled) return;
        setFills(res.fills ?? []);
        setPage(1);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setFills([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  };

  useEffect(() => {
    if (!open) return;
    return load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, walletScope]);

  const totalPages = Math.max(1, Math.ceil(fills.length / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE;
  const visible = fills.slice(start, start + PAGE_SIZE);
  const totalPnl = fills.reduce((s, f) => s + f.realizedPnl, 0);
  const totalFees = fills.reduce((s, f) => s + f.fee, 0);

  return (
    <TerminalModal open={open} onClose={onClose} title="Trade History" width={750}>
      <div className="flex flex-col gap-3 text-body-sm">
        {/* Summary line */}
        {!loading && !error && fills.length > 0 && (
          <div className="flex items-center gap-3 text-body-sm text-[var(--color-text-secondary)] [font-variant-numeric:tabular-nums] flex-wrap">
            <span>{fills.length} fill{fills.length !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>
              Net PnL{' '}
              <span style={{ color: totalPnl >= 0 ? 'var(--color-brand-default)' : 'var(--color-error-default)' }} className="font-bold">
                {totalPnl >= 0 ? '+' : '-'}{formatUsdCompact(Math.abs(totalPnl))}
              </span>
            </span>
            <span>·</span>
            <span>Fees {formatUsdCompact(totalFees)}</span>
            {walletScope === 'all' && <><span>·</span><span>Aggregated</span></>}
          </div>
        )}

        {/* Body states */}
        {loading && (
          <div className="text-center py-8 text-[var(--color-text-secondary)]">Loading…</div>
        )}
        {error && !loading && (
          <div className="flex items-center justify-between px-3 py-2 border border-[var(--color-error-soft)] bg-[var(--color-error-subtle)] rounded text-[var(--color-error-default)]">
            <span>Failed to load trade history: {error}</span>
            <button
              type="button"
              className="text-body-sm text-[var(--color-error-default)] hover:underline btn-press ml-2"
              onClick={() => load()}
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && fills.length === 0 && (
          <div className="text-center py-8 text-[var(--color-text-secondary)]">
            No trades yet. Place a trade and your fills will show up here.
          </div>
        )}

        {/* Table */}
        {!loading && !error && fills.length > 0 && (
          <div className="border border-[var(--color-surface-overlay)] rounded-[4px] overflow-hidden">
            <div className="grid grid-cols-[125px_80px_55px_90px_105px_105px_80px] gap-2 px-3 py-2.5 bg-[var(--color-surface-canvas)] border-b border-[var(--color-surface-overlay)] text-body-sm text-[var(--color-text-secondary)] tracking-[0.3px]">
              <span>Time</span>
              <span>Symbol</span>
              <span>Side</span>
              <span className="text-right">Size</span>
              <span className="text-right">Price</span>
              <span className="text-right">PnL</span>
              <span className="text-right">Fee</span>
            </div>
            <div className="[font-variant-numeric:tabular-nums]">
              {visible.map((f) => {
                const t = new Date(f.timestamp);
                const timeLabel = `${t.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })} ${t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`;
                const sideColor = f.side === 'buy' ? 'var(--color-brand-default)' : 'var(--color-error-default)';
                const pnlColor = f.realizedPnl > 0 ? 'var(--color-brand-default)' : f.realizedPnl < 0 ? 'var(--color-error-default)' : 'var(--color-text-tertiary)';
                return (
                  <div key={f.tradeId} className="grid grid-cols-[125px_80px_55px_90px_105px_105px_80px] gap-2 px-3 py-2.5 border-b border-[var(--color-surface-overlay)] last:border-0 hover:bg-white/[0.02]">
                    <span className="text-[var(--color-text-secondary)] whitespace-nowrap">{timeLabel}</span>
                    <span className="text-white font-bold">{f.symbol}</span>
                    <span className="font-bold uppercase" style={{ color: sideColor }}>{f.side}</span>
                    <span className="text-right text-[var(--color-text-secondary)]">{formatSize(f.size)}</span>
                    <span className="text-right text-[var(--color-text-secondary)]">{formatPrice(f.price)}</span>
                    <span className="text-right font-bold" style={{ color: pnlColor }}>
                      {f.realizedPnl !== 0 ? formatPnlCompact(f.realizedPnl) : '—'}
                    </span>
                    <span className="text-right text-[var(--color-text-secondary)]">{f.fee > 0 ? formatUsdCompact(f.fee) : '—'}</span>
                  </div>
                );
              })}
            </div>
            {totalPages > 1 && (
              <Pagination page={page} totalPages={totalPages} onChange={setPage} />
            )}
          </div>
        )}
      </div>
    </TerminalModal>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  onChange: (n: number) => void;
}

/** Bottom-right pager: arrows + numbered pages with ellipsis when > 7 pages. */
function Pagination({ page, totalPages, onChange }: PaginationProps) {
  const pages = buildPageList(page, totalPages);
  return (
    <div className="px-3 py-2 border-t border-[var(--color-surface-overlay)] flex items-center justify-end gap-1 text-body-sm">
      <PagerButton disabled={page === 1} onClick={() => onChange(page - 1)} aria-label="Previous page">‹</PagerButton>
      {pages.map((p, idx) =>
        p === '…' ? (
          <span key={`ellipsis-${idx}`} className="px-1 text-[var(--color-text-secondary)]">…</span>
        ) : (
          <PagerButton
            key={p}
            active={p === page}
            onClick={() => onChange(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </PagerButton>
        ),
      )}
      <PagerButton disabled={page === totalPages} onClick={() => onChange(page + 1)} aria-label="Next page">›</PagerButton>
    </div>
  );
}

function buildPageList(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: Array<number | '…'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push('…');
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push('…');
  out.push(total);
  return out;
}

interface PagerButtonProps {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-current'?: 'page';
}

function PagerButton({ children, onClick, active, disabled, ...aria }: PagerButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-w-[22px] px-1.5 py-0.5 rounded-[2px] border transition-colors duration-fast btn-press ${
        active
          ? 'bg-[var(--color-surface-overlay)] border-[var(--color-brand-default)]/40 text-[var(--color-brand-default)]'
          : disabled
            ? 'border-transparent text-[var(--color-border-strong)] cursor-not-allowed'
            : 'border-[var(--color-surface-overlay)] text-[var(--color-text-secondary)] hover:text-white hover:border-[var(--color-surface-overlay)]'
      }`}
      {...aria}
    >
      {children}
    </button>
  );
}
