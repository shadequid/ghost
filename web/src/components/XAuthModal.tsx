import { useState, useEffect, useCallback } from 'react';
import { useGateway } from '@/hooks/useGateway';
import { TerminalModal } from '@/components/TerminalModal';
import { AlertBox } from '@/components/AlertBox';
import xLogo from '@/assets/xauth-x-logo.svg';
import closeIcon from '@/assets/xauth-close.svg';
import checkboxCheckedIcon from '@/assets/xauth-checkbox-checked.svg';

interface XAuthModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface FollowRow {
  username: string;
  displayName?: string | null;
  enabled?: boolean;
  source?: 'following' | 'manual';
}

interface SearchResult {
  followed: FollowRow[];
  notFollow: { username: string; displayName?: string | null }[];
}

const INPUT_CLS =
  'w-full bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] rounded-[4px] ' +
  'h-9 px-4 pr-10 text-body-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none ' +
  'focus:outline-none focus-visible:outline-none';

// Known X API error codes → friendly messages.
const X_ERROR_OVERRIDES: Record<number, string> = {
  32: 'auth_token missing or expired. Re-copy from x.com cookies.',
  353: 'Token or ct0 is invalid. Copy both values from x.com cookies and try again.',
};

function parseXError(raw: string): string {
  if (!raw) return 'Failed';
  const cleaned = raw.replace(/^HTTP\s+\d+(:\s*)?/i, '').trim();
  const jsonStart = cleaned.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(cleaned.slice(jsonStart)) as {
        errors?: Array<{ code?: number; message?: string }>;
      };
      const errors = parsed.errors;
      if (Array.isArray(errors) && errors.length > 0) {
        const parts = errors.map((e) => {
          if (typeof e?.code === 'number' && X_ERROR_OVERRIDES[e.code]) {
            return X_ERROR_OVERRIDES[e.code];
          }
          return e?.message ?? '';
        }).filter(Boolean);
        if (parts.length > 0) return parts.join(' · ');
      }
    } catch { /* fall through */ }
  }
  const stripped = cleaned.replace(/\{.*\}$/s, '').trim();
  return stripped || cleaned || 'Failed';
}

interface StepRowProps {
  num: number;
  children: React.ReactNode;
}

function StepRow({ num, children }: StepRowProps) {
  return (
    <div className="flex items-center gap-2 w-full">
      <span className="flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[#0d8eff] border border-[rgba(13,142,255,0.2)] text-white text-label-sm leading-none flex-shrink-0">
        {num}
      </span>
      <span className="text-body-sm text-[var(--color-text-primary)]">{children}</span>
    </div>
  );
}

interface PasteFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
}

function PasteField({ id, label, value, placeholder, onChange, onSubmit }: PasteFieldProps) {
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onChange(text.trim());
    } catch {
      /* clipboard permission denied — user can still paste manually */
    }
  };

  return (
    <div className="flex flex-col gap-1 pl-6 w-full">
      <label htmlFor={id} className="text-body-sm text-[var(--color-text-secondary)]">
        {label}
      </label>
      <div className="relative w-full">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onSubmit) onSubmit(); }}
          placeholder={placeholder}
          className={INPUT_CLS}
        />
        <button
          type="button"
          onClick={handlePaste}
          aria-label="Paste from clipboard"
          title="Paste from clipboard"
          className="absolute right-3 top-1/2 -translate-y-1/2 bg-transparent border-0 p-0 cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors duration-fast ease-out inline-flex items-center"
        >
          <svg width="15" height="16" viewBox="0 0 15 16" fill="none" aria-hidden="true">
            <rect x="3.5" y="2" width="8" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none" />
            <rect x="5" y="0.6" width="5" height="2.4" rx="0.6" stroke="currentColor" strokeWidth="1.2" fill="currentColor" />
          </svg>
        </button>
      </div>
    </div>
  );
}

interface FollowerRowProps {
  label: string;
  subtitle?: string;
  checked: boolean;
  disabled?: boolean;
  onToggle: () => void;
  withBottomBorder: boolean;
}

