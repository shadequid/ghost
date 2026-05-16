/**
 * WalletManager — two modals: Choose Wallet (provider picker) and Manage Wallets.
 */

import { useState, useEffect, useCallback } from "react";
import { Wallet, Plus, Loader, X, Trash2 } from "lucide-react";
import { useWallet } from "../../hooks/useWallet";
import { usePortfolio } from "../../hooks/usePortfolio";
import { TerminalModal } from "../TerminalModal";
import { formatUsdCompact } from "@/lib/format";

function formatSignedUsd(v: number): string {
  const sign = v >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function truncate(address: string): string {
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

/* ── Choose Wallet Modal ── */

interface DefaultWallet {
  rdns: string;
  name: string;
  subtitle: string;
  installUrl: string;
  iconUrl: string;
  popular?: boolean;
}

const DEFAULT_WALLETS: DefaultWallet[] = [
  { rdns: 'io.metamask', name: 'MetaMask', subtitle: 'Browser extension', installUrl: 'https://metamask.io/download/', iconUrl: 'https://cdn.jsdelivr.net/gh/MetaMask/brand-resources@main/SVG/SVG_MetaMask_Icon_Color.svg', popular: true },
  { rdns: 'io.rabby', name: 'Rabby Wallet', subtitle: 'Browser extension', installUrl: 'https://rabby.io/', iconUrl: 'https://rabby.io/assets/images/logo-128.png' },
  { rdns: 'com.coinbase.wallet', name: 'Coinbase Wallet', subtitle: 'Self-custody wallet', installUrl: 'https://www.coinbase.com/wallet/downloads', iconUrl: 'https://avatars.githubusercontent.com/u/1885080?s=200' },
  { rdns: 'app.phantom', name: 'Phantom', subtitle: 'Solana & EVM support', installUrl: 'https://phantom.app/download', iconUrl: 'https://avatars.githubusercontent.com/u/78782331?s=200' },
];

interface ChooseWalletModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ChooseWalletModal({ open, onClose, onSuccess }: ChooseWalletModalProps) {
  const { connecting, providers, connectWallet } = useWallet();
  const [connectingRdns, setConnectingRdns] = useState<string | null>(null);

  const handleConnect = async (wp: typeof providers[0]) => {
    setConnectingRdns(wp.info.rdns);
    try {
      await connectWallet(wp);
      // Open the next modal BEFORE closing this one so there's never a gap
      // where no overlay is rendered (prevents flicker).
      onSuccess?.();
      onClose();
    } finally {
      setConnectingRdns(null);
    }
  };

  // Merge: installed providers + defaults not yet installed
  const installedRdns = new Set(providers.map((p) => p.info.rdns.toLowerCase()));
  const extraDefaults = DEFAULT_WALLETS.filter((d) => !installedRdns.has(d.rdns.toLowerCase()));

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title="Connect Wallet"
      width={450}
      preventClose={connecting}
      hideHeader
      cardClassName="bg-surface-base border border-border-default rounded-[2px] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      bodyClassName="p-5"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-body-lg-semibold text-white">Connect Wallet</span>
          <button
            type="button"
            onClick={onClose}
            disabled={connecting}
            aria-label="Close"
            className={
              'size-[28px] rounded-[4px] flex items-center justify-center bg-transparent border-none transition-colors duration-fast ease-out '
              + (connecting ? 'text-text-tertiary cursor-not-allowed' : 'text-text-tertiary cursor-pointer hover:text-text-primary hover:bg-white/[0.05]')
            }
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {providers.map((wp) => {
            const isConnecting = connectingRdns === wp.info.rdns;
            const meta = DEFAULT_WALLETS.find((d) => d.rdns.toLowerCase() === wp.info.rdns.toLowerCase());
            const subtitle = meta?.subtitle ?? 'Browser extension';
            const iconSrc = wp.info.icon ?? meta?.iconUrl;
            return (
              <WalletRow
                key={wp.info.uuid}
                icon={<WalletIcon src={iconSrc} fallback={wp.info.name[0]} />}
                name={wp.info.name}
                subtitle={isConnecting ? 'Connecting…' : subtitle}
                popular={meta?.popular}
                disabled={connecting}
                onClick={() => !connecting && handleConnect(wp)}
              />
            );
          })}
          {extraDefaults.map((d) => (
            <WalletRow
              key={d.rdns}
              icon={<WalletIcon src={d.iconUrl} fallback={d.name[0]} />}
              name={d.name}
              subtitle="Install extension"
              popular={d.popular}
              disabled={connecting}
              onClick={() => window.open(d.installUrl, '_blank', 'noopener,noreferrer')}
            />
          ))}
        </div>
      </div>
    </TerminalModal>
  );
}

function WalletIcon({ src, fallback }: { src?: string; fallback: string }) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) {
    return (
      <div className="size-[36px] rounded-[4px] bg-surface-overlay text-text-primary flex items-center justify-center text-body-sm-medium flex-shrink-0">{fallback}</div>
    );
  }
  return (
    <img
      src={src}
      alt=""
      onError={() => setErrored(true)}
      className="size-[36px] rounded-[4px] object-cover flex-shrink-0"
    />
  );
}

