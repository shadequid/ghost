import { useState, useEffect, useCallback } from 'react';
import { useGateway } from '@/hooks/useGateway';
import { TerminalModal } from '@/components/TerminalModal';
import { AlertBox } from '@/components/AlertBox';

interface TelegramSetupModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Optional seed status so the body doesn't flash the setup form
   *  during the first refresh after opening. */
  initialStatus?: TelegramStatus | null;
}

interface TelegramStatus {
  enabled: boolean;
  healthy: boolean;
  summary: string;
  detail: { dmPolicy?: string; bot?: string; tokenPresent?: boolean };
  running: boolean;
  pendingCount: number;
  error?: string;
}

interface PairingRequest {
  code: string;
  senderId: string;
  username: string | null;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

interface AllowlistEntry {
  identity: string;
  identityKind: 'id' | 'username';
  /** Telegram handle captured at approve time. `null` when unknown. */
  displayName: string | null;
  addedAt: number;
}

function formatAge(ms: number): string {
  if (ms < 0) return 'just now';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Map a gateway error message to user-friendly copy.
 *
 * Daemon serializes typed errors as JSON `{ code, message }` so the UI maps
 * a stable code to localized text. Falls back to substring matching
 * for legacy/untyped errors.
 */
function friendlyTokenError(raw: string): string {
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { code?: string; message?: string };
      switch (parsed.code) {
        case 'telegram_unauthorized':
        case 'telegram_invalid_token':
          return 'Bot token is invalid — check with @BotFather';
        case 'telegram_unreachable':
          return "Couldn't reach Telegram, try again";
        case 'telegram_already_registered':
          return parsed.message ?? 'Telegram is already connected.';
        case 'locality_required':
          return parsed.message ?? 'This action is only available from a local browser session.';
        case 'telegram_unknown':
        default:
          return parsed.message ?? raw;
      }
    } catch {
      // Not actually JSON — fall through to legacy matching below.
    }
  }
  const lower = raw.toLowerCase();
  if (lower.includes('rejected') || lower.includes('unauthorized') || lower.includes('401')) {
    return 'Bot token is invalid — check with @BotFather';
  }
  if (lower.includes('timeout') || lower.includes('fetch') || lower.includes('network')) {
    return "Couldn't reach Telegram, try again";
  }
  return raw;
}

/**
 * Numbered Connect-Telegram instruction steps — blue circular badge + text
 * with link-colored inline tokens (Figma 444:3563).
 */
function TelegramSteps() {
  const Badge = ({ n }: { n: number }) => (
    <span className="bg-[#0d8eff] flex items-center justify-center rounded-full w-[18px] h-[18px] flex-none text-label-sm text-white">
      {n}
    </span>
  );
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div className="size-[38px] rounded-[4px] bg-[rgba(13,142,255,0.1)] border border-[rgba(13,142,255,0.2)] flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d="M14.6433 4.81891C14.1523 5.10474 13.6653 5.39499 13.1797 5.68914C12.2722 6.23924 11.3579 6.8161 10.4253 7.34749C9.57263 7.83288 8.77152 8.38376 7.92063 8.87123C7.00368 9.39716 5.87371 9.95219 4.74374 9.65961C3.1436 9.24463 1.89394 9.07131 0.720713 8.66673C-0.453104 8.26267 -0.0338837 7.56394 0.846034 7.19677C1.72625 6.82909 11.4489 3.15329 11.4489 3.15329L17.5257 0.948226C18.0533 0.767632 18.5801 0.586259 19.1066 0.403326C19.4615 0.280159 19.8102 0.14192 20.1832 0.0673438C20.6057 -0.0171066 21.1099 -0.0563435 21.4918 0.160369C22.0384 0.470107 22.0378 1.14519 21.9679 1.6467C21.8325 2.62398 21.6654 3.59841 21.5004 4.57232C21.2818 5.85986 21.0557 7.14662 20.827 8.43287C20.624 9.57464 20.4184 10.7159 20.2113 11.8569C20.062 12.6803 19.9912 13.5293 19.7918 14.3436C19.7018 14.7118 19.564 15.0826 19.3249 15.3989C18.3226 16.7233 16.4437 15.5415 15.4159 14.8792C14.5689 14.3332 10.9802 12.2973 10.0914 11.7514C9.77409 11.5562 9.52582 11.2156 9.52937 10.8708C9.53411 10.3955 9.91896 10.0361 10.2929 9.73236C10.7518 9.35922 11.2261 8.99985 11.6818 8.62308C12.3658 8.05739 13.0496 7.49144 13.734 6.92549C14.3212 6.43958 14.9087 5.95392 15.4956 5.46827C15.82 5.20011 16.1279 4.92181 16.4152 4.62195C16.5018 4.53178 16.5619 4.46006 16.5717 4.34157C16.5785 4.25712 16.5589 4.17371 16.4864 4.11343C16.2165 3.89126 15.8817 4.11161 15.6396 4.24829C15.306 4.43668 14.9745 4.62688 14.6439 4.81943L14.6433 4.81891Z" fill="#00AEED" />
        </svg>
      </div>
      <div className="flex flex-col gap-4 w-full">
        <div className="flex items-center gap-1.5">
          <Badge n={1} />
          <p className="text-body-sm text-text-primary m-0">
            Open <span className="text-[#40a6ff]">@BotFather</span> on Telegram
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge n={2} />
          <p className="text-body-sm text-text-primary m-0">
            Send <span className="text-[#40a6ff]">/newbot</span> and copy the bot token
          </p>
        </div>
      </div>
    </div>
  );
}

