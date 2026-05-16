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

function GripDots() {
  return (
    <svg width="7" height="11" viewBox="0 0 7 11" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M1.42871 7.52148C2.21729 7.52172 2.85645 8.16156 2.85645 8.9502C2.85633 9.73873 2.21722 10.3777 1.42871 10.3779C0.639995 10.3779 0.000113696 9.73888 0 8.9502C0 8.16142 0.639925 7.52148 1.42871 7.52148ZM5.18945 7.52148C5.97815 7.52159 6.61719 8.16148 6.61719 8.9502C6.61707 9.73881 5.97808 10.3778 5.18945 10.3779C4.40074 10.3779 3.76086 9.73888 3.76074 8.9502C3.76074 8.16142 4.40067 7.52148 5.18945 7.52148ZM1.42871 3.76074C2.21729 3.76098 2.85645 4.40082 2.85645 5.18945C2.85633 5.97799 2.21722 6.61695 1.42871 6.61719C0.639995 6.61719 0.000114212 5.97814 0 5.18945C0 4.40067 0.639925 3.76074 1.42871 3.76074ZM5.18945 3.76074C5.97815 3.76084 6.61719 4.40074 6.61719 5.18945C6.61707 5.97807 5.97808 6.61708 5.18945 6.61719C4.40074 6.61719 3.76086 5.97814 3.76074 5.18945C3.76074 4.40067 4.40067 3.76074 5.18945 3.76074ZM1.42871 0C2.21711 0.000263058 2.85619 0.639337 2.85645 1.42773C2.85645 2.21635 2.21727 2.85618 1.42871 2.85645C0.639925 2.85645 0 2.21651 0 1.42773C0.000257835 0.639174 0.640084 0 1.42871 0ZM5.18945 0C5.97815 0.000102745 6.61719 0.639995 6.61719 1.42871C6.61694 2.21721 5.978 2.85634 5.18945 2.85645C4.40082 2.85645 3.76099 2.21728 3.76074 1.42871C3.76074 0.639931 4.40067 0 5.18945 0Z" fill="#3BF7BF" />
    </svg>
  );
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
                  className="pointer-events-none inline-flex items-center gap-2 px-[7px] h-[18px] rounded-[4px] bg-[#2a2c31] text-text-primary text-label-sm leading-none font-sans"
                >
                  <GripDots />
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
