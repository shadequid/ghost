import { useState, useEffect, useCallback } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { useGateway } from '@/hooks/useGateway';
import { PulsingDots } from '@/components/chat/PulsingDots';
import { WalletManagerModal, ChooseWalletModal } from './WalletManager';
import { getStandaloneOrders } from './portfolio-utils';
import { PortfolioConnectPrompt } from './PortfolioConnectPrompt';
import { PortfolioHeader } from './PortfolioHeader';
import { PortfolioConnected, PositionCard, OrderCard } from './PortfolioConnected';
import { TradeHistoryModal } from './TradeHistoryModal';
import type { OpenOrder, Position } from '@/lib/portfolio-context';

export function PortfolioWidget() {
  const { status, balance, positions, openOrders, aggregate, error } = usePortfolio();
  const { subscribe } = useGateway();
  const [selectedView, setSelectedView] = useState<'all' | string>('all');
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  useEffect(() => {
    return subscribe((evt) => {
      if (evt.event === 'trading.price.update') {
        const { symbol, price } = evt.payload as { symbol: string; price: number };
        setLivePrices((prev) => (prev[symbol] === price ? prev : { ...prev, [symbol]: price }));
      }
    });
  }, [subscribe]);

  const getMarketPrice = useCallback(
    (symbol: string, fallback: number) => livePrices[symbol] ?? fallback,
    [livePrices],
  );

  const [pickerOpen, setPickerOpen] = useState(false);
  const modal = (
    <>
      <WalletManagerModal open={walletModalOpen} onClose={() => setWalletModalOpen(false)} />
      <ChooseWalletModal open={pickerOpen} onClose={() => setPickerOpen(false)} onSuccess={() => setWalletModalOpen(true)} />
      <TradeHistoryModal open={historyModalOpen} onClose={() => setHistoryModalOpen(false)} walletScope={selectedView} />
    </>
  );

  if (status === 'no-wallet' || status === 'idle') {
    return (
      <>
        {modal}
        <PortfolioHeader borderColor="#00A58D">
          <PortfolioConnectPrompt onConnect={() => setPickerOpen(true)} />
        </PortfolioHeader>
      </>
    );
  }
  if (status === 'loading' && !balance) {
    return (
      <>
        {modal}
        <PortfolioHeader>
          <div className="px-4 pt-7 pb-6 flex flex-col items-center gap-2.5">
            <div className="w-10 h-10 rounded-[4px] bg-[rgba(0,255,136,0.04)] border border-[rgba(0,255,136,0.1)] flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-brand-default)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4z" />
              </svg>
            </div>
            <div className="flex flex-col items-center gap-[3px]">
              <span className="text-caption text-[var(--color-text-secondary)]">Loading portfolio…</span>
              <span className="text-footnote text-[var(--color-text-secondary)] text-center leading-[1.4]">Fetching balances and positions from Hyperliquid</span>
            </div>
            <div className="mt-0.5"><PulsingDots /></div>
          </div>
        </PortfolioHeader>
      </>
    );
  }
  if (!balance) {
    const errMsg = error ? `Failed to load portfolio: ${error}` : 'Failed to load portfolio';
    return (
      <>
        {modal}
        <PortfolioHeader>
          <div className="px-2.5 pt-7 pb-2.5 flex items-center gap-2" role="alert">
            <span className="text-caption text-[var(--color-error-text)]">{errMsg}</span>
          </div>
        </PortfolioHeader>
      </>
    );
  }

  // Resolve data based on selected wallet in dropdown
  let viewPositions = positions;
  let viewOrders = openOrders;
  let viewBalance = balance;

  if (selectedView === 'all' && aggregate) {
    // Merge all positions/orders from all wallets, tag with wallet address
    viewPositions = aggregate.perWallet.flatMap((pw) =>
      (pw.positions ?? []).map((p) => ({ ...p, walletAddress: pw.address }))
    );
    viewOrders = aggregate.perWallet.flatMap((pw) => pw.openOrders ?? []);
  } else if (selectedView !== 'all' && aggregate) {
    const pw = aggregate.perWallet.find((pw) => pw.address.toLowerCase() === selectedView.toLowerCase());
    if (pw) {
      viewPositions = pw.positions ?? [];
      viewOrders = pw.openOrders ?? [];
      viewBalance = pw.balance ?? balance;
    }
  }

  const positionSymbols = new Set(viewPositions.map((p) => p.symbol));
  const standalone = getStandaloneOrders(viewOrders, positionSymbols);

  return (
    <>
      {modal}
      <div className="flex flex-col gap-3">
        <PortfolioHeader>
          <PortfolioConnected
            selectedView={selectedView}
            onSelect={setSelectedView}
            onManageWallets={() => setWalletModalOpen(true)}
            onOpenHistory={() => setHistoryModalOpen(true)}
            aggregate={aggregate}
            viewBalance={viewBalance}
            viewPositions={viewPositions}
            livePrices={livePrices}
          />
        </PortfolioHeader>
        <PositionsBox
          positions={viewPositions}
          viewOrders={viewOrders}
          livePrices={livePrices}
          getMarketPrice={getMarketPrice}
        />
        <OrdersBox orders={standalone} />
      </div>
    </>
  );
}

interface PositionsBoxProps {
  positions: Position[];
  viewOrders: OpenOrder[];
  livePrices: Record<string, number>;
  getMarketPrice: (symbol: string, fallback: number) => number;
}

function PositionsBox({ positions, viewOrders, livePrices, getMarketPrice }: PositionsBoxProps) {
  if (positions.length === 0) return null;
  return (
    <section className="flex flex-col gap-2.5 [font-variant-numeric:tabular-nums]">
      <SectionTitle label="POSITIONS" count={positions.length} />
      <div className="flex flex-col gap-3 pl-2.5 pb-2.5">
        {positions.map((p) => {
          const key = p.walletAddress ? `${p.walletAddress}-${p.symbol}` : p.symbol;
          return (
            <PositionCard
              key={key}
              position={p}
              viewOrders={viewOrders}
              livePrices={livePrices}
              getMarketPrice={getMarketPrice}
            />
          );
        })}
      </div>
    </section>
  );
}

function OrdersBox({ orders }: { orders: OpenOrder[] }) {
  if (orders.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 [font-variant-numeric:tabular-nums]">
      <SectionTitle label="ORDER" count={orders.length} />
      <div className="flex flex-col gap-3 pl-2.5 pb-2.5">
        {orders.map((o, i) => (
          <div
            key={o.orderId}
            className={i < orders.length - 1 ? 'pb-3 border-b border-border-subtle' : ''}
          >
            <OrderCard order={o} />
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionTitle({ label, count }: { label: string; count: number }) {
  return (
    <div className="h-[38px] flex items-center justify-between px-2.5 bg-surface-base border-l border-border-subtle">
      <span className="text-body-md-semibold text-text-secondary">{label}</span>
      <span className="text-label-sm text-text-tertiary tracking-[0.24px]">{count}</span>
    </div>
  );
}
