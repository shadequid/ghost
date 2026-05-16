import { useEffect, useRef, memo } from "react";
import {
  createChart,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
} from "lightweight-charts";
import type { ChartDataResponse } from "@/lib/chartTypes";
import {
  CHART_BG,
  TEXT_COLOR,
  GRID_COLOR,
  BORDER_COLOR,
  CANDLE_UP,
  CANDLE_DOWN,
  FONT_FAMILY,
  FONT_SIZE,
  SUPPORT_COLOR,
  RESISTANCE_COLOR,
} from "./chart-config";

const W = 300;
const H = 180;

const HIGHLIGHT_COLOR = "#ffeb3b";

interface LevelChartMiniProps {
  data: ChartDataResponse;
  price: number;
  side?: "support" | "resistance";
}

export const LevelChartMini = memo(function LevelChartMini({
  data,
  price,
  side,
}: LevelChartMiniProps) {
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mainRef.current;
    if (!el || data.candles.length === 0) return;

    const chart = createChart(el, {
      height: H,
      width: W,
      layout: {
        background: { type: ColorType.Solid, color: CHART_BG },
        textColor: TEXT_COLOR,
        fontFamily: FONT_FAMILY,
        fontSize: FONT_SIZE,
      },
      grid: {
        vertLines: { color: GRID_COLOR },
        horzLines: { color: GRID_COLOR },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: BORDER_COLOR,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: BORDER_COLOR,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: { vertTouchDrag: false },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: CANDLE_UP,
      downColor: CANDLE_DOWN,
      borderDownColor: CANDLE_DOWN,
      borderUpColor: CANDLE_UP,
      wickDownColor: CANDLE_DOWN,
      wickUpColor: CANDLE_UP,
    });
    candles.setData(data.candles as Parameters<typeof candles.setData>[0]);

    const count = data.candles.length;
    const visible = Math.min(50, count);
    const from = count - visible;
    const to = count - 1;
    chart.timeScale().setVisibleLogicalRange({ from, to });

    // If hovered level is outside visible candle range, expand y-axis to include it
    const visibleCandles = data.candles.slice(from, to + 1);
    const cLow = Math.min(...visibleCandles.map((c) => c.low));
    const cHigh = Math.max(...visibleCandles.map((c) => c.high));
    const cRange = cHigh - cLow || cHigh * 0.01;
    const gap = price > cHigh ? price - cHigh : price < cLow ? cLow - price : 0;

    if (gap > 0) {
      const pad = cRange * 0.08;
      const lo = Math.min(cLow, price) - pad;
      const hi = Math.max(cHigh, price) + pad;
      candles.applyOptions({
        autoscaleInfoProvider: () => ({
          priceRange: { minValue: lo, maxValue: hi },
        }),
      });
    }

    // Highlighted level — thick solid line
    const highlightColor =
      side === "support"
        ? SUPPORT_COLOR
        : side === "resistance"
          ? RESISTANCE_COLOR
          : HIGHLIGHT_COLOR;
    candles.createPriceLine({
      price,
      color: highlightColor,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "",
    });

    // Other known levels — dimmed dashed lines for context
    for (const level of data.levels) {
      if (Math.abs(level.price - price) < 0.0001) continue;
      const c = level.side === "support" ? SUPPORT_COLOR : RESISTANCE_COLOR;
      candles.createPriceLine({
        price: level.price,
        color: c + "55",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: false,
        title: "",
      });
    }

    return () => {
      chart.remove();
    };
  }, [data, price, side]);

  return (
    <div
      className="overflow-hidden rounded-[4px] bg-[var(--color-surface-canvas)]"
      style={{ width: W, height: H }}
    >
      <div ref={mainRef} style={{ width: W }} />
    </div>
  );
});