function FollowerRow({ label, subtitle, checked, disabled, onToggle, withBottomBorder }: FollowerRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={checked}
      className={`flex items-center justify-between w-full py-4 bg-transparent border-0 text-left cursor-pointer disabled:cursor-default ${withBottomBorder ? 'border-b border-dashed border-[var(--color-border-subtle)]' : ''}`}
    >
      <div className="flex flex-col gap-2">
        <span className={`text-body-md ${subtitle ? 'text-[#c8d1db]' : 'text-[var(--color-text-primary)]'}`}>{label}</span>
        {subtitle ? (
          <span className="text-label-sm text-[var(--color-text-secondary)]">{subtitle}</span>
        ) : null}
      </div>
      {checked ? (
        <img src={checkboxCheckedIcon} alt="" className="w-3.5 h-3.5 flex-shrink-0" />
      ) : (
        <span
          aria-hidden="true"
          className="w-3.5 h-3.5 rounded-[2px] border border-[var(--color-text-secondary)] flex-shrink-0"
        />
      )}
    </button>
  );
}

/** Result row in the search-active view — read-only handle on the left,
 *  green check icon (already tracked) or green "Add" link (not yet tracked)
 *  on the right. */
interface SearchResultRowProps {
  handle: string;
  action: 'tracked' | 'add';
  busy?: boolean;
  error?: string | null;
  onAdd?: () => void;
  withBottomBorder: boolean;
}

