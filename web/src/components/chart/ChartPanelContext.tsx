import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useChartData } from "@/hooks/useChartData";
import { FullscreenOverlay } from "./ChartWidget";
import {
  ChartPanelCtx,
  useChartPanel,
  type ChartPanelRequest,
} from "./ChartPanelContext-internals";

export { useChartPanel } from "./ChartPanelContext-internals";

const DEFAULT_INTERVAL = "4h";
const PANEL_HEIGHT = 351;

/** Inline chart panel mounted at the top of the chat column. Replaces the
 *  legacy fullscreen overlay — Figma node 331:3350. Single slot only; opening
 *  a new symbol swaps. Esc key + the ESC button close it. State resets on
 *  route change (per spec). */
export function ChartPanelProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ChartPanelRequest | null>(null);

  const open = useCallback((req: ChartPanelRequest) => setRequest(req), []);
  const close = useCallback(() => setRequest(null), []);

  // Reset on route change.
  const location = useLocation();
  useEffect(() => { setRequest(null); }, [location.pathname]);

  return (
    <ChartPanelCtx.Provider value={{ request, open, close }}>
      {children}
    </ChartPanelCtx.Provider>
  );
}

/** Mount-once slot: renders the active chart panel inline. Place in Layout
 *  above the chat outlet. Fetches data per the current request; swap is
 *  handled by re-running useChartData when symbol/interval change. */
export function ChartPanelSlot() {
  // Hook usage is gated by the surrounding context, so this never throws when
  // the slot is mounted inside the provider — see Layout.tsx.
  const panel = useChartPanel();
  const symbol = panel?.request?.symbol ?? null;
  const requestedInterval = panel?.request?.interval ?? DEFAULT_INTERVAL;
  const focus = panel?.request?.focus;

  // Local override lets the user switch timeframes from the panel header.
  // Reset whenever the symbol or the requested interval changes.
  const [interval, setInterval] = useState(requestedInterval);
  useEffect(() => { setInterval(requestedInterval); }, [symbol, requestedInterval]);

  // When the open request focuses an indicator (e.g. ichimoku, adx, obv),
  // ask the backend for that indicator explicitly — `/api/chart-data` only
  // returns indicators listed in the querystring, so omitting it leaves the
  // panel rendering the bare candles.
  const indicators = focus?.kind === "indicator" ? focus.name : undefined;

  // useChartData always runs (hook order); it no-ops when symbol is empty.
  const { data, error } = useChartData(symbol ?? "", interval, indicators);

  // ESC closes from anywhere while panel is open.
  useEffect(() => {
    if (!panel?.request) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") panel.close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  if (!panel?.request || !symbol) return null;

  if (error && !data) {
    return (
      <div
        className="relative flex items-center justify-center bg-[var(--color-surface-base)] border-t border-b border-[var(--color-border-subtle)]"
        style={{ height: PANEL_HEIGHT }}
      >
        <span className="text-[var(--color-error-text)] text-caption">{error}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div
        className="relative flex items-center justify-center bg-[var(--color-surface-base)] border-t border-b border-[var(--color-border-subtle)]"
        style={{ height: PANEL_HEIGHT }}
      >
        <span className="text-text-secondary text-caption">Loading {symbol}…</span>
      </div>
    );
  }

  return (
    <FullscreenOverlay
      mode="panel"
      panelHeight={PANEL_HEIGHT}
      data={data}
      extraLevels={[]}
      focusTime={null}
      focusPrice={null}
      focus={focus}
      interval={interval}
      onIntervalChange={setInterval}
      onClose={panel.close}
    />
  );
}

