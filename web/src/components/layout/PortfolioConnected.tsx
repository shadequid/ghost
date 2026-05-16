import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Settings } from 'lucide-react';
import { Popover } from '@/components/Popover';
import { AnimatedNumber } from '@/components/AnimatedNumber';
import { useWallet } from '@/hooks/useWallet';
import { usePortfolio } from '@/hooks/usePortfolio';
import { formatUsdCompact, formatPnlCompact } from '@/lib/format';
import type { OpenOrder, Position, AggregatePortfolio, Balance } from '@/lib/portfolio-context';
import {
  COMPACT_THRESHOLD,
  estimatePnl,
  formatPct,
  formatPnl,
  formatPrice,
  formatSize,
  formatUsd,
  getLinkedOrders,
  getOrderTypeInfo,
  truncateAddr,
} from './portfolio-utils';

interface Props {
  selectedView: 'all' | string;
  onSelect: (view: 'all' | string) => void;
  onManageWallets: () => void;
  onOpenHistory: () => void;
  aggregate: AggregatePortfolio | null;
  viewBalance: Balance | null;
  viewPositions: Position[];
  livePrices: Record<string, number>;
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    aria-hidden="true"
    className={`transition-transform duration-base ease-out ${open ? 'rotate-180' : ''}`}
  >
    <path d="M8.95987 4.08997H5.84487H3.03987C2.55987 4.08997 2.31987 4.66997 2.65987 5.00997L5.24987 7.59997C5.66487 8.01497 6.33987 8.01497 6.75487 7.59997L7.73987 6.61497L9.34487 5.00997C9.67987 4.66997 9.43987 4.08997 8.95987 4.08997Z" fill="currentColor" />
  </svg>
);

const HistoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M9.69992 14.9467C9.47992 14.9467 9.27325 14.8 9.21325 14.5733C9.13992 14.3067 9.29992 14.0333 9.57325 13.96C12.2799 13.2467 14.1666 10.7933 14.1666 7.99334C14.1666 4.59334 11.3999 1.82667 7.99992 1.82667C5.11325 1.82667 3.21992 3.51334 2.33325 4.53334H4.29325C4.56659 4.53334 4.79325 4.76 4.79325 5.03334C4.79325 5.30667 4.57325 5.54 4.29325 5.54H1.33992C1.30659 5.54 1.24659 5.53334 1.19992 5.52C1.13992 5.5 1.08659 5.47334 1.03992 5.44C0.979919 5.4 0.933252 5.34667 0.899919 5.28667C0.866585 5.22667 0.839919 5.15334 0.833252 5.08C0.833252 5.06 0.833252 5.04667 0.833252 5.02667V2C0.833252 1.72667 1.05992 1.5 1.33325 1.5C1.60659 1.5 1.83325 1.72667 1.83325 2V3.59334C2.91992 2.42667 4.96658 0.833336 7.99992 0.833336C11.9533 0.833336 15.1666 4.04667 15.1666 8C15.1666 11.2533 12.9733 14.1067 9.82658 14.9333C9.78658 14.94 9.73992 14.9467 9.69992 14.9467Z" fill="currentColor" />
    <path d="M10.2147 10C10.1369 10 10.0592 9.98255 9.9875 9.93602L8.13431 8.86005C7.674 8.59251 7.33325 8.00509 7.33325 7.48746V5.10287C7.33325 4.86441 7.5365 4.66666 7.7816 4.66666C8.0267 4.66666 8.22996 4.86441 8.22996 5.10287V7.48746C8.22996 7.69683 8.4093 8.00509 8.59462 8.10978L10.4478 9.18575C10.663 9.30789 10.7288 9.57542 10.6032 9.7848C10.5136 9.92439 10.3641 10 10.2147 10Z" fill="currentColor" />
    <path d="M7.52658 15.1533C7.51325 15.1533 7.49992 15.1467 7.49325 15.1467C6.77325 15.1 6.06659 14.94 5.39992 14.68C5.20659 14.6067 5.07325 14.4133 5.07992 14.2067C5.07992 14.1467 5.09325 14.0867 5.11325 14.0333C5.21325 13.78 5.51325 13.6533 5.75992 13.7467C6.33992 13.9733 6.94659 14.1067 7.55992 14.1533C7.81992 14.1667 8.02658 14.3933 8.02658 14.66L8.01992 14.6867C8.00658 14.9467 7.78658 15.1533 7.52658 15.1533ZM3.85325 13.72C3.73992 13.72 3.63325 13.68 3.53992 13.6133C2.97992 13.16 2.48659 12.6333 2.08659 12.0467C2.02659 11.96 1.99325 11.8667 1.99325 11.7667C1.99325 11.6 2.07325 11.4467 2.21325 11.3533C2.43325 11.2 2.75325 11.26 2.90659 11.4733C2.90659 11.48 2.90659 11.48 2.90659 11.48C2.91325 11.4867 2.91992 11.5 2.92658 11.5067C3.27325 12.0067 3.69325 12.4533 4.16658 12.8267C4.27992 12.92 4.35325 13.06 4.35325 13.2133C4.35325 13.3267 4.31992 13.44 4.24658 13.5333C4.14658 13.6533 4.00659 13.72 3.85325 13.72ZM1.62659 10.4667C1.40659 10.4667 1.21325 10.3267 1.15325 10.12C0.939919 9.43333 0.833252 8.72 0.833252 8V7.99333C0.839919 7.72 1.05992 7.5 1.33325 7.5C1.60659 7.5 1.83325 7.72667 1.83325 8C1.83325 8.62667 1.92659 9.24 2.10659 9.82C2.11992 9.87333 2.12659 9.92 2.12659 9.97333C2.12659 10.1867 1.98659 10.38 1.77325 10.4467C1.72659 10.46 1.67992 10.4667 1.62659 10.4667Z" fill="currentColor" />
  </svg>
);

