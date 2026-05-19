import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover } from '@/components/Popover';
import { UpdateAvailableModal } from '@/components/UpdateAvailableModal';
import { useGateway } from '@/hooks/useGateway';
import {
  loadWidgetState,
  setWidgetHidden,
  subscribeWidgetVisibility,
} from '@/lib/widget-visibility';
import { DEFAULT_ORDER } from '@/components/layout/Sidebar';
import settingsIcon from '@/assets/topbar-settings.svg';

const BTN_CLS =
  'inline-flex items-center justify-center w-8 h-8 rounded-full ' +
  'bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)] ' +
  'text-[var(--color-text-secondary)] ' +
  'cursor-pointer transition-colors duration-fast ease-out ' +
  'hover:border-[var(--color-border-default)] hover:text-[var(--color-text-primary)]';

/** Read "is tweets widget visible?" from shared widget state. */
function readTweetsVisible(): boolean {
  return !(loadWidgetState()?.hidden.has('tweets') ?? false);
}

interface VersionStatus {
  /** Installed version, or `null` while the first status call is in flight. */
  current: string | null;
  /** True only when the registry has a newer semver. */
  updateAvailable: boolean | null;
}

/** Poll the gateway `status` once on connect. Returns nulls until the first
 *  response so the UI doesn't flicker the "Update" badge on boot. */
function useVersionStatus(): VersionStatus {
  const { connected, request } = useGateway();
  const [state, setState] = useState<VersionStatus>({ current: null, updateAvailable: null });

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    request<{ version?: string; updateAvailable?: boolean }>('status')
      .then((r) => {
        if (cancelled) return;
        setState({
          current: typeof r.version === 'string' && r.version !== 'unknown' ? r.version : null,
          updateAvailable: Boolean(r.updateAvailable),
        });
      })
      .catch(() => {
        if (!cancelled) setState({ current: null, updateAvailable: false });
      });
    return () => { cancelled = true; };
  }, [connected, request]);

  return state;
}

/**
 * GitHub docs URL for the "Expose to internet" hint. Opening in a new tab
 * (rather than embedding tunneling recipes in-app) keeps Ghost itself from
 * suggesting any particular network-exposure strategy — users follow the
 * canonical docs and make their own choice.
 */
const NETWORK_EXPOSURE_DOCS_URL =
  'https://github.com/hyperflowdotfun/ghost/blob/main/docs/security/network-exposure.md';