function SearchResultRow({ handle, action, busy, error, onAdd, withBottomBorder }: SearchResultRowProps) {
  return (
    <div
      className={`flex items-center justify-between w-full py-3 ${withBottomBorder ? 'border-b border-dashed border-[var(--color-border-subtle)]' : ''}`}
    >
      <div className="flex flex-col min-w-0">
        <span className="text-body-md text-[var(--color-text-primary)] truncate">{`@${handle}`}</span>
        {error ? (
          <span className="text-label-sm text-[var(--color-text-danger,#ef4444)] truncate">{error}</span>
        ) : null}
      </div>
      {action === 'tracked' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-label="Already followed" className="flex-shrink-0">
          <path d="M3 8.5l3 3 7-7" stroke="#3DDC97" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={busy}
          className="text-body-sm text-[#3DDC97] bg-transparent border-0 p-0 cursor-pointer disabled:opacity-50 disabled:cursor-default hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      )}
    </div>
  );
}

export function XAuthModal({ open, onClose, onSuccess }: XAuthModalProps) {
  const { request } = useGateway();
  const [authToken, setAuthToken] = useState('');
  const [ct0, setCt0] = useState('');
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [authUser, setAuthUser] = useState<{ screenName: string; name: string } | null>(null);
  const [hasAuth, setHasAuth] = useState(false);
  const [editing, setEditing] = useState(false);
  const [follows, setFollows] = useState<FollowRow[]>([]);
  const [query, setQuery] = useState('');
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState<string | null>(null);
  const [addError, setAddError] = useState<Record<string, string>>({});
  const [includeFollowing, setIncludeFollowing] = useState(false);
  const [includeFollowingBusy, setIncludeFollowingBusy] = useState(false);
  const [followingCount, setFollowingCount] = useState<number | null>(null);
  const [pendingToggle, setPendingToggle] = useState<Set<string>>(new Set());
  const [confirmingUnlink, setConfirmingUnlink] = useState(false);

  const refreshStatus = useCallback(() => {
    request<{
      hasAuth: boolean;
      authUser: { screenName: string; name: string } | null;
      follows: FollowRow[];
      includeFollowing: boolean;
      followingCount: number | null;
    }>('trading.tweets.status')
      .then((res) => {
        setHasAuth(res.hasAuth);
        setAuthToken('');
        setCt0('');
        setAuthUser(res.authUser);
        setFollows(res.follows ?? []);
        setIncludeFollowing(!!res.includeFollowing);
        setFollowingCount(res.followingCount ?? null);
      })
      .catch(() => {
        // Auth check fails on modal open → fall back to unauth state with an
        // inline error above "Connect X". Keep follows/includeFollowing at
        // their previous values so flicker is minimised.
        setMsg({ ok: false, text: 'Could not verify X session — try Connect again.' });
        setHasAuth(false);
      });
  }, [request]);

  const toggleIncludeFollowing = async () => {
    if (includeFollowingBusy) return;
    const next = !includeFollowing;
    setIncludeFollowingBusy(true);
    setIncludeFollowing(next);
    const res = await request<{ ok: boolean }>('trading.tweets.settings.set', { includeFollowing: next })
      .catch(() => ({ ok: false } as const));
    setIncludeFollowingBusy(false);
    if (!res.ok) setIncludeFollowing(!next);
    else refreshStatus();
  };

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setQuery('');
    setSearchResult(null);
    setSearchError(null);
    setAddError({});
    setEditing(false);
    setConfirmingUnlink(false);
    refreshStatus();
  }, [open, refreshStatus]);

  // Debounced search — fires `trading.tweets.follows.search` 350 ms after the
  // last keystroke, cancels in-flight requests when the query mutates, and
  // skips the round-trip on an empty / single-char query (server returns the
  // empty default anyway but we save the call).
  useEffect(() => {
    if (!hasAuth) return;
    const q = query.trim().replace(/^@/, '');
    if (q.length < 2) {
      setSearchResult(null);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await request<SearchResult>('trading.tweets.follows.search', { query: q });
        if (cancelled) return;
        setSearchResult(res);
        setSearchError(null);
      } catch {
        if (cancelled) return;
        setSearchResult({ followed: [], notFollow: [] });
        setSearchError('Search unavailable — try again');
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, hasAuth, request]);

  const testAndSave = async () => {
    if (!authToken.trim() || !ct0.trim()) return;
    setTesting(true); setMsg(null);
    const res = await request<{ ok: boolean; error?: string; user?: { screenName: string; name: string } }>(
      'trading.tweets.auth',
      { auth_token: authToken.trim(), ct0: ct0.trim() },
    ).catch(() => ({ ok: false, error: 'Connection error' } as const));
    setTesting(false);
    if (res.ok) {
      const user = 'user' in res ? res.user : undefined;
      setMsg({ ok: true, text: 'Authenticated successfully' });
      if (user) setAuthUser(user);
      setHasAuth(true);
      setEditing(false);
      onSuccess?.();
      refreshStatus();
    } else {
      const raw = 'error' in res ? res.error : undefined;
      setMsg({ ok: false, text: parseXError(raw ?? 'Failed') });
    }
  };

  // Flip a single account's enabled flag. Optimistic update with revert-on-
  // failure: the row redraws immediately, and only reverts if the RPC rejects.
  const toggleFollowEnabled = async (username: string, currentEnabled: boolean) => {
    if (pendingToggle.has(username)) return;
    const next = !currentEnabled;
    setPendingToggle((s) => new Set(s).add(username));
    setFollows((rows) => rows.map((r) => (r.username === username ? { ...r, enabled: next } : r)));
    const res = await request<{ ok: boolean; error?: string }>('trading.tweets.follows.setEnabled', {
      username,
      enabled: next,
    }).catch(() => ({ ok: false } as const));
    setPendingToggle((s) => {
      const n = new Set(s);
      n.delete(username);
      return n;
    });
    if (!res.ok) {
      setFollows((rows) => rows.map((r) => (r.username === username ? { ...r, enabled: currentEnabled } : r)));
    }
  };

  // Promote a "Not Follow" search result into the tracked list. Reuses the
  // existing add RPC (which calls X's UserByScreenName to validate the handle
  // server-side) — the failure path renders the error inline next to the row.
  const addFromSearch = async (username: string) => {
    const clean = username.replace(/^@/, '');
    if (!clean || addBusy) return;
    setAddBusy(clean);
    setAddError((m) => ({ ...m, [clean]: '' }));
    const res = await request<{ ok: boolean; error?: string }>('trading.tweets.follows.add', { username: clean })
      .catch(() => ({ ok: false, error: 'Connection error' } as const));
    setAddBusy(null);
    if (res.ok) {
      // Optimistically move the row into `followed` so the search view
      // re-renders without a round-trip; refreshStatus repopulates the
      // default list when the user clears the input.
      setSearchResult((cur) =>
        cur
          ? {
              followed: [...cur.followed, { username: clean, enabled: true, source: 'manual' }],
              notFollow: cur.notFollow.filter((u) => u.username.toLowerCase() !== clean.toLowerCase()),
            }
          : cur,
      );
      refreshStatus();
    } else {
      const err = ('error' in res ? res.error : null) ?? `@${clean} not found`;
      setAddError((m) => ({ ...m, [clean]: err }));
    }
  };

  const unlinkAuth = async () => {
    await request('trading.tweets.unlink').catch(() => {});
    setAuthUser(null);
    setHasAuth(false);
    setEditing(false);
    setConfirmingUnlink(false);
    setAuthToken('');
    setCt0('');
    setMsg(null);
    setQuery('');
    setSearchResult(null);
    refreshStatus();
  };

  const testSaveDisabled = testing || !authToken.trim() || !ct0.trim();
  const showSetup = !hasAuth || editing;
  const title = showSetup ? 'Connect your X.com account' : 'Manage follower';

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title={title}
      width={450}
      hideHeader
      cardClassName="bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px]"
      bodyClassName={showSetup ? 'flex flex-col gap-4 pt-4 pb-5 px-4' : 'flex flex-col gap-[13px] p-5'}
    >
      <div className="flex items-center justify-between w-full">
        <span className="text-body-lg-semibold text-white">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex items-center justify-center w-7 h-7 rounded-[4px] bg-transparent border-0 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none focus-visible:bg-[rgba(255,255,255,0.04)]"
        >
          <img src={closeIcon} alt="" className="w-[14px] h-[14px]" />
        </button>
      </div>

      {showSetup ? (
        <>
          <div className="flex flex-col items-center gap-3 w-full">
            <div className="flex items-center justify-center w-[38px] h-[38px] rounded-[10px] bg-[rgba(13,142,255,0.1)] border border-[rgba(13,142,255,0.2)]">
              <img src={xLogo} alt="" className="w-[18px] h-[16px]" />
            </div>
            <div className="flex flex-col gap-4 w-full">
              <StepRow num={1}>
                Open x.com and press F12 → Application → Cookies → https://x.com
              </StepRow>
              <StepRow num={2}>
                Copy auth_token and ct0 cookie values, then paste them below
              </StepRow>
            </div>
          </div>

          <PasteField
            id="xauth-auth_token-input"
            label="auth_token"
            value={authToken}
            placeholder="Paste auth_token"
            onChange={(v) => { setAuthToken(v); setMsg(null); }}
          />
          <PasteField
            id="xauth-ct0-input"
            label="ct0"
            value={ct0}
            placeholder="Paste ct0"
            onChange={(v) => { setCt0(v); setMsg(null); }}
            onSubmit={testAndSave}
          />

          <div className="flex justify-end gap-2 w-full">
            {hasAuth && editing && (
              <button
                onClick={() => { setEditing(false); setAuthToken(''); setCt0(''); setMsg(null); }}
                className="bg-transparent border border-[var(--color-border-default)] rounded-[4px] h-9 px-3 text-[var(--color-text-secondary)] text-body-sm cursor-pointer btn-press transition-colors duration-fast ease-out hover:border-muted-foreground hover:text-[var(--color-text-primary)] focus-visible:border-muted-foreground focus-visible:text-[var(--color-text-primary)]"
              >Cancel</button>
            )}
            <button
              type="button"
              onClick={testAndSave}
              disabled={testSaveDisabled}
              className="flex items-center justify-center h-9 px-3 rounded-[4px] bg-[var(--color-brand-default)] text-[var(--color-text-on-brand)] text-body-md-semibold cursor-pointer btn-press transition-opacity duration-fast ease-out hover:opacity-90 disabled:opacity-50 disabled:cursor-default"
            >
              {testing ? (
                <span className="inline-flex items-center gap-2">
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
              ) : 'Connect'}
            </button>
          </div>

          {msg && (
            <AlertBox
              kind={msg.ok ? 'success' : 'error'}
              text={msg.text}
              onClose={() => setMsg(null)}
            />
          )}
        </>
      ) : (
        <>
          {authUser && (
            <div className="flex flex-col w-full">
              <div className="flex items-center justify-between w-full h-8 px-3 py-[5px] rounded-[3px] bg-[rgba(13,142,255,0.1)] border border-dashed border-[rgba(13,142,255,0.2)]">
                <div className="flex items-center gap-2 min-w-0">
                  <img src={xLogo} alt="" className="w-4 h-3.5 flex-shrink-0" />
                  <span className="text-body-sm text-[var(--color-text-primary)] truncate">
                    Connected to <span className="text-[#40a6ff]">@{authUser.screenName}</span>
                  </span>
                </div>
                {confirmingUnlink ? (
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setConfirmingUnlink(false)}
                      className="text-body-sm text-[var(--color-text-secondary)] bg-transparent border-0 p-0 cursor-pointer hover:text-[var(--color-text-primary)] focus-visible:text-[var(--color-text-primary)] focus-visible:outline-none"
                    >Cancel</button>
                    <button
                      type="button"
                      onClick={unlinkAuth}
                      className="text-body-sm text-[var(--color-text-danger,#ef4444)] bg-transparent border-0 p-0 cursor-pointer hover:underline focus-visible:underline focus-visible:outline-none"
                    >Confirm</button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingUnlink(true)}
                    className="text-body-sm text-[var(--color-text-secondary)] bg-transparent border-0 p-0 cursor-pointer transition-colors duration-fast ease-out hover:text-[var(--color-text-primary)] focus-visible:text-[var(--color-text-primary)] focus-visible:outline-none"
                  >Unlink</button>
                )}
              </div>
              {confirmingUnlink && (
                <span className="mt-1 text-label-sm text-[var(--color-text-secondary)]">
                  Unlink @{authUser.screenName}? Tweets will stop ingesting from your following list.
                </span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1 w-full">
            <label htmlFor="xauth-search-input" className="text-body-sm text-[var(--color-text-secondary)]">
              Search Accounts
            </label>
            <input
              id="xauth-search-input"
              value={query}
              onChange={(e) => { setQuery(e.target.value); }}
              placeholder="@account"
              className="w-full h-9 bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] rounded-[4px] px-4 text-body-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:outline-none focus-visible:outline-none"
            />
          </div>

          {query.trim() === '' ? (
            // Default view: bulk row + per-account multi-select list.
            <div className="flex flex-col w-full max-h-[420px] overflow-y-auto pr-2" style={{ scrollbarGutter: 'stable' }}>
              <FollowerRow
                label={`Include accounts you follow on X.com (${followingCount ?? '—'} followed)`}
                subtitle="Auto-fetch tweets from your X.com following list."
                checked={includeFollowing}
                disabled={includeFollowingBusy}
                onToggle={toggleIncludeFollowing}
                withBottomBorder={follows.length > 0}
              />
              {follows.map((f, idx) => (
                <FollowerRow
                  key={f.username}
                  label={`@${f.username}`}
                  checked={f.enabled !== false}
                  disabled={pendingToggle.has(f.username)}
                  onToggle={() => toggleFollowEnabled(f.username, f.enabled !== false)}
                  withBottomBorder={idx < follows.length - 1}
                />
              ))}
            </div>
          ) : (
            // Search-active view: "Followed" (green check) + "Not Follow"
            // (green Add link) sub-sections. Hides the bulk row entirely.
            <div className="flex flex-col w-full max-h-[420px] overflow-y-auto pr-2" style={{ scrollbarGutter: 'stable' }}>
              {searchError ? (
                <span className="text-label-sm text-[var(--color-text-secondary)] py-3">{searchError}</span>
              ) : !searchResult ? (
                <span className="text-label-sm text-[var(--color-text-secondary)] py-3">Searching…</span>
              ) : searchResult.followed.length === 0 && searchResult.notFollow.length === 0 ? (
                <span className="text-label-sm text-[var(--color-text-secondary)] py-3">
                  No matches in your following list.
                </span>
              ) : (
                <>
                  {searchResult.followed.length > 0 && (
                    <>
                      <span className="text-label-sm text-[var(--color-text-secondary)] pt-3 pb-2">Followed</span>
                      {searchResult.followed.map((f, idx) => (
                        <SearchResultRow
                          key={`f-${f.username}`}
                          handle={f.username}
                          action="tracked"
                          withBottomBorder={idx < searchResult.followed.length - 1}
                        />
                      ))}
                    </>
                  )}
                  {searchResult.notFollow.length > 0 && (
                    <>
                      <span className="text-label-sm text-[var(--color-text-secondary)] pt-3 pb-2">Not Follow</span>
                      {searchResult.notFollow.map((u, idx) => (
                        <SearchResultRow
                          key={`n-${u.username}`}
                          handle={u.username}
                          action="add"
                          busy={addBusy === u.username}
                          error={addError[u.username] || null}
                          onAdd={() => addFromSearch(u.username)}
                          withBottomBorder={idx < searchResult.notFollow.length - 1}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {msg && (
            <AlertBox
              kind={msg.ok ? 'success' : 'error'}
              text={msg.text}
              onClose={() => setMsg(null)}
            />
          )}
        </>
      )}
    </TerminalModal>
  );
}
