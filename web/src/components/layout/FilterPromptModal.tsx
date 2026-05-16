import { useCallback, useEffect, useState } from 'react';
import { useGateway } from '@/hooks/useGateway';
import { TerminalModal } from '@/components/TerminalModal';

const MAX_LEN = 2000;

interface FilterPromptModalProps {
  open: boolean;
  onClose: () => void;
  kind: 'news' | 'tweets';
}

const COPY = {
  news: {
    title: 'News Filter',
    helper: 'Tell the AI how you want your news. It will filter, sort, and summarize accordingly.',
    placeholder:
      "Only show macro news that could affect BTC in the next 24h. Skip altcoin pumps and exchange announcements. Summarize in one line from a trader's perspective.",
    getMethod: 'trading.news.filter.get',
    setMethod: 'trading.news.filter.set',
  },
  tweets: {
    title: 'Tweets Filter',
    helper: 'Tell the AI how you want your tweets. It will filter, sort, and summarize accordingly.',
    placeholder:
      'Only liquidations > $1M, and major exchange or regulator announcements. Skip memecoin shilling.',
    getMethod: 'trading.tweets.filter.get',
    setMethod: 'trading.tweets.filter.set',
  },
} as const;

export function FilterPromptModal({ open, onClose, kind }: FilterPromptModalProps) {
  const { request, connected } = useGateway();
  const copy = COPY[kind];
  const [prompt, setPrompt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch on every open so a stale local state doesn't shadow another
  // session that edited the prompt (e.g. CLI / second browser tab). The
  // gateway returns the built-in default when no override is stored, so the
  // textarea always starts with the prompt the evaluator is using right now.
  useEffect(() => {
    if (!open || !connected) return;
    let cancelled = false;
    setError(null);
    request<{ prompt: string }>(copy.getMethod)
      .then((res) => {
        if (!cancelled) setPrompt(res.prompt ?? '');
      })
      .catch(() => {
        if (!cancelled) setPrompt('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, connected, request, copy.getMethod]);

  const save = useCallback(async () => {
    if (saving) return;
    const trimmed = prompt.trim();
    if (trimmed.length > MAX_LEN) {
      setError(`Prompt exceeds ${MAX_LEN} characters`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await request<{ ok: boolean; error?: string }>(copy.setMethod, { prompt: trimmed });
      if (res.ok) {
        onClose();
      } else {
        setError(res.error ?? 'Failed to save filter prompt');
      }
    } catch {
      setError('Failed to save filter prompt');
    } finally {
      setSaving(false);
    }
  }, [prompt, saving, request, copy.setMethod, onClose]);

  const remaining = MAX_LEN - prompt.length;

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title={copy.title}
      width={450}
      hideHeader
      cardClassName="bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px]"
      bodyClassName="flex flex-col items-end gap-2 pt-4 pb-5 px-4"
    >
      <div className="flex items-center justify-between w-full">
        <span className="text-body-md-semibold text-[var(--color-text-primary)] leading-[1.5]">
          {copy.title}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex items-center justify-center w-7 h-7 rounded-[6px] bg-transparent border-0 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none focus-visible:bg-[rgba(255,255,255,0.04)]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              className="text-[var(--color-text-secondary)]"
            />
          </svg>
        </button>
      </div>

      <div className="flex flex-col items-end gap-5 w-full">
        <div className="flex flex-col gap-1.5 w-full">
          <p className="text-body-sm text-[var(--color-text-tertiary)] leading-[1.5] m-0">
            {copy.helper}
          </p>
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (error) setError(null);
            }}
            placeholder={copy.placeholder}
            aria-label={copy.title}
            maxLength={MAX_LEN}
            disabled={saving}
            className="w-full h-[127px] bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] rounded-[4px] px-4 py-3 text-body-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] leading-[1.5] outline-none focus:outline-none focus-visible:outline-none resize-none disabled:opacity-50"
          />
          {error && <div className="text-footnote text-[var(--color-error-default)] m-0">{error}</div>}
          {!error && remaining < 200 && (
            <div className="text-footnote text-[var(--color-text-tertiary)] m-0">{remaining} chars left</div>
          )}
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="h-9 px-4 rounded-[4px] bg-[var(--color-brand-default)] text-[var(--color-text-on-brand)] text-body-md-semibold leading-[1.5] cursor-pointer border-0 hover:opacity-90 disabled:opacity-50 transition-opacity duration-fast ease-out"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </TerminalModal>
  );
}

export function NewsFilterModal(props: Omit<FilterPromptModalProps, 'kind'>) {
  return <FilterPromptModal {...props} kind="news" />;
}

export function TweetsFilterModal(props: Omit<FilterPromptModalProps, 'kind'>) {
  return <FilterPromptModal {...props} kind="tweets" />;
}
