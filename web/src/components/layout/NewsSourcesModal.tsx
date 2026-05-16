import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGateway } from '@/hooks/useGateway';
import { TerminalModal } from '@/components/TerminalModal';
import { Avatar } from '@/components/ui';
import { SOURCE_NAMES, sourceLogoUrl } from './news-utils';

interface NewsSource {
  sourceId: string;
  name: string;
  enabled: number;
  apiKey: string | null;
  customUrl: string | null;
}

interface DiscoveredCandidate {
  name: string;
  url: string;
  source?: string;
}

interface DiscoveryResponse {
  candidates?: DiscoveredCandidate[];
  ok?: boolean;
  error?: string;
}

// Network/discovery state machine for the "Add feed" row.
type Status = 'idle' | 'discovering' | 'ready' | 'adding' | 'error';

const PRESET_IDS = new Set(['cryptopanic', 'coindesk', 'theblock', 'decrypt', 'cointelegraph', 'coingecko']);
const MAX_URL_LEN = 2048;
const DEBOUNCE_MS = 600;

function hostnameOf(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    return new URL(withScheme).hostname;
  } catch {
    return input;
  }
}

function faviconFor(input: string): string | null {
  const host = hostnameOf(input);
  if (!host || host === input) return null;
  return `https://www.google.com/s2/favicons?sz=64&domain=${host}`;
}

interface NewsSourcesModalProps {
  open: boolean;
  onClose: () => void;
}