const TrendArrow = ({ up }: { up: boolean }) => (
  <svg width="8" height="6" viewBox="0 0 8 6" fill="none" aria-hidden="true" className={up ? '' : 'rotate-180'}>
    <path d="M4 0L8 6H0L4 0Z" fill={up ? 'var(--color-success-text)' : 'var(--color-error-text)'} />
  </svg>
);

function WalletPill({ selectedView, onSelect, onManageWallets }: Pick<Props, 'selectedView' | 'onSelect' | 'onManageWallets'>) {
  const { wallets, paperMode } = usePortfolio();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 4, left: r.left });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const defaultWallet = wallets.find((w) => w.isDefault) ?? wallets[0];
  const label = wallets.length > 1 && selectedView === 'all'
    ? `All wallets (${wallets.length})`
    : truncateAddr(selectedView === 'all' ? defaultWallet?.address ?? '' : selectedView);

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1.5 py-1 rounded-[4px] bg-transparent text-text-secondary text-body-sm cursor-pointer transition-colors duration-fast ease-out hover:text-text-tertiary"
      >
        <span className="whitespace-nowrap">{label}</span>
        <Chevron open={open} />
      </button>
      {createPortal(
      <Popover
        ref={menuRef}
        open={open}
        origin="top-left"
        slideY={4}
        className="fixed z-50 bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[4px] shadow-[0_4px_16px_rgba(0,0,0,0.5)] min-w-[180px] max-h-[240px] overflow-y-auto"
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      >
        {wallets.length > 1 && (
          <button
            onClick={() => { onSelect('all'); setOpen(false); }}
            className={
              'flex items-center gap-1.5 w-full text-left px-2.5 py-2 text-body-sm border-none cursor-pointer transition-colors duration-fast ease-out '
              + (selectedView === 'all'
                ? 'bg-brand-subtle text-brand-default'
                : 'bg-transparent text-text-secondary hover:bg-white/[0.03]')
            }
          >
            All Wallets ({wallets.length})
          </button>
        )}
        {wallets.map((w) => {
          const isActive = selectedView === w.address || (wallets.length === 1 && selectedView === 'all');
          return (
            <button
              key={w.address}
              onClick={() => { onSelect(wallets.length === 1 ? 'all' : w.address); setOpen(false); }}
              className={
                'flex items-center gap-1.5 w-full text-left px-2.5 py-2 text-body-sm border-none cursor-pointer transition-colors duration-fast ease-out '
                + (isActive
                  ? 'bg-brand-subtle text-brand-default'
                  : 'bg-transparent text-text-secondary hover:bg-white/[0.03]')
              }
            >
              <span
                className="w-[5px] h-[5px] rounded-full flex-shrink-0"
                style={{ background: w.status === 'trading' ? 'var(--color-brand-default)' : 'var(--color-text-muted)' }}
              />
              <span className="flex-1">{truncateAddr(w.address)}</span>
            </button>
          );
        })}
        {!paperMode && (
          <div className="border-t border-[var(--color-border-default)]">
            <button
              onClick={() => { setOpen(false); onManageWallets(); }}
              className="flex items-center gap-1 w-full px-2.5 py-2 text-body-sm bg-transparent text-text-secondary border-none cursor-pointer hover:bg-white/[0.03]"
            >
              <Settings size={10} /> Manage Wallets
            </button>
          </div>
        )}
      </Popover>,
        document.body,
      )}
    </>
  );
}

