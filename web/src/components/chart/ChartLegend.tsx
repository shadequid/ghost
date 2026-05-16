import type {
  ChartBandOverlay,
  ChartLineOverlay,
} from "@/lib/chartTypes";
import {
  SUPPORT_COLOR,
  RESISTANCE_COLOR,
  TEXT_COLOR,
} from "./chart-config";
import {
  lineKey,
  bandKey,
  levelKey,
  toBandLineColor,
  type VisibleLevel,
} from "./ChartWidget-helpers";

interface ChartLegendProps {
  lines: ChartLineOverlay[];
  bands: ChartBandOverlay[];
  levels: VisibleLevel[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
}

function formatLevelPrice(price: number): string {
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function levelDisplayLabel(l: {
  price: number;
  label: string;
  side?: "support" | "resistance";
}): string {
  const prefix = l.label
    ? l.label.length > 20
      ? l.label.slice(0, 20) + "\u2026"
      : l.label
    : l.side
      ? l.side === "support"
        ? "Support"
        : "Resistance"
      : "Level";
  return `${prefix} ${formatLevelPrice(l.price)}`;
}

function levelColor(side?: "support" | "resistance"): string {
  if (side === "support") return SUPPORT_COLOR;
  if (side === "resistance") return RESISTANCE_COLOR;
  return TEXT_COLOR;
}

/** Floating legend — each row toggles visibility of a series/level. */
export function ChartLegend({
  lines,
  bands,
  levels,
  hidden,
  onToggle,
}: ChartLegendProps) {
  const legendClass =
    "absolute top-2 left-2 z-10 flex max-h-[40%] flex-col gap-1 overflow-y-auto rounded-[4px] border border-[rgba(121,121,121,0.15)] bg-[rgba(11,17,24,0.85)] px-2 py-2 text-footnote text-[var(--color-text-secondary)]";
  const rowClass =
    "flex items-center gap-2 border-none bg-transparent px-0 py-px text-left text-footnote text-inherit cursor-pointer";

  return (
    <div className={legendClass}>
      {lines.map((o) => {
        const key = lineKey(o.label);
        const off = hidden.has(key);
        return (
          <button
            key={key}
            type="button"
            className={rowClass}
            style={{ opacity: off ? 0.4 : 1 }}
            aria-pressed={!off}
            aria-label={`Toggle ${o.label}`}
            onClick={() => onToggle(key)}
          >
            <span
              className="h-[2px] w-3 flex-shrink-0"
              style={{
                background: off ? "transparent" : o.color,
                border: `1px solid ${o.color}`,
              }}
            />
            <span>{o.label}</span>
          </button>
        );
      })}
      {bands.map((b) => {
        const key = bandKey(b.label);
        const off = hidden.has(key);
        const c = toBandLineColor(b.color);
        return (
          <button
            key={key}
            type="button"
            className={rowClass}
            style={{ opacity: off ? 0.4 : 1 }}
            aria-pressed={!off}
            aria-label={`Toggle ${b.label}`}
            onClick={() => onToggle(key)}
          >
            <span
              className="h-[2px] w-3 flex-shrink-0"
              style={{
                background: off ? "transparent" : c,
                border: `1px solid ${c}`,
              }}
            />
            <span>{b.label}</span>
          </button>
        );
      })}
      {levels.map((l) => {
        const key = levelKey(l.price);
        const off = hidden.has(key);
        const c = levelColor(l.side);
        const label = levelDisplayLabel(l);
        return (
          <button
            key={key}
            type="button"
            className={rowClass}
            style={{ opacity: off ? 0.4 : 1 }}
            aria-pressed={!off}
            aria-label={`Toggle ${label}`}
            onClick={() => onToggle(key)}
          >
            <span
              className="h-[2px] w-3 flex-shrink-0"
              style={{
                background: off ? "transparent" : c,
                border: `1px solid ${c}`,
              }}
            />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
