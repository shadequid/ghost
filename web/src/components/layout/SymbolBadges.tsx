import { splitSymbol } from './symbol-utils';

interface SymbolBadgesProps {
  symbol: string;
  maxLeverages: Record<string, number>;
}

/**
 * Renders the base name of a symbol plus optional HIP-3 metadata pills.
 * Neutral chip palette (bg-white/[0.06] text-muted-foreground) is intentional —
 * brand-green #00ff88 is reserved for positive state (long, success, alerts).
 */
export function SymbolBadges({ symbol, maxLeverages }: SymbolBadgesProps) {
  const { dex, base } = splitSymbol(symbol);
  const lev = maxLeverages[symbol];
  return (
    <>
      <span className="text-body-md text-white leading-[14px]">{base}</span>
      {lev != null && (
        <span
          className="inline-flex items-center h-[14px] px-1 text-footnote leading-none rounded-[2px] bg-[rgba(0,255,136,0.12)] text-[#00ff88]"
          aria-label={`Max leverage ${lev}×`}
          title={`Max leverage ${lev}×`}
        >
          {lev}x
        </span>
      )}
      {dex && (
        <span
          className="inline-flex items-center h-[14px] px-1 text-footnote leading-none rounded-[2px] bg-[rgba(0,255,136,0.12)] text-[#00ff88]"
          aria-label={`HIP-3 dex ${dex}`}
          title={`HIP-3 dex ${dex}`}
        >
          {dex.toUpperCase()}
        </span>
      )}
    </>
  );
}