export function NewsSourcesModal({ open, onClose }: NewsSourcesModalProps) {
  const { request, connected } = useGateway();
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [candidates, setCandidates] = useState<DiscoveredCandidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Discovery token — increments on every new attempt and on close, so
  // stale responses know to bail out without touching state.
  const discoverTokenRef = useRef(0);
  // Separate token for in-flight `addCustom` calls so that typing in the URL
  // input (which bumps `discoverTokenRef` via the debounce effect) cannot
  // invalidate a successful add response and leave the row stuck in 'adding'.
  const addTokenRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Suppress one auto-debounce after Enter so we don't fire twice.
  const skipNextDebounceRef = useRef(false);

  const candidate = candidates[0] ?? null;
  const extraCount = Math.max(0, candidates.length - 1);

  const fetchSources = useCallback(() => {
    if (!connected) return;
    request<{ sources: NewsSource[] }>('trading.news.sources.list')
      .then((res) => setSources(res.sources ?? []))
      .catch(() => {});
  }, [connected, request]);

  // Reset local state every time the modal opens or closes.
  useEffect(() => {
    if (open) {
      fetchSources();
      setUrl('');
      setCandidates([]);
      setError(null);
      setStatus('idle');
    } else {
      // Cancel any in-flight discovery or add so the response can't mutate
      // state after close.
      discoverTokenRef.current += 1;
      addTokenRef.current += 1;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    }
  }, [open, fetchSources]);

  // Cancel in-flight discovery + add on unmount.
  useEffect(() => () => {
    discoverTokenRef.current += 1;
    addTokenRef.current += 1;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  }, []);

  const runDiscovery = useCallback(async (rawSite: string) => {
    const site = rawSite.trim();
    if (!site) {
      setStatus('idle');
      setCandidates([]);
      setError(null);
      return;
    }
    const token = ++discoverTokenRef.current;
    setStatus('discovering');
    setCandidates([]);
    setError(null);
    try {
      const res = await request<DiscoveryResponse>('trading.news.sources.discover', { site });
      if (token !== discoverTokenRef.current) return; // stale — ignore
      if (res.ok === false) {
        // The service catches network errors internally and returns an empty
        // candidate list — so {ok:false} only fires for config / server-side
        // errors (e.g. discovery service unavailable, programmer error).
        setStatus('error');
        setError("Couldn't search for feeds. Try again.");
        setCandidates([]);
        return;
      }
      const list = Array.isArray(res.candidates) ? res.candidates : [];
      if (list.length === 0) {
        setStatus('error');
        setError('No feed found at this URL.');
        setCandidates([]);
        return;
      }
      setCandidates(list);
      setStatus('ready');
      setError(null);
    } catch {
      if (token !== discoverTokenRef.current) return;
      // Transport / JSON parse failure — request never reached the server,
      // or response was malformed. Treat as a generic retry-able error.
      setStatus('error');
      setError("Couldn't search for feeds. Try again.");
      setCandidates([]);
    }
  }, [request]);

  // Debounced discovery on typing — only when input is non-empty.
  useEffect(() => {
    if (!open) return;
    if (skipNextDebounceRef.current) {
      skipNextDebounceRef.current = false;
      return;
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    const trimmed = url.trim();
    if (!trimmed) {
      // Empty input clears the candidate row and any error; cancel in-flight.
      discoverTokenRef.current += 1;
      setStatus('idle');
      setCandidates([]);
      setError(null);
      return;
    }
    // Hoist the loading affordance forward — show the spinner the moment the
    // user has typed something, instead of waiting for the 600ms debounce to
    // expire. The actual RPC still waits for the debounce; only the visual
    // state moves earlier. `runDiscovery` will re-set 'discovering' anyway,
    // which is a no-op when already discovering.
    setStatus('discovering');
    setCandidates([]);
    setError(null);
    debounceTimerRef.current = setTimeout(() => {
      runDiscovery(trimmed);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [url, open, runDiscovery]);

  const onUrlChange = useCallback((next: string) => {
    // `<input maxLength>` prevents over-long typing/paste in browsers; we
    // rely on that affordance rather than silently truncating in JS.
    setUrl(next);
  }, []);

  const triggerImmediate = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    skipNextDebounceRef.current = true;
    runDiscovery(trimmed);
  }, [url, runDiscovery]);

  const toggleSource = useCallback((sourceId: string, enabled: boolean) => {
    request('trading.news.sources.toggle', { sourceId, enabled })
      .then(() => fetchSources())
      .catch(() => fetchSources());
  }, [request, fetchSources]);

  const addCandidate = useCallback(async () => {
    if (!candidate || status === 'adding') return;
    setStatus('adding');
    setError(null);
    // Use a dedicated add token so that typing in the URL field (which
    // bumps `discoverTokenRef` via the debounce effect) cannot invalidate
    // the add response and strand the row in 'adding'.
    const token = ++addTokenRef.current;
    try {
      const res = await request<{ ok: boolean; error?: string }>(
        'trading.news.sources.addCustom',
        { url: candidate.url, name: candidate.name || hostnameOf(candidate.url) },
      );
      if (token !== addTokenRef.current) return;
      if (res.ok) {
        setUrl('');
        setCandidates([]);
        setStatus('idle');
        setError(null);
        fetchSources();
        return;
      }
      // Server-side error — keep the discovered row visible so the user
      // can see what failed.
      const msg = res.error ?? 'Failed to add feed';
      setStatus('error');
      setError(/already|exists|duplicate/i.test(msg) ? 'This source is already in your list.' : msg);
    } catch {
      if (token !== addTokenRef.current) return;
      setStatus('error');
      setError("Couldn't add that source. Try again.");
    }
  }, [candidate, status, request, fetchSources]);

  const removeSource = useCallback((sourceId: string) => {
    request('trading.news.sources.remove', { sourceId })
      .then(() => fetchSources())
      .catch(() => fetchSources());
  }, [request, fetchSources]);

  // Visibility of the existing source list — fades out while a discovered
  // row is shown, fades back in otherwise.
  const showCandidateRow = !!candidate && (status === 'ready' || status === 'adding');
  const listOpacityCls = showCandidateRow ? 'opacity-0 pointer-events-none' : 'opacity-100';

  const candidateLabel = useMemo(() => {
    if (!candidate) return '';
    return candidate.name?.trim() || hostnameOf(candidate.url || url);
  }, [candidate, url]);

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title="News Sources"
      width={450}
      hideHeader
      cardClassName="bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px]"
      bodyClassName="flex flex-col gap-[17px] p-5"
    >
      <div className="flex items-center justify-between w-full">
        <span className="text-body-lg-semibold text-white">News Sources</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex items-center justify-center w-7 h-7 rounded-[4px] bg-transparent border-0 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none focus-visible:bg-[rgba(255,255,255,0.04)]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-[var(--color-text-secondary)]" />
          </svg>
        </button>
      </div>

      <div className="flex flex-col gap-2 w-full pb-5 border-b border-dashed border-[var(--color-border-subtle)]">
        <label htmlFor="news-add-feed" className="text-body-sm text-[var(--color-text-secondary)]">Add feed</label>
        <div className="relative w-full">
          <input
            id="news-add-feed"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); triggerImmediate(); } }}
            placeholder="https://example.com"
            maxLength={MAX_URL_LEN}
            disabled={status === 'adding'}
            aria-label="RSS feed URL"
            aria-describedby={error ? 'news-add-feed-error' : undefined}
            aria-busy={status === 'discovering'}
            className="w-full h-9 bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] rounded-[4px] px-4 pr-9 text-body-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:outline-none focus-visible:outline-none disabled:opacity-50"
          />
          {status === 'discovering' && (
            <span
              aria-hidden="true"
              className="absolute right-3 top-1/2 -translate-y-1/2 inline-block w-3.5 h-3.5 rounded-full border-2 border-[var(--color-border-subtle)] border-t-[var(--color-text-secondary)] animate-spin"
            />
          )}
        </div>
        {showCandidateRow && candidate && (
          <div className="flex items-center justify-between w-full pt-1">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar url={faviconFor(candidate.url)} seed={candidate.url} label={candidateLabel} size={28} />
              <span className="text-body-md text-[var(--color-text-primary)] truncate">{candidateLabel}</span>
              {extraCount > 0 && (
                <span className="text-footnote text-[var(--color-text-secondary)] flex-shrink-0">{`(+${extraCount} more)`}</span>
              )}
            </div>
            <button
              type="button"
              onClick={addCandidate}
              disabled={status === 'adding'}
              className="bg-transparent border-none p-0 text-body-md text-[var(--color-success-default,#3ecf8e)] cursor-pointer disabled:opacity-50"
            >
              {status === 'adding' ? 'Adding…' : 'Add'}
            </button>
          </div>
        )}
        {error && (
          <div id="news-add-feed-error" className="text-footnote text-[var(--color-error-default)]">{error}</div>
        )}
      </div>

      <div
        className={`transition-opacity duration-fast ease-out ${listOpacityCls}`}
        aria-hidden={showCandidateRow || undefined}
      >
        {sources.length === 0 ? (
          <div className="text-body-sm text-[var(--color-text-secondary)] text-center py-2">No sources available yet.</div>
        ) : (
          <div className="flex flex-col gap-4 w-full">
            {sources.map((src) => {
              const isPreset = PRESET_IDS.has(src.sourceId);
              const name = src.name || (SOURCE_NAMES[src.sourceId] ?? src.sourceId);
              const enabled = !!src.enabled;
              return (
                <div key={src.sourceId} className="group flex items-center justify-between w-full">
                  <div className="flex items-center gap-2 min-w-0">
                    <Avatar url={sourceLogoUrl(src.sourceId)} seed={src.sourceId} label={name} size={28} />
                    <span className="text-body-md text-[var(--color-text-primary)] truncate">{name}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!isPreset && (
                      <button
                        type="button"
                        onClick={() => removeSource(src.sourceId)}
                        title="Remove feed"
                        aria-label={`Remove ${name}`}
                        className="opacity-0 group-hover:opacity-60 focus-visible:opacity-60 hover:opacity-100 bg-transparent border-none p-0 text-[var(--color-text-secondary)] text-label-lg leading-none cursor-pointer inline-flex items-center justify-center w-5 h-5 transition-opacity duration-fast ease-out"
                      >×</button>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={enabled ? `Disable ${name}` : `Enable ${name}`}
                      onClick={() => toggleSource(src.sourceId, !enabled)}
                      className="relative w-[29px] h-4 rounded-[9px] cursor-pointer border-none p-0 transition-colors duration-fast ease-out flex-shrink-0"
                      style={{ background: enabled ? 'var(--color-brand-default)' : 'var(--color-neutral-400, #6e7480)' }}
                    >
                      <span
                        aria-hidden="true"
                        className="absolute top-px w-3.5 h-3.5 rounded-full bg-white transition-[left] duration-fast ease-out"
                        style={{ left: enabled ? 14 : 1 }}
                      />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </TerminalModal>
  );
}
