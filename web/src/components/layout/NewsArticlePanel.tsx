import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '@/components/ui';
import { useGateway } from '@/hooks/useGateway';
import { PulsingDots } from '@/components/chat/PulsingDots';
import {
  type NewsArticle,
  SOURCE_NAMES,
  timeAgo,
  sourceLogoUrl,
  stripLegacyLabels,
} from './news-utils';

type PanelState =
  | { kind: 'loading' }
  | { kind: 'ready'; deepSummary: string }
  | { kind: 'failed' };

export interface NewsArticlePanelProps {
  article: NewsArticle;
  /** When true, viewport is narrow enough that the drawer is hidden; the panel
   *  takes the right slot. Controlled by NewsWidget via matchMedia. */
  compact: boolean;
  onClose: () => void;
}

const NEWS_PINK = '#ff61ff';

/** Article side-panel — portal-rendered overlay rendered to the LEFT of the
 *  news drawer (or in the drawer's slot on <1133px viewports). Fetches the
 *  AI-generated deep summary via trading.news.deepSummary on mount + on
 *  article change. Shares the drawer's scrim — NewsWidget closes both on
 *  scrim click. ESC also closes (capture-phase handler below). */
export function NewsArticlePanel({ article, compact, onClose }: NewsArticlePanelProps) {
  const { request } = useGateway();
  const [state, setState] = useState<PanelState>({ kind: 'loading' });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // Capture phase: panel must win against drawer's Esc handler.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    request<{ status: 'ready' | 'pending' | 'failed'; deepSummary: string | null }>(
      'trading.news.deepSummary',
      { articleId: article.id },
    )
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'ready' && res.deepSummary) {
          setState({ kind: 'ready', deepSummary: res.deepSummary });
        } else {
          setState({ kind: 'failed' });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ kind: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [article.id, request]);

  const sourceName = SOURCE_NAMES[article.sourceId] ?? article.sourceId;
  const publishedDate = new Date(article.publishedAt * 1000).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const fallbackSummary = stripLegacyLabels(
    (article.fullSummary ?? '').replace(/^\[partial\]/, ''),
  );
  const leadParagraph = article.snippet.length > 200
    ? article.snippet.slice(0, 200).trimEnd() + '…'
    : article.snippet;

  return createPortal(
    <aside
      role="dialog"
      aria-label={article.title}
      aria-modal="false"
      className={
        'fixed top-0 h-screen w-[800px] z-[10003] ' +
        'bg-[var(--color-surface-base)] flex flex-col ' +
        'shadow-[-20px_4px_24px_0px_rgba(0,0,0,0.25)] ' +
        'transition-transform duration-base ease-out translate-x-0 ' +
        (compact ? 'right-0' : 'right-[408px]')
      }
    >
      <div className="flex-1 overflow-y-auto py-5 flex flex-col gap-[19px] w-[725px] mx-auto">
        {/* Top row: source meta + read full article link */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-flex items-center justify-center rounded-full border bg-[#0f1012] shrink-0"
              style={{ width: 32, height: 32, borderColor: 'rgba(122,129,128,0.3)' }}
            >
              <Avatar
                url={sourceLogoUrl(article.sourceId)}
                seed={article.sourceId}
                label={sourceName}
                size={24}
              />
            </span>
            <div className="flex flex-col min-w-0">
              <span className="text-body-md-medium text-text-primary leading-[1.5] truncate">
                {sourceName}
              </span>
              <span className="text-caption text-text-secondary leading-[1.5]">
                {timeAgo(article.publishedAt)}
              </span>
            </div>
          </div>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-[5px] text-body-sm text-brand-default no-underline cursor-pointer transition-[color,gap] duration-base ease-out hover:gap-2"
          >
            Read full article
            <ArrowUpRightIcon />
          </a>
        </div>

        <div className="flex flex-col items-start gap-2">
          {/* Summary by AI badge */}
          <span className="inline-flex items-center gap-1 px-2 py-[2px] rounded-[3px] bg-surface-overlay">
            <SparklesIcon />
            <span className="text-body-sm text-text-tertiary leading-[1.5]">Summary by AI</span>
          </span>

          {/* Title */}
          <h1 className="text-heading-md text-text-primary leading-[1.5] m-0">{article.title}</h1>

          {/* Meta line */}
          <div className="text-body-sm text-text-secondary leading-[1.5]">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-secondary underline hover:text-text-primary"
            >
              {sourceName}
            </a>
            {' · Published '}
            {publishedDate}
          </div>

          {/* Lead paragraph */}
          {leadParagraph && (
            <p className="text-body-md text-text-primary leading-[1.5] m-0">{leadParagraph}</p>
          )}
        </div>

        {/* Main image */}
        {article.imageUrl && (
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            className="w-full max-w-[515px] h-[290px] object-cover rounded-[2px]"
          />
        )}

        {/* Deep summary body (3-state) */}
        <DeepSummaryBody state={state} fallbackSummary={fallbackSummary} />
      </div>
    </aside>,
    document.body,
  );
}

function ArrowUpRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 11L11 5M11 5H6M11 5V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path
        d="M8.5 2L9.7 5.8L13.5 7L9.7 8.2L8.5 12L7.3 8.2L3.5 7L7.3 5.8L8.5 2Z"
        fill="currentColor"
        className="text-text-tertiary"
      />
      <path
        d="M13.5 10L14 11.5L15.5 12L14 12.5L13.5 14L13 12.5L11.5 12L13 11.5L13.5 10Z"
        fill="currentColor"
        className="text-text-tertiary"
      />
    </svg>
  );
}

function DeepSummaryBody({
  state,
  fallbackSummary,
}: {
  state: PanelState;
  fallbackSummary: string;
}) {
  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 text-body-sm text-text-secondary leading-[1.5]">
        <span>Generating summary</span>
        <PulsingDots color={NEWS_PINK} />
      </div>
    );
  }

  if (state.kind === 'failed') {
    if (!fallbackSummary) return null;
    return (
      <p className="text-body-md text-text-primary leading-[1.5] m-0 whitespace-pre-wrap">
        {fallbackSummary}
      </p>
    );
  }

  const paragraphs = splitParagraphs(state.deepSummary);
  return (
    <div className="flex flex-col gap-3">
      {paragraphs.map((para, i) => (
        <p key={i} className="text-body-md text-text-primary leading-[1.5] m-0">
          {para}
        </p>
      ))}
    </div>
  );
}

/** Split a deep summary blob into paragraphs.
 *  Primary split: blank lines. Fallback: group sentences into ~3-sentence
 *  paragraphs so a single-blob response is still readable. */
function splitParagraphs(text: string): string[] {
  const blocks = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (blocks.length > 1) return blocks;

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length <= 3) return [text.trim()];
  const groups: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    groups.push(sentences.slice(i, i + 3).join(' '));
  }
  return groups;
}