export function TelegramSetupModal({ open, onClose, onSuccess, initialStatus }: TelegramSetupModalProps) {
  const { request, subscribe } = useGateway();
  const [status, setStatus] = useState<TelegramStatus | null>(initialStatus ?? null);
  const [requests, setRequests] = useState<PairingRequest[]>([]);
  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [, forceTick] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const [s, p, a] = await Promise.all([
        request<TelegramStatus>('channels.status', { id: 'telegram', probe: true }),
        request<{ requests: PairingRequest[] }>('channels.pairing.list', { id: 'telegram' }),
        request<{ entries: AllowlistEntry[] }>('channels.allowlist.list', { id: 'telegram' }),
      ]);
      setStatus(s);
      setRequests(p.requests);
      setAllowlist(a.entries);
    } catch {
      // Silent — section stays in last-known state until next event.
    }
  }, [request]);

  // Reset transient form state and kick off a fresh fetch only on the
  // open→true edge. Including `initialStatus` / `refresh` in deps would
  // wipe `msg` (and re-trigger refresh) every time the parent re-renders
  // — that's how a successful approve was momentarily reverting to the
  // initial loading state.
  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setToken('');
    if (initialStatus) setStatus(initialStatus);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live updates from pairing event stream + channel-state events.
  useEffect(() => {
    if (!open) return;
    return subscribe((evt) => {
      if (
        evt.event === 'pairing.request.created' ||
        evt.event === 'pairing.request.approved' ||
        evt.event === 'pairing.request.removed' ||
        evt.event === 'pairing.allowlist.removed'
      ) {
        const payload = evt.payload as { channel?: string } | undefined;
        if (payload?.channel === 'telegram') void refresh();
      } else if (evt.event === 'channel.state.changed') {
        const payload = evt.payload as { channel?: string } | undefined;
        if (payload?.channel === 'telegram') void refresh();
      }
    });
  }, [open, subscribe, refresh]);

  // Tick every 30s so age labels stay accurate without re-querying.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [open]);

  const statusLoaded = status !== null;
  const connected = (status?.enabled && status.healthy) ?? false;
  const bot = status?.detail.bot;
  const tokenValid = token.trim().length > 0;

  const handleConnect = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setMsg({ ok: false, text: 'Bot token is required' });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await request<{ ok: boolean; summary: string }>(
        'channels.setup',
        { id: 'telegram', token: trimmed },
      );
      // Connected state pill is the success affordance — no toast needed.
      setToken('');
      onSuccess?.();
      await refresh();
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : 'Connect failed';
      setMsg({ ok: false, text: friendlyTokenError(text) });
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await request('channels.remove', { id: 'telegram' });
      // Connection state pill disappears once refresh runs — no toast needed.
      await refresh();
    } catch (err: unknown) {
      const text = err instanceof Error ? err.message : 'Disconnect failed';
      setMsg({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (code: string) => {
    setBusy(true);
    try {
      const res = await request<{ ok: boolean; reason?: string; notified?: boolean; notifyError?: string | null; username?: string | null }>(
        'channels.pairing.approve',
        { id: 'telegram', code, notify: true },
      );
      if (!res.ok) {
        setMsg({ ok: false, text: 'Code already expired or approved' });
      } else if (res.notifyError) {
        // Approval succeeded but DM failed — surface a warning. Happy
        // path stays silent; the row disappearing from the list is the
        // affordance.
        const target = requests.find((r) => r.code === code);
        const label = target?.username ? `@${target.username}` : `id:${target?.senderId ?? '?'}`;
        setMsg({ ok: true, text: `Approved ${label} but DM failed: ${res.notifyError}` });
      } else {
        setMsg(null);
      }
      await refresh();
    } catch (err: unknown) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Approve failed' });
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (identity: string) => {
    // Optimistic — drop the row immediately; restore + show error if the
    // server rejects.
    const prev = allowlist;
    setAllowlist((list) => list.filter((e) => e.identity !== identity));
    try {
      const res = await request<{ ok: boolean }>(
        'channels.allowlist.remove',
        { id: 'telegram', identity },
      );
      if (!res.ok) {
        setAllowlist(prev);
        setMsg({ ok: false, text: 'User was not on the authorized list' });
      }
      // No refresh needed — server emits pairing.allowlist.removed which
      // triggers refresh via the subscribe handler.
    } catch (err: unknown) {
      setAllowlist(prev);
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Revoke failed' });
    }
  };

  const connectDisabled = busy || !tokenValid;
  const now = Date.now();

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setToken(text.trim());
        setMsg(null);
      }
    } catch {
      setMsg({ ok: false, text: 'Clipboard read denied — paste manually' });
    }
  };

  // Custom Figma-styled chrome (white 16px title, no mint-terminal header)
  // is used for all three states so the modal does not visibly re-shell when
  // status resolves or the user disconnects.
  const setupMode = !connected;
  const showLoading = open && !statusLoaded;

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title="Connect your Telegram Bot"
      width={450}
      hideHeader
      cardClassName="bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      bodyClassName={
        showLoading
          ? 'flex items-center justify-center p-6 min-h-[260px]'
          : setupMode
            ? 'flex flex-col items-end gap-4 px-4 pt-4 pb-5'
            : 'flex flex-col gap-3 px-4 pt-4 pb-5'
      }
    >
      {!showLoading && (
        <div className="flex items-center justify-between w-full">
          <span className="text-body-lg-semibold text-white">Connect your Telegram Bot</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="w-7 h-7 inline-flex items-center justify-center rounded-[6px] bg-transparent border-none cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press transition-colors duration-fast ease-out"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {showLoading ? (
        <span
          className="inline-flex gap-1.5 text-[var(--color-text-secondary)]"
          aria-label="Loading"
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-current"
              style={{ animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
            />
          ))}
        </span>
      ) : connected ? (
        <a
          href={bot ? `https://t.me/${bot}` : undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 bg-[rgba(0,184,255,0.04)] border border-[rgba(0,184,255,0.12)] rounded-[4px] text-body-sm text-[var(--color-text-secondary)] btn-press transition-colors duration-fast ease-out hover:border-[rgba(0,184,255,0.3)] hover:text-[var(--color-text-primary)] focus-visible:border-[rgba(0,184,255,0.3)] focus-visible:text-[var(--color-text-primary)] outline-none no-underline"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" className="flex-shrink-0 fill-[#00b8ff] opacity-90">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0Zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.231-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
          <span className="flex-1 truncate">
            DM <span className="text-[#00b8ff]">{bot ? `@${bot}` : 'the bot'}</span> to request pairing
          </span>
          <span className="opacity-60 flex-shrink-0" aria-hidden="true">↗</span>
        </a>
      ) : (
        <>
          <TelegramSteps />

          <div className="flex flex-col gap-1 pl-6 w-full">
            <label htmlFor="telegram-token-input" className="text-body-sm text-[var(--color-text-secondary)]">
              Bot token
            </label>
            <div className="flex items-center bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] rounded-[4px] h-9 px-4 w-full focus-within:border-[var(--color-brand-default)] transition-colors duration-fast ease-out">
              <input
                id="telegram-token-input"
                // H9: bot token grants full impersonation — treat as a secret.
                // password type masks input; autoComplete=off + spellCheck=false
                // stop browsers from saving / underlining the value.
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={token}
                onChange={(e) => { setToken(e.target.value); setMsg(null); }}
                placeholder="1234567890:ABC"
                onKeyDown={(e) => { if (e.key === 'Enter' && !connectDisabled) handleConnect(); }}
                className="flex-1 min-w-0 bg-transparent border-none outline-none focus:outline-none focus-visible:outline-none text-body-sm text-text-primary placeholder:text-[var(--color-text-muted)]"
              />
              <button
                type="button"
                onClick={handlePaste}
                aria-label="Paste from clipboard"
                title="Paste from clipboard"
                className="ml-3 bg-transparent border-none cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-fast ease-out flex-none inline-flex items-center"
              >
                <svg width="15" height="16" viewBox="0 0 15 16" fill="none" aria-hidden="true">
                  <rect x="3.5" y="2" width="8" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
                  <rect x="5" y="0.6" width="5" height="2.4" rx="0.6" stroke="currentColor" strokeWidth="1.2" fill="currentColor" />
                </svg>
              </button>
            </div>
            <p className="text-body-sm text-[var(--color-text-secondary)] m-0">
              Token is stored encrypted on this device. Ghost validates with Telegram before saving.
            </p>
          </div>

          <button
            onClick={handleConnect}
            disabled={connectDisabled}
            className={
              'bg-[var(--color-brand-default)] hover:bg-[var(--color-brand-hover)] ' +
              'h-9 px-3 rounded-[4px] flex items-center justify-center ' +
              'text-body-md-semibold text-[var(--color-text-on-brand)] ' +
              'border-none cursor-pointer btn-press transition-colors duration-fast ease-out ' +
              'disabled:cursor-default disabled:opacity-60'
            }
          >{busy ? (
            <span className="inline-flex items-center gap-1.5">
              <span data-pulse-dots className="inline-flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-[3px] h-[3px] rounded-full bg-[color:currentColor]"
                    style={{ animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
                  />
                ))}
              </span>
              Connecting
            </span>
          ) : 'Connect'}</button>
        </>
      )}
      {msg && (
        <div className={setupMode ? 'w-full' : 'mt-2'}>
          <AlertBox
            kind={msg.ok ? 'success' : 'error'}
            text={msg.text}
            onClose={() => setMsg(null)}
          />
        </div>
      )}

      {connected && (
        <>
          {/* Users — pending requests + approved entries merged into a
              single list per Figma 997:4839. Each row is a 40px-tall pill
              with a green status dot, the @handle, and the action on the
              right (Approve link for pending, × for approved). Rows
              stack flush with -1px collapse so the borders share a hair. */}
          <div className="flex flex-col items-start gap-[5px] w-full">
            <span className="text-body-sm text-text-primary">Users</span>
            {(requests.length === 0 && allowlist.length === 0) ? (
              <div className="bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] h-10 flex items-center justify-center px-4 w-full">
                <span className="text-body-sm text-text-secondary">No users yet — share the bot to start pairing</span>
              </div>
            ) : (
              <div className="flex flex-col items-start w-full">
                {requests.map((r, idx) => {
                  const label = r.username ? `@${r.username}` : `id:${r.senderId}`;
                  const isLast = idx === requests.length - 1 && allowlist.length === 0;
                  return (
                    <div
                      key={`pending:${r.code}`}
                      className={
                        'bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] ' +
                        'flex h-10 items-center justify-between px-4 w-full ' +
                        (isLast ? '' : '-mb-px')
                      }
                      title={`Pending · ${formatAge(now - r.createdAt)} · code ${r.code}`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="status-dot-live w-[7px] h-[7px] rounded-full bg-[var(--color-brand-default)] flex-shrink-0" aria-hidden="true" />
                        <span className="text-body-md text-text-primary truncate">{label}</span>
                      </span>
                      <button
                        onClick={() => handleApprove(r.code)}
                        disabled={busy}
                        className={
                          'bg-transparent border-none cursor-pointer btn-press ' +
                          'text-body-md-semibold text-[var(--color-brand-default)] ' +
                          'transition-opacity duration-fast ease-out ' +
                          'hover:opacity-80 disabled:cursor-default disabled:opacity-60'
                        }
                      >Approve</button>
                    </div>
                  );
                })}
                {allowlist.map((e, idx) => {
                  const label = e.identityKind === 'username'
                    ? `@${e.identity}`
                    : e.displayName
                      ? `@${e.displayName}`
                      : `id:${e.identity}`;
                  const isLast = idx === allowlist.length - 1;
                  return (
                    <div
                      key={`approved:${e.identityKind}:${e.identity}`}
                      className={
                        'bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] ' +
                        'flex h-10 items-center justify-between px-4 w-full ' +
                        (isLast ? '' : '-mb-px')
                      }
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="status-dot-live w-[7px] h-[7px] rounded-full bg-[var(--color-brand-default)] flex-shrink-0" aria-hidden="true" />
                        <span className="text-body-md text-text-primary truncate">{label}</span>
                      </span>
                      <button
                        onClick={() => handleRevoke(e.identity)}
                        aria-label={`Revoke ${label}`}
                        title={`Revoke ${label}`}
                        className={
                          'inline-flex items-center justify-center w-[18px] h-[18px] ' +
                          'bg-transparent border-none cursor-pointer ' +
                          'text-text-secondary hover:text-[var(--color-error-default)] ' +
                          'transition-colors duration-fast ease-out flex-shrink-0'
                        }
                      >
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                          <path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end mt-2 w-full">
            <button
              onClick={handleDisconnect}
              disabled={busy}
              className={
                'h-9 px-4 inline-flex items-center justify-center rounded-[4px] ' +
                'bg-transparent border border-[var(--color-border-subtle)] ' +
                'text-body-md-semibold text-[var(--color-error-text)] cursor-pointer btn-press ' +
                'transition-colors duration-fast ease-out ' +
                'hover:border-[var(--color-error-default)] hover:text-[var(--color-error-default)] ' +
                'focus-visible:border-[var(--color-error-default)] ' +
                'disabled:cursor-default disabled:opacity-60'
              }
            >Disconnect</button>
          </div>
        </>
      )}
    </TerminalModal>
  );
}