export function SystemMenuDropdown() {
  const [open, setOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [tweetsVisible, setTweetsVisible] = useState(readTweetsVisible);
  const containerRef = useRef<HTMLDivElement>(null);
  const { current: currentVersion, updateAvailable } = useVersionStatus();

  useEffect(() => subscribeWidgetVisibility(() => setTweetsVisible(readTweetsVisible())), []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggleTweets = useCallback(() => {
    setWidgetHidden('tweets', tweetsVisible /* now visible → hide */, DEFAULT_ORDER);
  }, [tweetsVisible]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="System menu"
        aria-expanded={open}
        className={BTN_CLS}
      >
        <img src={settingsIcon} alt="" className="w-[18px] h-[18px]" />
      </button>
      <Popover
        open={open}
        origin="top-right"
        onEscape={() => setOpen(false)}
        initialFocus="first"
        className={
          'absolute right-0 top-[calc(100%+8px)] z-50 min-w-[260px] ' +
          'bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] ' +
          'drop-shadow-[0_16px_19px_rgba(0,0,0,0.45)] rounded-[4px] ' +
          'px-[14px] py-3 flex flex-col gap-3'
        }
        role="menu"
        aria-label="System menu"
      >
        <div className="flex flex-col gap-4 pb-4 border-b border-[var(--color-border-subtle)] w-full">
          <MenuItem
            icon={<XLogoIcon />}
            label="Show X"
            onClick={toggleTweets}
            trailing={<ToggleSwitch on={tweetsVisible} />}
          />
          <MenuItem
            icon={<MouseCircleIcon />}
            label="Expose to internet"
            onClick={() => {
              setOpen(false);
              window.open(NETWORK_EXPOSURE_DOCS_URL, '_blank', 'noopener,noreferrer');
            }}
          />
        </div>
        <VersionRow
          label={currentVersion ? `Version ${currentVersion}` : 'Version'}
          updateAvailable={Boolean(updateAvailable)}
          onUpdateClick={() => { setOpen(false); setUpdateOpen(true); }}
        />
      </Popover>
      <UpdateAvailableModal open={updateOpen} onClose={() => setUpdateOpen(false)} />
    </div>
  );
}

interface MenuItemProps {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}

function MenuItem({ icon, label, trailing, onClick, disabled = false }: MenuItemProps) {
  const baseCls =
    'flex items-center justify-between gap-2 w-full bg-transparent border-none p-0 text-left ' +
    'transition-colors duration-fast ease-out';
  const enabledCls =
    'cursor-pointer text-text-secondary hover:text-text-primary focus-visible:text-text-primary btn-press';
  const disabledCls = 'cursor-not-allowed text-text-tertiary';

  return (
    <button
      type="button"
      role="menuitem"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      title={disabled ? 'Coming soon' : undefined}
      className={`${baseCls} ${disabled ? disabledCls : enabledCls}`}
    >
      <span className="flex items-center gap-2">
        <span className="inline-flex shrink-0 size-4 items-center justify-center">
          {icon}
        </span>
        <span className={disabled ? 'text-body-sm' : 'text-body-sm text-text-primary'}>{label}</span>
      </span>
      {trailing}
    </button>
  );
}

/** Figma 888:10158 — 29×16 pill, mint when on, neutral-700 when off; 14×14 white knob. */
function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={
        'inline-flex shrink-0 items-center w-[29px] h-[16px] rounded-[9px] p-px transition-colors duration-fast ease-out ' +
        (on ? 'bg-[var(--color-brand-default)]' : 'bg-[#2a2c31]')
      }
      aria-hidden="true"
    >
      <span
        className="size-[14px] rounded-[8px] bg-white transition-transform duration-fast ease-out"
        style={{ transform: on ? 'translateX(13px)' : 'translateX(0)' }}
      />
    </span>
  );
}

function XLogoIcon() {
  // 𝕏 logo — matches the existing Tweets sidebar icon convention.
  return (
    <svg width="14" height="13" viewBox="0 0 14 13" fill="none" aria-hidden="true">
      <path
        d="M8.246 5.529L13.41 0H12.187L7.701 4.78 4.116 0H0l5.42 7.226L0 13h1.224l4.74-5.04L9.762 13H14L8.246 5.529ZM6.587 7.298l-.55-.717-4.37-5.687H3.55l3.531 4.595.55.717 4.586 5.965h-1.882L6.587 7.298Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface VersionRowProps {
  label: string;
  updateAvailable: boolean;
  onUpdateClick: () => void;
}

/** Bottom row of the system menu. Always shows the installed version with
 *  the primary text color (matches "Show X" / "Expose to internet" above).
 *  When an update is available, the whole row becomes clickable and gets an
 *  "Update" badge on the right. */
function VersionRow({ label, updateAvailable, onUpdateClick }: VersionRowProps) {
  const content = (
    <>
      <span className="flex items-center gap-2">
        <span className="inline-flex shrink-0 size-4 items-center justify-center text-text-secondary">
          <InfoCircleIcon />
        </span>
        <span className="text-body-sm text-text-primary">{label}</span>
      </span>
      {updateAvailable && <UpdateBadge />}
    </>
  );

  if (!updateAvailable) {
    return (
      <div className="flex items-center justify-between gap-2 w-full">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      onClick={onUpdateClick}
      className="flex items-center justify-between gap-2 w-full bg-transparent border-none p-0 text-left cursor-pointer transition-colors duration-fast ease-out btn-press"
    >
      {content}
    </button>
  );
}

function UpdateBadge() {
  return (
    <span
      className={
        'inline-flex items-center justify-center h-5 px-[7px] rounded-[2px] ' +
        'bg-[var(--color-warning-subtle)] text-warning-text text-footnote whitespace-nowrap'
      }
    >
      Update
    </span>
  );
}

function MouseCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M10.9133 15.18C10.9066 15.18 10.9066 15.18 10.9 15.18C10.2266 15.1733 9.66664 14.76 9.46664 14.1134L8.23331 10.1467C8.06664 9.60001 8.20664 9.01334 8.61331 8.62C9.01331 8.22667 9.59331 8.08 10.1266 8.24667L14.1 9.48001C14.74 9.68001 15.16 10.24 15.1666 10.9133C15.1733 11.58 14.7666 12.1467 14.1266 12.36L13.04 12.7267C12.8866 12.78 12.7666 12.8933 12.72 13.0467L12.3466 14.14C12.14 14.7733 11.58 15.18 10.9133 15.18ZM9.67331 9.18C9.49331 9.18 9.37331 9.28 9.31998 9.32667C9.17998 9.46667 9.13331 9.66001 9.19331 9.85334L10.4266 13.82C10.5333 14.16 10.8266 14.1733 10.92 14.18C11.0133 14.18 11.3 14.1533 11.4066 13.8267L11.78 12.7333C11.9266 12.2867 12.2866 11.9334 12.7333 11.78L13.82 11.4133C14.1533 11.3067 14.1733 11.0134 14.1733 10.9267C14.1733 10.84 14.1466 10.5467 13.8133 10.44L9.83998 9.20667C9.77331 9.18667 9.71998 9.18 9.67331 9.18Z" fill="currentColor" />
      <path d="M8.00016 15.1667C4.04683 15.1667 0.833496 11.9533 0.833496 8C0.833496 4.04667 4.04683 0.833336 8.00016 0.833336C11.9535 0.833336 15.1668 4.04667 15.1668 8C15.1668 8.27334 14.9402 8.5 14.6668 8.5C14.3935 8.5 14.1668 8.27334 14.1668 8C14.1668 4.6 11.4002 1.83334 8.00016 1.83334C4.60016 1.83334 1.8335 4.6 1.8335 8C1.8335 11.4 4.60016 14.1667 8.00016 14.1667C8.2735 14.1667 8.50016 14.3933 8.50016 14.6667C8.50016 14.94 8.2735 15.1667 8.00016 15.1667Z" fill="currentColor" />
    </svg>
  );
}

function InfoCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8.00016 15.1667C4.04683 15.1667 0.833496 11.9533 0.833496 7.99999C0.833496 4.04666 4.04683 0.833328 8.00016 0.833328C11.9535 0.833328 15.1668 4.04666 15.1668 7.99999C15.1668 11.9533 11.9535 15.1667 8.00016 15.1667ZM8.00016 1.83333C4.60016 1.83333 1.8335 4.59999 1.8335 7.99999C1.8335 11.4 4.60016 14.1667 8.00016 14.1667C11.4002 14.1667 14.1668 11.4 14.1668 7.99999C14.1668 4.59999 11.4002 1.83333 8.00016 1.83333Z" fill="currentColor" />
      <path d="M8 9.16666C7.72667 9.16666 7.5 8.93999 7.5 8.66666V5.33333C7.5 5.05999 7.72667 4.83333 8 4.83333C8.27333 4.83333 8.5 5.05999 8.5 5.33333V8.66666C8.5 8.93999 8.27333 9.16666 8 9.16666Z" fill="currentColor" />
      <path d="M8.00016 11.3333C7.9135 11.3333 7.82683 11.3133 7.74683 11.28C7.66683 11.2467 7.5935 11.2 7.52683 11.14C7.46683 11.0733 7.42016 11.0067 7.38683 10.92C7.3535 10.84 7.3335 10.7533 7.3335 10.6667C7.3335 10.58 7.3535 10.4933 7.38683 10.4133C7.42016 10.3333 7.46683 10.26 7.52683 10.1933C7.5935 10.1333 7.66683 10.0867 7.74683 10.0533C7.90683 9.98668 8.0935 9.98668 8.2535 10.0533C8.3335 10.0867 8.40683 10.1333 8.4735 10.1933C8.5335 10.26 8.58016 10.3333 8.6135 10.4133C8.64683 10.4933 8.66683 10.58 8.66683 10.6667C8.66683 10.7533 8.64683 10.84 8.6135 10.92C8.58016 11.0067 8.5335 11.0733 8.4735 11.14C8.40683 11.2 8.3335 11.2467 8.2535 11.28C8.1735 11.3133 8.08683 11.3333 8.00016 11.3333Z" fill="currentColor" />
    </svg>
  );
}
