import { type ReactNode } from "react";
import { getIndicatorMeta, ALLOWED_INDICATOR_NAMES } from "./indicatorRegistry";
import { useChartDataStore } from "../chat/ChartDataContext-internals";
import { IndicatorPopover } from "./IndicatorPopover";
import { useChartPanel } from "./ChartPanelContext-internals";
import type { ChartDataResponse } from "@/lib/chartTypes";
import { ChartIcon } from "./ChartIcon";


interface IndicatorMentionProps {
  name?: string;
  children?: ReactNode;
}

function chartHasIndicator(data: ChartDataResponse, name: string): boolean {
  const lower = name.toLowerCase();

  if (lower === "ema") {
    return data.lineOverlays.some((o) =>
      o.label.toLowerCase().startsWith("ema"),
    );
  }

  // Exact label match across all data buckets — `rsi` doesn't collide with
  // `stochrsi`, single-line overlays like VWAP work, etc.
  return (
    data.lineOverlays.some((o) => o.label.toLowerCase() === lower) ||
    data.bandOverlays.some((b) => b.label.toLowerCase() === lower) ||
    data.subPanes.some((p) => p.label.toLowerCase() === lower)
  );
}

export function IndicatorMention({ name, children }: IndicatorMentionProps) {
  const store = useChartDataStore();
  const panel = useChartPanel();
  // rehype-sanitize clobber-protects `name` attribute by prefixing with
  // `user-content-` (default schema behavior). Strip it before matching.
  const normalizedName =
    name?.toLowerCase().trim().replace(/^user-content-/, "") ?? "";
  const meta = getIndicatorMeta(normalizedName);

  if (!ALLOWED_INDICATOR_NAMES.has(normalizedName) || !meta) {
    return <>{children}</>;
  }

  let matchedData: ChartDataResponse | undefined;
  if (store) {
    matchedData = store.find((d) => chartHasIndicator(d, normalizedName));
  }

  // No matching chart data → render plain children (no styled span).
  // A styled span without a popover is misleading UX — user hovers expecting
  // something and nothing happens.
  if (!matchedData) {
    return <>{children}</>;
  }

  const handleClick = () => {
    if (!panel || !matchedData) return;
    panel.open({
      symbol: matchedData.symbol,
      interval: matchedData.interval,
      focus: { kind: "indicator", name: normalizedName },
    });
  };

  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-semibold text-[#42a5f5]">{children}</span>
      <IndicatorPopover
        data={matchedData}
        indicatorName={normalizedName}
        indicatorKind={meta.kind}
      >
        <span onClick={handleClick} className="cursor-pointer">
          <ChartIcon />
        </span>
      </IndicatorPopover>
    </span>
  );
}
