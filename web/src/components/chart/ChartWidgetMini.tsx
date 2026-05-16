import { useEffect, useRef, memo } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
} from "lightweight-charts";
import type { ChartDataResponse, ChartSubPane } from "@/lib/chartTypes";
import type { IndicatorKind } from "./indicatorRegistry";
import {
  CHART_BG,
  TEXT_COLOR,
  GRID_COLOR,
  BORDER_COLOR,
  CANDLE_UP,
  CANDLE_DOWN,
  FONT_FAMILY,
  FONT_SIZE,
  SUB_PANE_HEIGHT,
} from "./chart-config";

const OVERLAY_W = 300;
const OVERLAY_H = 180;
const SUBPANE_W = 300;
const SUBPANE_CANDLE_H = 140;
const SUBPANE_TOTAL_H = SUBPANE_CANDLE_H + SUB_PANE_HEIGHT + 4;

function miniChartOpts(h: number, showTime: boolean) {
  return {
    height: h,
    width: OVERLAY_W,
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
      visible: showTime,
    },
    handleScroll: { vertTouchDrag: false },
  } as const;
}

function toBandLineColor(color: string): string {
  if (color.startsWith("rgba(") || color.startsWith("#")) return color;
  if (color.startsWith("rgb("))
    return color.replace("rgb(", "rgba(").replace(")", ", 0.5)");
  return color;
}

function buildOverlayMini(
  el: HTMLElement,
  data: ChartDataResponse,
  indicatorName: string,
): IChartApi {
  const chart = createChart(el, miniChartOpts(OVERLAY_H, true));

  const candles = chart.addSeries(CandlestickSeries, {
    upColor: CANDLE_UP,
    downColor: CANDLE_DOWN,
    borderDownColor: CANDLE_DOWN,
    borderUpColor: CANDLE_UP,
    wickDownColor: CANDLE_DOWN,
    wickUpColor: CANDLE_UP,
  });
  candles.setData(data.candles as Parameters<typeof candles.setData>[0]);

  const nameLower = indicatorName.toLowerCase();

  if (nameLower === "ema") {
    for (const overlay of data.lineOverlays) {
      if (overlay.label.toLowerCase().startsWith("ema")) {
        const s = chart.addSeries(LineSeries, {
          color: overlay.color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData(overlay.data as Parameters<typeof s.setData>[0]);
      }
    }
  } else {
    // Single-line overlays (VWAP, etc.) live in lineOverlays
    const lineMatch = data.lineOverlays.find(
      (o) => o.label.toLowerCase() === nameLower,
    );
    if (lineMatch) {
      const s = chart.addSeries(LineSeries, {
        color: lineMatch.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(lineMatch.data as Parameters<typeof s.setData>[0]);
    }
    for (const band of data.bandOverlays) {
      if (band.label.toLowerCase() === nameLower) {
        const lineColor = toBandLineColor(band.color);
        const upper = chart.addSeries(LineSeries, {
          color: lineColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        upper.setData(band.upperData as Parameters<typeof upper.setData>[0]);
        const lower = chart.addSeries(LineSeries, {
          color: lineColor,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        lower.setData(band.lowerData as Parameters<typeof lower.setData>[0]);
      }
    }
  }

  const count = data.candles.length;
  const visible = Math.min(50, count);
  chart.timeScale().setVisibleLogicalRange({ from: count - visible, to: count - 1 });
  return chart;
}

function buildSubPaneMini(
  mainEl: HTMLElement,
  subEl: HTMLElement,
  data: ChartDataResponse,
  pane: ChartSubPane,
): [IChartApi, IChartApi] {
  const mainChart = createChart(mainEl, miniChartOpts(SUBPANE_CANDLE_H, false));

  const candles = mainChart.addSeries(CandlestickSeries, {
    upColor: CANDLE_UP,
    downColor: CANDLE_DOWN,
    borderDownColor: CANDLE_DOWN,
    borderUpColor: CANDLE_UP,
    wickDownColor: CANDLE_DOWN,
    wickUpColor: CANDLE_UP,
  });
  candles.setData(data.candles as Parameters<typeof candles.setData>[0]);

  const subChart = createChart(subEl, {
    ...miniChartOpts(SUB_PANE_HEIGHT, true),
    rightPriceScale: {
      borderColor: BORDER_COLOR,
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
  });

  if (pane.type === "macd") {
    if (pane.histogramData && pane.histogramData.length > 0) {
      const h = subChart.addSeries(HistogramSeries, {
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      h.setData(pane.histogramData as Parameters<typeof h.setData>[0]);
    }
    if (pane.data.length > 0) {
      const ml = subChart.addSeries(LineSeries, {
        color: pane.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      ml.setData(pane.data as Parameters<typeof ml.setData>[0]);
    }
    if (pane.signalData && pane.signalData.length > 0) {
      const sl = subChart.addSeries(LineSeries, {
        color: "#ff9800",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      sl.setData(pane.signalData as Parameters<typeof sl.setData>[0]);
    }
  } else {
    const line = subChart.addSeries(LineSeries, {
      color: pane.color,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    line.setData(pane.data as Parameters<typeof line.setData>[0]);
  }

  const count = data.candles.length;
  const visible = Math.min(50, count);
  const range = { from: count - visible, to: count - 1 };
  mainChart.timeScale().setVisibleLogicalRange(range);
  subChart.timeScale().setVisibleLogicalRange(range);

  return [mainChart, subChart];
}

interface ChartWidgetMiniProps {
  data: ChartDataResponse;
  indicatorName: string;
  indicatorKind: IndicatorKind;
}

export const ChartWidgetMini = memo(function ChartWidgetMini({
  data,
  indicatorName,
  indicatorKind,
}: ChartWidgetMiniProps) {
  const mainRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mainEl = mainRef.current;
    if (!mainEl || data.candles.length === 0) return;

    if (indicatorKind === "overlay") {
      const chart = buildOverlayMini(mainEl, data, indicatorName);
      return () => { chart.remove(); };
    }

    const nameLower = indicatorName.toLowerCase();
    // Exact match to avoid "rsi" colliding with "stochrsi"
    const pane = data.subPanes.find(
      (p) => p.label.toLowerCase() === nameLower,
    );
    if (!pane) {
      const chart = buildOverlayMini(mainEl, data, indicatorName);
      return () => { chart.remove(); };
    }

    const subEl = subRef.current;
    if (!subEl) return;

    const [main, sub] = buildSubPaneMini(mainEl, subEl, data, pane);
    return () => { main.remove(); sub.remove(); };
  }, [data, indicatorName, indicatorKind]);

  const isSubPane = indicatorKind === "subpane";
  const width = isSubPane ? SUBPANE_W : OVERLAY_W;
  const height = isSubPane ? SUBPANE_TOTAL_H : OVERLAY_H;

  return (
    <div
      className="overflow-hidden rounded-[4px] bg-[var(--color-surface-canvas)]"
      style={{ width, height }}
    >
      <div ref={mainRef} style={{ width }} />
      {isSubPane && <div ref={subRef} className="mt-1" style={{ width }} />}
    </div>
  );
});
