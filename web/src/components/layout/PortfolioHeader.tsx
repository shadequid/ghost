import { type ReactNode, useEffect, useRef, useState } from 'react';
import ghostSymbol from '@/assets/ghost-symbol.svg';
import { usePortfolio } from '@/hooks/usePortfolio';

interface Props {
  children: ReactNode;
  /** Override the card border color (CSS color). Used by the no-wallet
   *  state to draw attention to the Connect Wallet CTA. */
  borderColor?: string;
}

const BOB_RATE_LIMIT_MS = 9_000;

/** Portfolio widget shell — Figma node 297:2942.
 *  Mint-bordered card. Ghost symbol + "\: PORTFOLIO" overlap the
 *  top-left of the border. The decoration block is wrapped with
 *  `z-index: 30` (> topbar `z-20`) so it paints OVER the opaque topbar
 *  at scroll=0; once it scrolls past the scroll container's top edge
 *  it clips naturally. */
export function PortfolioHeader({ children, borderColor }: Props) {
  const { lastFetchedAt } = usePortfolio();
  // One-shot bob per real poll tick. Rate-limited so event-driven
  // refreshes (chat.done, alert.*) don't spam the animation — only the
  // 10s interval is intended to surface "I'm refreshing".
  const [bobKey, setBobKey] = useState(0);
  const lastBobAtRef = useRef(0);

  useEffect(() => {
    const now = Date.now();
    if (now - lastBobAtRef.current < BOB_RATE_LIMIT_MS) return;
    lastBobAtRef.current = now;
    setBobKey((k) => k + 1);
  }, [lastFetchedAt]);

  return (
    <div className="relative pt-8">
      <div
        className="border rounded-[2px] overflow-hidden"
        style={{ borderColor: borderColor ?? 'var(--color-border-subtle)' }}
      >
        {children}
      </div>

      {/* Decoration block — z-30 escapes the opaque topbar (z-20) at
          scroll=0; clips naturally once scrolled past the scroll
          container's top edge. pointer-events-none keeps topbar icons
          clickable when the decor overlays them. */}
      <div
        className="absolute top-0 left-0 h-[43px]"
        style={{ position: 'absolute', zIndex: 30, pointerEvents: 'none' }}
      >
        {/* 1px canvas stripe — hides the border line behind this row, plus
            a 7px tail past the title's right edge so the line restarts with
            a visible gap (instead of butting up against the text). Border
            sits at parent y=32 (matches `pt-8`); wrapper top is at
            parent y=0, so stripe is at wrapper-y=32. */}
        <div className="absolute left-0 -right-[7px] top-[32px] h-px bg-surface-canvas pointer-events-none" />

        <div className="relative flex items-end">
          <img
            key={bobKey}
            src={ghostSymbol}
            alt=""
            width={35}
            height={43}
            className="block ghost-symbol-bob"
            aria-hidden="true"
          />
          <span className="text-body-md-semibold leading-none text-brand-default whitespace-nowrap pb-[2px] pl-3">
            \: PORTFOLIO
          </span>
        </div>
      </div>
    </div>
  );
}
