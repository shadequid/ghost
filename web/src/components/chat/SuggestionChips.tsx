/**
 * Chat empty state + starter suggestion chips.
 * Visual reference: Figma node 227:746 (Welcome State + Quick Actions).
 */
import { GlobeLoader } from './GlobeLoader';

const STARTER_SUGGESTIONS = [
  'What can you do?',
  'Analyze BTC market',
  'Latest crypto news',
];

const STARTER_NO_WALLET = ['Connect Hyperliquid account', ...STARTER_SUGGESTIONS];

interface SuggestionChipsProps {
  onSelect: (text: string) => void;
  suggestions?: string[];
  hasWallet?: boolean;
}

export function SuggestionChips({ onSelect, suggestions, hasWallet }: SuggestionChipsProps) {
  const items = suggestions ?? (hasWallet ? STARTER_SUGGESTIONS : STARTER_NO_WALLET);
  return (
    <div className="flex flex-wrap gap-2.5">
      {items.map((text, i) => {
        const primary = i === 0;
        // Figma chip: 28px tall, 14px horizontal padding, 6px radius,
        // 13px text-secondary. The first chip carries a slightly heavier
        // border (rgba 45,51,59,0.5) to mark it as the primary suggestion.
        return (
          <button
            key={text}
            onClick={() => onSelect(text)}
            className={
              'bg-transparent rounded-[4px] h-7 px-3.5 inline-flex items-center justify-center ' +
              'text-body-sm text-[var(--color-text-secondary)] cursor-pointer ' +
              'transition-colors duration-fast ease-out ' +
              (primary
                ? 'border border-[rgba(45,51,59,0.5)] hover:bg-white/[0.04] focus-visible:bg-white/[0.04]'
                : 'border border-[var(--color-border-subtle)] hover:bg-white/[0.04] focus-visible:bg-white/[0.04]')
            }
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

const FEATURE_TAGS = ['Market analysis', 'News insights', 'Trade execution'] as const;

/** Centered welcome state shown when the chat has no messages yet.
 * Figma node 227:746 (Welcome State). */
export function EmptyState({ hasWallet }: { hasWallet?: boolean }) {
  const subtitle = hasWallet
    ? 'Your AI companion for HyperLiquid perpetual trading. Ask about crypto markets, get news summaries, or explore trading strategies.'
    : 'Start by connecting your Hyperliquid wallet to unlock the full experience, or ask about crypto markets and latest news.';

  return (
    <div className="flex flex-col items-center gap-8 py-10 px-5">
      <div className="flex flex-col items-center gap-4">
        <GlobeLoader />
        <p className="text-heading-md text-text-primary whitespace-nowrap">
          Ghost is ready
        </p>
      </div>
      <div className="flex flex-col items-center gap-4">
        <p className="text-body-md text-[#7f8b99] text-center max-w-[620px]">
          {subtitle}
        </p>
        <div className="flex items-center gap-6">
          {FEATURE_TAGS.map((label) => (
            <FeatureTag key={label} label={label} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureTag({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-body-sm text-[#7f8b99] whitespace-nowrap">
      <span
        className="w-[5px] h-[5px] rounded-full bg-brand-default flex-shrink-0"
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
