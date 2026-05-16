import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ChartWidget } from "@/components/chart/ChartWidget";
import { useChartData } from "@/hooks/useChartData";

// Standalone /chart route consumed by the Bun.WebView screenshot driver.
// Headless mode (?headless=1) hides all Layout chrome and signals
// window.__chartReady after the chart finishes painting.

export default function ChartPage() {
  const [searchParams] = useSearchParams();

  const symbol = searchParams.get("symbol") ?? "";
  const interval = searchParams.get("interval") ?? "4h";
  const indicators = searchParams.get("indicators") ?? undefined;
  const levelsParam = searchParams.get("levels") ?? undefined;
  const isHeadless = searchParams.get("headless") === "1";

  // Track fetch state so we can fire __chartReady at the right moment.
  // useChartData is a plain fetch hook (no WebSocket) — safe to call here.
  // ChartWidget calls the same hook internally; the in-memory cache means
  // only one actual HTTP request is made.
  const { loading, error } = useChartData(
    symbol || "__missing__",
    interval,
    indicators,
  );

  const hasSymbol = symbol.length > 0;

  useEffect(() => {
    // Always fire __chartReady so the screenshot driver never hangs.
    // Fire immediately on error or missing symbol; otherwise wait for
    // data to land and then double-RAF to let lightweight-charts paint.
    if (!hasSymbol || error) {
      window.__chartReady = true;
      return;
    }

    if (!loading) {
      // Double RAF: first frame queues the paint, second confirms it landed.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          window.__chartReady = true;
        });
      });
    }
  }, [loading, error, hasSymbol]);

  const pageClass = isHeadless ? "chart-page chart-page--headless" : "chart-page";

  if (!hasSymbol) {
    return (
      <div className={pageClass}>
        <p className="chart-error">symbol required</p>
      </div>
    );
  }

  return (
    <div className={pageClass}>
      <ChartWidget
        symbol={symbol}
        interval={interval}
        indicators={indicators}
        levels={levelsParam}
        headless={isHeadless}
      />
    </div>
  );
}
