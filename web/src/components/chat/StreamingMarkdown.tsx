import { type ReactNode, useEffect } from 'react';
import { Streamdown, type StreamdownProps } from 'streamdown';
import { code } from '@streamdown/code';
import { LinkPreviewModal } from './LinkPreviewModal';
import { ChartDataProvider } from './ChartDataContext';
import { useChartDataStore, chartDataKey } from './ChartDataContext-internals';
import { useChartData } from '@/hooks/useChartData';
import { useChartPanel } from '@/components/chart/ChartPanelContext-internals';
import { IndicatorMention } from '@/components/chart/IndicatorMention';
import { LevelMention } from '@/components/chart/LevelMention';

/* ── Chart tag renderer ──
 * Fetches chart data into the ChartDataContext (used by <ind>/<lvl>
 * tooltip mentions), AND always renders a visible clickable pill so
 * the user never ends up with an empty assistant bubble when the
 * agent emits only a chart tag. Clicking the pill opens the
 * fullscreen chart overlay.
 */

function ChartTag({
  symbol,
  interval,
  indicators,
  children,
}: {
  symbol: string;
  interval?: string;
  indicators?: string;
  children?: ReactNode;
}) {
  const { data, loading, error } = useChartData(symbol, interval, indicators);
  const chartStore = useChartDataStore();
  const panel = useChartPanel();

  useEffect(() => {
    if (data && chartStore) {
      chartStore.set(chartDataKey(symbol, interval, indicators), data);
    }
  }, [data, chartStore, symbol, interval, indicators]);

  const label = interval
    ? `${symbol.toUpperCase()} · ${interval}`
    : symbol.toUpperCase();

  const handleOpen = () => {
    if (data && panel) panel.open({ symbol: data.symbol, interval: data.interval });
  };

  const disabled = !data || loading || !!error;

  const pill = (
    <button
      type="button"
      onClick={handleOpen}
      disabled={disabled}
      aria-label={`Open ${label} chart`}
      className={
        'my-1.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-[4px] ' +
        'bg-[var(--color-surface-base)] border border-[var(--color-border-default)] text-footnote ' +
        'transition-colors duration-fast ease-out ' +
        (disabled
          ? 'text-[var(--color-text-secondary)] cursor-default opacity-70'
          : 'text-[var(--color-text-primary)] cursor-pointer hover:border-[var(--color-brand-default)] hover:text-[var(--color-brand-default)] focus-visible:border-[var(--color-brand-default)] focus-visible:text-[var(--color-brand-default)]')
      }
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 3v18h18" />
        <path d="M7 14l4-4 4 4 5-5" />
      </svg>
      <span>
        {loading ? 'Loading chart…' : error ? `${label} (unavailable)` : label}
      </span>
      {!disabled && <span aria-hidden="true">→</span>}
    </button>
  );

  return (
    <>
      {children}
      {pill}
    </>
  );
}

/* ── Trading semantic components ── */

const ALLOWED_TAGS = {
  pct: ['dir'],
  price: [],
  pnl: ['dir'],
  lev: [],
  side: ['dir'],
  tag: ['type'],
  risk: ['level'],
  verdict: ['type'],
  chart: ['symbol', 'interval', 'indicators', 'levels', 'focus-time', 'focus-price'],
  ind: ['name'],
  lvl: ['price'],
};

const tradingComponents = {
  pct: ({ dir, children }: { dir?: string; children?: ReactNode }) => (
    <span className={dir === 'up' ? 'trade-pct-up' : 'trade-pct-down'}>{children}</span>
  ),
  price: ({ children }: { children?: ReactNode }) => (
    <span className="trade-price">{children}</span>
  ),
  pnl: ({ dir, children }: { dir?: string; children?: ReactNode }) => (
    <span className={dir === 'up' ? 'trade-pnl-up' : 'trade-pnl-down'}>{children}</span>
  ),
  lev: ({ children }: { children?: ReactNode }) => (
    <span className="trade-leverage">{children}</span>
  ),
  side: ({ dir, children }: { dir?: string; children?: ReactNode }) => (
    <span className={dir === 'long' ? 'trade-long' : 'trade-short'}>{children}</span>
  ),
  tag: ({ type, children }: { type?: string; children?: ReactNode }) => (
    <span className={`trade-tag trade-tag-${type ?? 'entry'}`}>{children}</span>
  ),
  risk: ({ level, children }: { level?: string; children?: ReactNode }) => (
    <span className={`trade-risk trade-risk-${level ?? 'medium'}`}>{children}</span>
  ),
  verdict: ({ type, children }: { type?: string; children?: ReactNode }) => (
    <span className={`trade-verdict trade-verdict-${type ?? 'neutral'}`}>{children}</span>
  ),
  ind: ({ name, children }: { name?: string; children?: ReactNode }) => (
    <IndicatorMention name={name}>{children}</IndicatorMention>
  ),
  lvl: ({ price, children }: { price?: string; children?: ReactNode }) => (
    <LevelMention price={price}>{children}</LevelMention>
  ),
  chart: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
    <ChartTag
      symbol={String(props.symbol ?? '')}
      interval={props.interval ? String(props.interval) : undefined}
      indicators={props.indicators ? String(props.indicators) : undefined}
    >
      {children}
    </ChartTag>
  ),
};

/* ── Table components ── */

const tableComponents = {
  table: ({ children }: { children?: ReactNode }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full border-collapse text-body-md border border-white/[0.08] rounded-[4px]">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: ReactNode }) => (
    <th className="px-3 py-1.5 text-left text-label-sm uppercase tracking-wider text-slate-400 border-b border-white/10 bg-white/5">
      {children}
    </th>
  ),
  td: ({ children }: { children?: ReactNode }) => (
    <td className="px-3 py-1.5 text-left text-body-md tabular-nums border-b border-white/[0.06]">
      {children}
    </td>
  ),
};

/* ── Streamdown config (stable references) ── */

const plugins = { code };

const mdComponents = {
  ...tradingComponents,
  ...tableComponents,
};

const linkSafety: StreamdownProps['linkSafety'] = {
  enabled: true,
  renderModal: ({ isOpen, onClose, onConfirm, url }) =>
    isOpen ? <LinkPreviewModal url={url} onClose={onClose} onConfirm={onConfirm} /> : null,
};

interface StreamingMarkdownProps {
  content: string;
  streaming?: boolean;
}

const LITERAL_TAG_CONTENT = ['ind', 'lvl'];

export function StreamingMarkdown({
  content,
  streaming,
}: StreamingMarkdownProps) {
  return (
    <ChartDataProvider>
      <div className="chat-md">
        <Streamdown
          mode={streaming ? 'streaming' : 'static'}
          components={mdComponents}
          allowedTags={ALLOWED_TAGS}
          literalTagContent={LITERAL_TAG_CONTENT}
          plugins={plugins}
          linkSafety={linkSafety}
          isAnimating={streaming}
          caret="block"
        >
          {content}
        </Streamdown>
      </div>
    </ChartDataProvider>
  );
}
