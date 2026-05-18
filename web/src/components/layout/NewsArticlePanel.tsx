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
      {/* Scroll container fills the panel width so the scrollbar sits at
          the panel's right edge instead of floating mid-panel beside the
          centered content column. Inner column keeps the 725px cap. */}
      <div className="flex-1 overflow-y-auto w-full">
        <div className="py-4 px-6 flex flex-col items-end gap-[19px] w-[725px] mx-auto">
        {/* Top row: source meta · Summary-by-AI badge.
            Figma 1091:4908 moves the "Summary by AI" tag to the top-right;
            the "Read full" affordance migrates to the bottom of the panel
            as a button. */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-flex items-center justify-center rounded-full border bg-[#0f1012] shrink-0 overflow-hidden"
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
              <span className="text-label-lg text-text-primary leading-[1.5] truncate">
                {sourceName}
              </span>
              <span className="text-body-sm text-text-secondary leading-[1.5]">
                {timeAgo(article.publishedAt)}
              </span>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 py-[2px] rounded-[6px]">
            <SparklesIcon />
            <span className="text-body-sm text-text-tertiary leading-[1.5] whitespace-nowrap">
              Summary by AI
            </span>
          </span>
        </div>

        <div className="flex flex-col items-start gap-2 w-full">
          {/* Title — 22px semibold (heading-md) */}
          <h1 className="text-heading-md text-text-primary leading-[1.5] m-0">{article.title}</h1>

          {/* Meta line */}
          <div className="text-body-md text-text-secondary leading-[1.5]">
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

          {/* Lead paragraph — 16px (body-lg) per Figma */}
          {leadParagraph && (
            <p className="text-body-lg text-text-primary leading-[1.5] m-0">{leadParagraph}</p>
          )}
        </div>

        {/* Main image — full panel width per Figma */}
        {article.imageUrl && (
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            className="w-full aspect-[1920/1080] object-cover rounded-[2px]"
          />
        )}

        {/* Deep summary body (3-state) */}
        <DeepSummaryBody state={state} fallbackSummary={fallbackSummary} />

        {/* Read-full-article button — bottom-aligned per Figma 1091:4901 */}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className={
            'inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-[4px] ' +
            'bg-[var(--color-surface-overlay)] border border-[var(--color-border-strong)] ' +
            'text-body-md-medium text-text-secondary no-underline cursor-pointer ' +
            'transition-colors duration-fast ease-out btn-press ' +
            'hover:text-text-primary hover:border-[var(--color-text-tertiary)]'
          }
        >
          Read full article
          <ArrowUpRightIcon />
        </a>
        </div>
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
      <p className="text-body-lg text-text-primary leading-[1.5] m-0 whitespace-pre-wrap w-full">
        {fallbackSummary}
      </p>
    );
  }

  const paragraphs = splitParagraphs(state.deepSummary);
  return (
    <div className="flex flex-col gap-3 w-full">
      {paragraphs.map((para, i) => (
        <p key={i} className="text-body-lg text-text-primary leading-[1.5] m-0">
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
