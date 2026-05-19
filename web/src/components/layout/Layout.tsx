import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Sidebar from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { PortfolioProvider } from '@/components/PortfolioProvider';
import { FeedCountsProvider } from '@/components/layout/FeedCountsProvider';
import { ChartPanelSlot } from '@/components/chart/ChartPanelContext';
import { useChartPanel } from '@/components/chart/ChartPanelContext-internals';
import { useGateway } from '@/hooks/useGateway';

interface StatusInfo {
  provider: string | null;
  model: string | null;
}

/** Fetches the active provider/model from the gateway's `status` RPC so
 * the chat session label stays in sync with whatever the user has
 * configured. */
function useActiveModel(): string | null {
  const { connected, request } = useGateway();
  const [model, setModel] = useState<string | null>(null);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    request<StatusInfo>('status')
      .then((r) => { if (!cancelled) setModel(r.model); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [connected, request]);

  return model;
}

/**
 * Three-column shell matching the Figma AgentGhost layout (node 215:1115):
 *   [TopBar — global icon row]
 *   [LeftSidebar 408px | Outlet (chat) | RightSidebar 408px]
 *
 * The center column carries vertical hairlines on both sides per Figma;
 * sidebars themselves are borderless. Four mint corner brackets frame
 * the chat column. Widget allocation is filtered by the `position` prop
 * on Sidebar (Portfolio + Watchlist on the left, Tweets + News on the
 * right).
 */
export default function Layout() {
  const model = useActiveModel();
  const panel = useChartPanel();
  const chartOpen = panel?.request != null;
  return (
    <PortfolioProvider>
      <FeedCountsProvider>
        {/* h-[100dvh] (dynamic viewport) avoids the iOS Safari bug where
            100vh bleeds under the URL bar and causes unwanted page scroll. */}
        <div className="flex flex-col h-[100dvh] overflow-hidden bg-[var(--color-surface-canvas)] text-[var(--color-text-primary)]">
          <TopBar />
          {/* Inner flex row — `overflow-visible` (no clip) so the
              chat-column session label can extend slightly above main's
              top edge to be vertically centered on the corner bracket's
              horizontal stroke. The OUTER `<div>` keeps overflow-hidden
              so the page itself never scrolls. */}
          <div className="flex flex-1 min-h-0">
            <Sidebar position="left" />
            {/* Wrapper around main + decorations. Wrapper has no
                overflow-hidden so the corner brackets + session label can
                be rendered just outside `<main>`'s top edge without being
                clipped. Main fills the wrapper as a flex-1 child. */}
            <div className="relative flex flex-1 min-w-0">
              <main className="flex-1 min-w-0 flex flex-col overflow-hidden border-t border-l border-r border-[var(--color-border-subtle)]">
                <ChartPanelSlot />
                <div className="flex-1 min-h-0 overflow-hidden">
                  <Outlet />
                </div>
              </main>
              <div className="absolute left-0 -top-[9px] z-30 flex items-center gap-[2px]">
                <div
                  aria-hidden="true"
                  className="pointer-events-none inline-flex items-center px-[7px] h-[18px] rounded-[4px] bg-[#2a2c31] text-text-primary text-label-sm leading-none font-sans"
                >
                  GHOST :/ {model ?? '…'}
                </div>
                {chartOpen && (
                  <button
                    type="button"
                    onClick={() => panel?.close()}
                    aria-label="Close trading view"
                    className="btn-press inline-flex items-center gap-2 pl-2 pr-1.5 h-[18px] rounded-[4px] bg-[#2a2c31] text-text-primary text-label-sm leading-none font-sans cursor-pointer transition-colors duration-fast ease-out hover:bg-[#3a3c42]"
                  >
                    Trading view
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                      <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            <Sidebar position="right" />
          </div>
        </div>
      </FeedCountsProvider>
    </PortfolioProvider>
  );
}