function WalletRow({ icon, name, subtitle, popular, disabled, onClick }: {
  icon: React.ReactNode;
  name: string;
  subtitle: string;
  popular?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'flex items-center gap-3 px-4 py-2.5 bg-surface-canvas border border-border-subtle rounded-[2px] text-left w-full transition-colors duration-fast ease-out '
        + (disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-border-default')
      }
    >
      {icon}
      <div className="flex-1 flex flex-col gap-0.5 min-w-0 leading-[1.5]">
        <span className="text-body-md-medium text-text-primary">{name}</span>
        <span className="text-label-sm text-text-tertiary">{subtitle}</span>
      </div>
      {popular && (
        <span className="text-footnote text-brand-default bg-[#0d3b2a] px-2 py-1 rounded-[4px] leading-none whitespace-nowrap">Popular</span>
      )}
      <span className="font-mono text-caption text-[#484f58] leading-none">›</span>
    </button>
  );
}

/* ── Manage Wallets Modal ── */

interface WalletManagerModalProps {
  open: boolean;
  onClose: () => void;
}

export function WalletManagerModal({ open, onClose }: WalletManagerModalProps) {
  const {
    wallets, connecting, signingAddress, signingPhase, error, info, providers,
    addApiWallet, removeWallet, clearMessages,
  } = useWallet();
  const { aggregate } = usePortfolio();

  const [removingAddress, setRemovingAddress] = useState<string | null>(null);
  const [localInfo, setLocalInfo] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const openPicker = () => setPickerOpen(true);

  function getWalletStats(address: string) {
    const pw = aggregate?.perWallet.find((p) => p.address.toLowerCase() === address.toLowerCase());
    if (!pw) return null;
    const positions = pw.positions ?? [];
    const pnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
    return { equity: pw.balance?.totalEquity ?? 0, posCount: positions.length, pnl };
  }

  useEffect(() => { if (open) { clearMessages(); setLocalInfo(null); } }, [open, clearMessages]);

  const dismissInfo = useCallback(() => { setLocalInfo(null); clearMessages(); }, [clearMessages]);

  useEffect(() => {
    if (!error && !info && !localInfo) return;
    const t = setTimeout(dismissInfo, 5000);
    return () => clearTimeout(t);
  }, [error, info, localInfo, dismissInfo]);

  const handleRemove = async (address: string) => {
    setRemovingAddress(address);
    try { await removeWallet(address); }
    catch (e: unknown) { setLocalInfo((e as Error)?.message || "Failed to remove wallet"); }
    finally { setRemovingAddress(null); }
  };

  const preventClose = connecting || !!removingAddress;

  const countBadge = wallets.length > 0 ? (
    <span className="size-[22px] flex items-center justify-center px-2 pt-[2px] pb-[4px] bg-brand-subtle rounded-[4px] text-label-sm text-brand-default">
      {wallets.length}
    </span>
  ) : null;

  return (
    <>
      <TerminalModal
        open={open}
        onClose={onClose}
        title="Manage Wallets"
        width={600}
        preventClose={preventClose}
        hideHeader
        cardClassName="bg-surface-base border border-border-default rounded-[2px] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        bodyClassName="p-5"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-body-lg-semibold text-white">Manage Wallets</span>
              {countBadge}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={preventClose}
              aria-label="Close"
              className={
                'size-[28px] rounded-[4px] flex items-center justify-center bg-transparent border-none transition-colors duration-fast ease-out '
                + (preventClose ? 'text-text-tertiary cursor-not-allowed' : 'text-text-tertiary cursor-pointer hover:text-text-primary hover:bg-white/[0.05]')
              }
            >
              <X size={14} />
            </button>
          </div>
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="px-2.5 py-2 text-footnote rounded-[4px] text-[var(--color-error-text)] bg-[rgba(255,71,87,0.06)] border border-[rgba(255,71,87,0.12)] flex justify-between items-start gap-2 leading-[1.4]"
            >
              <span>{error}</span>
              <button
                onClick={dismissInfo}
                aria-label="Dismiss"
                className="bg-transparent border-none text-[var(--color-error-text)] cursor-pointer p-0 flex-shrink-0 opacity-50 transition-opacity duration-fast ease-out hover:opacity-100 focus-visible:opacity-100"
              ><X size={10} /></button>
            </div>
          )}
          {(info || localInfo) && (
            <div
              role="status"
              aria-live="polite"
              className="px-2.5 py-2 text-footnote rounded-[4px] text-[var(--color-text-secondary)] bg-[rgba(127,143,158,0.06)] border border-[rgba(127,143,158,0.1)] flex justify-between items-start gap-2 leading-[1.4]"
            >
              <span>{info || localInfo}</span>
              <button
                onClick={dismissInfo}
                aria-label="Dismiss"
                className="bg-transparent border-none text-[var(--color-text-secondary)] cursor-pointer p-0 flex-shrink-0 opacity-50 transition-opacity duration-fast ease-out hover:opacity-100 focus-visible:opacity-100"
              ><X size={10} /></button>
            </div>
          )}

          {wallets.length === 0 ? (
            <div className="py-5 flex flex-col items-center gap-2.5">
              <div className="w-11 h-11 rounded-[4px] bg-brand-subtle border border-brand-soft flex items-center justify-center">
                <Wallet size={20} className="text-text-muted" />
              </div>
              <div className="flex flex-col items-center gap-[3px]">
                <span className="text-caption text-text-secondary">
                  {providers.length > 0 ? "No wallets connected" : "No wallet extension detected"}
                </span>
                {providers.length === 0 && (
                  <span className="text-footnote text-text-muted text-center max-w-[260px]">
                    Install a browser wallet like MetaMask or Rabby, then refresh this page
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {wallets.map((w, idx) => {
                const isSigning = signingAddress === w.address;
                const stats = getWalletStats(w.address);
                const isRemoving = removingAddress === w.address;
                return (
                  <div
                    key={w.address}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 bg-surface-canvas border border-border-subtle rounded-[2px] [font-variant-numeric:tabular-nums]"
                  >
                    <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                      <span className="text-label-sm text-text-secondary">Account {idx + 1}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-body-md text-[#c8d1db] whitespace-nowrap">{truncate(w.address)}</span>
                        {w.isDefault && (
                          <span className="bg-surface-raised px-1 py-px rounded-[4px] text-footnote text-text-secondary">Default</span>
                        )}
                      </div>
                      {stats && (
                        <div className="flex items-center gap-2 text-label-sm text-text-tertiary whitespace-nowrap">
                          <span>Values {formatUsdCompact(stats.equity)}</span>
                          <span className="size-[2px] rounded-full bg-text-tertiary shrink-0" />
                          <span>{stats.posCount} position{stats.posCount !== 1 ? 's' : ''}</span>
                          {stats.pnl !== 0 && (
                            <>
                              <span className="size-[2px] rounded-full bg-text-tertiary shrink-0" />
                              <span>
                                PnL <span style={{ color: stats.pnl >= 0 ? 'var(--color-success-text)' : 'var(--color-error-text)' }}>{formatSignedUsd(stats.pnl)}</span>
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      {w.status !== "trading" && (() => {
                        const phaseLabel = isSigning
                          ? (signingPhase === 'generating' ? 'Generating…'
                            : signingPhase === 'switching-chain' ? 'Switch chain…'
                            : signingPhase === 'signing' ? 'Signing…'
                            : signingPhase === 'submitting' ? 'Submitting…'
                            : signingPhase === 'confirming' ? 'Confirming…'
                            : 'Enable Trading')
                          : 'Enable Trading';
                        const disabled = signingAddress !== null;
                        return (
                          <button
                            type="button"
                            className={
                              'btn-press flex items-center gap-1 h-[24px] px-1.5 py-1 border border-success-default bg-success-subtle text-success-text rounded-[4px] text-label-sm transition-[background,opacity] duration-base ease-out '
                              + (disabled ? 'cursor-wait' : 'cursor-pointer hover:bg-[rgba(34,197,94,0.18)]')
                            }
                            onClick={() => !disabled && addApiWallet(w.address)}
                            disabled={disabled}
                            style={{ opacity: disabled && !isSigning ? 0.5 : isSigning ? 0.7 : 1 }}
                          >
                            {isSigning ? (
                              <Loader size={14} className="animate-spin motion-reduce:animate-none" />
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="3" y="11" width="18" height="11" rx="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            )}
                            {phaseLabel}
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => !isRemoving && handleRemove(w.address)}
                        disabled={isRemoving}
                        aria-label={`Remove ${truncate(w.address)}`}
                        title={isRemoving ? 'Removing…' : 'Remove wallet'}
                        className={
                          'bg-transparent border-none p-0 inline-flex items-center justify-center transition-colors duration-fast ease-out '
                          + (isRemoving ? 'cursor-wait text-text-tertiary' : 'cursor-pointer text-text-tertiary hover:text-[var(--color-error-text)]')
                        }
                      >
                        {isRemoving ? <Loader size={18} className="animate-spin motion-reduce:animate-none" /> : <Trash2 size={18} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {providers.length > 0 && (
            <button
              type="button"
              onClick={openPicker}
              disabled={connecting}
              className={
                'btn-press flex items-center justify-center gap-1.5 w-full h-[43px] py-2.5 bg-transparent border border-border-default rounded-[4px] text-body-md-medium text-brand-default transition-colors duration-fast ease-out '
                + (connecting ? 'cursor-wait opacity-60' : 'cursor-pointer hover:bg-[rgba(59,247,191,0.04)] hover:border-brand-default')
              }
            >
              <Plus size={17} />
              {connecting ? 'CONNECTING…' : 'ADD WALLET'}
            </button>
          )}
        </div>
      </TerminalModal>
      <ChooseWalletModal open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  );
}
