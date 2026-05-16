import { type ReactNode } from "react";
import { useChartDataStore } from "../chat/ChartDataContext-internals";
import { LevelPopover } from "./LevelPopover";
import { useChartPanel } from "./ChartPanelContext-internals";
import type { ChartDataResponse, ChartLevel } from "@/lib/chartTypes";
import { ChartIcon } from "./ChartIcon";


interface LevelMentionProps {
  price?: string;
  children?: ReactNode;
}

interface Match {
  data: ChartDataResponse;
  level?: ChartLevel;
}

// Price tolerance: 0.5% — levels from LLM text may round slightly.
const TOLERANCE_PCT = 0.005;

function parsePrice(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[,_\s$]/g, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function findLevelMatch(
  store: { find: (p: (d: ChartDataResponse) => boolean) => ChartDataResponse | undefined },
  price: number,
): Match | null {
  const tol = price * TOLERANCE_PCT;

  // Pass 1: find data whose levels array contains this price (gives us side info)
  const withLevel = store.find((d) =>
    d.levels.some((l) => Math.abs(l.price - price) <= tol),
  );
  if (withLevel) {
    const level = withLevel.levels.find(
      (l) => Math.abs(l.price - price) <= tol,
    );
    return { data: withLevel, level };
  }

  // Pass 2: any chart whose candles cover this price range — render neutral line
  const inRange = store.find((d) => {
    if (d.candles.length === 0) return false;
    const prices = d.candles.flatMap((c) => [c.low, c.high]);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return price >= min * 0.9 && price <= max * 1.1;
  });
  if (inRange) return { data: inRange };

  return null;
}

export function LevelMention({ price, children }: LevelMentionProps) {
  const store = useChartDataStore();
  const panel = useChartPanel();
  const parsed = parsePrice(price);

  if (parsed === null || !store) return <>{children}</>;

  const match = findLevelMatch(store, parsed);
  if (!match) return <>{children}</>;

  const side = match.level?.side;

  const handleClick = () => {
    if (!panel) return;
    panel.open({
      symbol: match.data.symbol,
      interval: match.data.interval,
      focus: { kind: "level", price: parsed },
    });
  };

  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-semibold text-[#42a5f5]">{children}</span>
      <LevelPopover data={match.data} price={parsed} side={side}>
        <span onClick={handleClick} className="cursor-pointer">
          <ChartIcon />
        </span>
      </LevelPopover>
    </span>
  );
}