function EnableTradingButton({ activeAddr, disabled }: { activeAddr: string | null; disabled: boolean }) {
  const { addApiWallet, signingAddress, signingPhase } = useWallet();
  const isSigning = activeAddr != null && signingAddress?.toLowerCase() === activeAddr.toLowerCase();
  const phaseLabel = !isSigning ? 'Enable Trading'
    : signingPhase === 'generating' ? 'Generating…'
    : signingPhase === 'switching-chain' ? 'Switch chain…'
    : signingPhase === 'signing' ? 'Signing…'
    : signingPhase === 'submitting' ? 'Submitting…'
    : signingPhase === 'confirming' ? 'Confirming…'
    : 'Enable Trading';
  return (
    <button
      type="button"
      onClick={() => activeAddr && !isSigning && addApiWallet(activeAddr)}
      disabled={disabled || isSigning}
      className={
        'btn-press h-[26px] px-2 py-1 border border-brand-default rounded-[4px] bg-transparent text-brand-default text-body-sm-medium leading-none whitespace-nowrap transition-colors duration-fast ease-out '
        + (disabled || isSigning ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-[rgba(59,247,191,0.08)]')
      }
    >
      {phaseLabel}
    </button>
  );
}

function TpSlRow({ kind, price, size, symbol, pnl }: { kind: 'TP' | 'SL'; price: number; size: number; symbol: string; pnl: number }) {
  const valueColor = kind === 'TP' ? 'text-success-text' : 'text-error-text';
  const labelColor = kind === 'TP' ? 'text-success-default' : 'text-error-default';
  return (
    <div className="flex h-[18px] items-center justify-between py-1">
      <span className={`${labelColor} text-label-sm leading-none w-[35px] tracking-[0.24px]`}>{kind}</span>
      <span className="text-body-sm text-text-primary w-[60px]">{formatPrice(price)}</span>
      <span className="text-body-sm text-text-primary w-[90px]">{formatSize(size)} {symbol}</span>
      <span className={`${valueColor} text-body-sm text-right w-[60px]`}>{formatPnlCompact(pnl, COMPACT_THRESHOLD)}</span>
    </div>
  );
}

export function PositionCard({ position: p, viewOrders, livePrices, getMarketPrice }: { position: Position; viewOrders: OpenOrder[]; livePrices: Record<string, number>; getMarketPrice: (s: string, f: number) => number }) {
  const isLong = p.side === 'long';
  const sideLabel = isLong ? 'LONG' : 'SHORT';
  const sideColor = isLong ? 'text-success-text' : 'text-error-text';
  const sideBg = isLong ? 'bg-success-subtle' : 'bg-error-subtle';
  const linked = getLinkedOrders(p.symbol, viewOrders);
  const triggerOf = (o: OpenOrder) => o.triggerPrice ?? o.price ?? 0;
  const tps = linked.filter((o) => getOrderTypeInfo(o, p.side, p.entryPrice).typeLabel === 'TP')
    .sort((a, b) => isLong ? triggerOf(a) - triggerOf(b) : triggerOf(b) - triggerOf(a));
  const sls = linked.filter((o) => getOrderTypeInfo(o, p.side, p.entryPrice).typeLabel === 'SL')
    .sort((a, b) => isLong ? triggerOf(b) - triggerOf(a) : triggerOf(a) - triggerOf(b));
  const mkt = getMarketPrice(p.symbol, p.markPrice);
  const favors = isLong ? mkt >= p.entryPrice : mkt <= p.entryPrice;
  const { pnl: ePnl, pct: ePct } = estimatePnl(p, livePrices[p.symbol]);
  const pnlColor = ePnl >= 0 ? 'text-success-text' : 'text-error-text';

  return (
    <div className="flex flex-col gap-2 [font-variant-numeric:tabular-nums]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-body-md-medium text-text-primary">{p.symbol}</span>
          <span className={`${sideBg} ${sideColor} h-[20px] flex items-center justify-center px-[7px] rounded-[2px] text-label-sm leading-none`}>
            {sideLabel} {p.leverage}x
          </span>
        </div>
        <div className={`flex items-center gap-[7px] ${pnlColor}`}>
          <span className="text-body-md-medium">{formatPnl(ePnl)}</span>
          <div className="flex items-center gap-[2px]">
            <TrendArrow up={ePnl >= 0} />
            <span className="text-body-sm">{formatPct(ePct)}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-number-sm text-text-tertiary">
          <span>Size: {formatSize(p.size)} {p.symbol}</span>
          <span>Margin: {formatUsdCompact(p.margin, COMPACT_THRESHOLD)}</span>
        </div>
        <div className="border-y border-dashed border-border-subtle flex h-[53px] items-stretch gap-5">
          <div className="flex-1 min-w-0 flex flex-col gap-[2px] justify-center">
            <span className="text-number-sm text-text-tertiary">Entry Price</span>
            <span className="text-body-sm text-text-primary">{formatPrice(p.entryPrice)}</span>
          </div>
          <div className="self-stretch border-l border-dashed border-border-subtle" />
          <div className="flex-1 min-w-0 flex flex-col gap-[2px] justify-center">
            <span className="text-number-sm text-text-tertiary">Mark Price</span>
            <div className="flex items-center gap-1">
              <span className="text-body-sm text-text-primary">{formatPrice(mkt)}</span>
              <TrendArrow up={favors} />
            </div>
          </div>
          <div className="self-stretch border-l border-dashed border-border-subtle" />
          <div className="flex-1 min-w-0 flex flex-col gap-[2px] justify-center">
            <span className="text-number-sm text-text-tertiary">Liq.Price</span>
            <span className="text-body-sm text-warning-text">{p.liquidationPrice != null ? formatPrice(p.liquidationPrice) : 'N/A'}</span>
          </div>
        </div>
      </div>
      {(tps.length > 0 || sls.length > 0) && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between pb-[2px] text-number-sm text-text-tertiary">
            <span className="w-[35px]">Order</span>
            <span className="w-[60px]">Price</span>
            <span className="w-[90px]">Size</span>
            <span className="w-[60px] text-right">PnL</span>
          </div>
          <div className="flex flex-col gap-2">
            {tps.map((o) => {
              const effSize = o.size > 0 ? o.size : p.size;
              const tpPnl = (triggerOf(o) - p.entryPrice) * effSize * (isLong ? 1 : -1);
              return <TpSlRow key={o.orderId} kind="TP" price={triggerOf(o)} size={effSize} symbol={p.symbol} pnl={tpPnl} />;
            })}
            {sls.map((o) => {
              const effSize = o.size > 0 ? o.size : p.size;
              const slPnl = (triggerOf(o) - p.entryPrice) * effSize * (isLong ? 1 : -1);
              return <TpSlRow key={o.orderId} kind="SL" price={triggerOf(o)} size={effSize} symbol={p.symbol} pnl={slPnl} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function OrderCard({ order: o }: { order: OpenOrder }) {
  const { typeLabel } = getOrderTypeInfo(o);
  const isBuy = o.side === 'buy';
  const dir = o.reduceOnly ? (isBuy ? 'CLOSE SHORT' : 'CLOSE LONG') : (isBuy ? 'BUY' : 'SELL');
  const dirColorBg = o.reduceOnly
    ? 'bg-[rgba(110,116,128,0.15)] text-text-tertiary'
    : isBuy ? 'bg-info-subtle text-info-text' : 'bg-error-subtle text-error-text';
  const price = o.triggerPrice ?? o.price ?? 0;
  return (
    <div className="flex flex-col gap-[7px] items-start w-full [font-variant-numeric:tabular-nums]">
      <div className="flex items-center gap-1.5">
        <span className="text-body-md-medium text-text-primary">{o.symbol}</span>
        <span className={`${dirColorBg} h-5 flex items-center justify-center px-1.5 rounded-[2px] text-label-sm leading-none tracking-[0.24px]`}>
          {typeLabel} {dir}
        </span>
      </div>
      <div className="flex items-center justify-between w-full">
        <span className="text-number-sm text-text-tertiary">Size: {formatSize(o.size)} {o.symbol}</span>
        <span className="text-number-sm text-text-tertiary">Price: {formatPrice(price)}</span>
      </div>
    </div>
  );
}

export function PortfolioConnected({
  selectedView,
  onSelect,
  onManageWallets,
  onOpenHistory,
  aggregate,
  viewBalance,
  viewPositions,
  livePrices,
}: Props) {
  const { wallets, paperMode } = usePortfolio();
  const isAggView = selectedView === 'all' && aggregate && wallets.length > 1;
  const baseEquity = isAggView ? aggregate.totalEquity : (viewBalance?.totalEquity ?? 0);
  const baseAvailable = isAggView ? aggregate.totalAvailable : (viewBalance?.availableBalance ?? 0);
  const allPos = isAggView ? aggregate.perWallet.flatMap((pw) => pw.positions ?? []) : viewPositions;
  const pnl = allPos.reduce((sum, p) => sum + estimatePnl(p, livePrices[p.symbol]).pnl, 0);
  const restPnl = allPos.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const equity = baseEquity + (pnl - restPnl);
  const available = baseAvailable + (pnl - restPnl);
  const pct = equity > 0 ? (pnl / equity) * 100 : 0;
  const pnlColor = pnl >= 0 ? 'text-success-text' : 'text-error-text';

  const defaultWallet = wallets.find((w) => w.isDefault) ?? wallets[0];
  const activeWallet = selectedView === 'all' ? defaultWallet : wallets.find((w) => w.address === selectedView) ?? defaultWallet;
  const showEnableTrading = !paperMode && activeWallet != null && activeWallet.status !== 'trading';

  return (
    <div className="flex flex-col px-4 pt-6 [font-variant-numeric:tabular-nums]">
      <div className="flex flex-col gap-2 pb-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <WalletPill selectedView={selectedView} onSelect={onSelect} onManageWallets={onManageWallets} />
            <div className="flex items-center gap-3">
              {showEnableTrading && (
                <EnableTradingButton activeAddr={activeWallet?.address ?? null} disabled={false} />
              )}
              <button
                type="button"
                onClick={onOpenHistory}
                className="size-[26px] flex items-center justify-center bg-transparent border-none text-text-secondary cursor-pointer transition-colors duration-fast ease-out hover:text-text-primary btn-press"
                aria-label="Trade history"
                title="Trade history"
              >
                <HistoryIcon />
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 leading-[1.5]">
            <div className="text-heading-md text-text-primary">
              <AnimatedNumber value={equity} format={formatUsd} />
            </div>
            <div className={`text-body-md ${pnlColor}`}>
              <AnimatedNumber value={pnl} format={formatPnl} /> (<AnimatedNumber value={pct} format={formatPct} />) today
            </div>
          </div>
        </div>
        <div className="flex h-[20px] items-center">
          <span className="text-body-md text-text-secondary">
            Available trade: <AnimatedNumber value={available} format={formatUsd} />
          </span>
        </div>
      </div>
    </div>
  );
}
