import { type ReactElement } from 'react';
import { PulsingDots } from '@/components/chat/PulsingDots';

const X_BLUE = '#40a6ff';

const xLogo = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={X_BLUE}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

function IconBox({ children }: { children: ReactElement }) {
  return (
    <div className="size-[38px] rounded-[4px] bg-[rgba(13,142,255,0.1)] border border-[rgba(13,142,255,0.2)] flex items-center justify-center shrink-0">
      {children}
    </div>
  );
}

/** Waiting-for-status placeholder (pulsing dots, no copy). */
export function TweetsStatusPending() {
  return (
    <div className="px-4 py-6 flex flex-col items-center gap-2">
      <IconBox><PulsingDots color={X_BLUE} /></IconBox>
    </div>
  );
}

interface TweetsEmptyProps {
  title: string;
  subtitle?: string;
  cta?: { label: string; onClick: () => void };
}

/** Empty/CTA state — variants: "connect X", "manage follows", "no tweets yet".
 *  Figma node 710:6298. */
export function TweetsEmpty({ title, subtitle, cta }: TweetsEmptyProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-[18px] px-[18px] pt-6 pb-8">
      <div className="flex flex-col items-center gap-2.5">
        <IconBox>{xLogo}</IconBox>
        <div className="flex flex-col items-center gap-1 leading-[1.5]">
          <span className="text-body-md-semibold text-text-primary">{title}</span>
          {subtitle && (
            <span className="text-body-sm text-text-secondary text-center">{subtitle}</span>
          )}
        </div>
      </div>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          className="btn-press min-w-[96px] h-8 px-3 flex items-center justify-center border border-[#40a6ff] rounded-[4px] bg-transparent text-[#40a6ff] text-body-md-semibold whitespace-nowrap cursor-pointer transition-colors duration-fast ease-out hover:bg-[rgba(64,166,255,0.08)]"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

interface TweetsFetchingProps {
  running: boolean;
}

/** "Fetching X timeline…" with pulsing dots. Shown mid-cycle before first batch. */
export function TweetsFetching({ running }: TweetsFetchingProps) {
  const title = running ? 'Fetching X timeline…' : 'Fetching tweets…';
  const subtitle = running
    ? 'This can take up to a minute on first connect.'
    : null;
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 pb-8 pt-2">
      <div className="flex flex-col items-center gap-2">
        <IconBox>{xLogo}</IconBox>
        <div className="flex flex-col items-center gap-1 leading-[1.5]">
          <span className="text-body-md-semibold text-text-primary">{title}</span>
          {subtitle && (
            <span className="text-body-sm text-text-secondary text-center">{subtitle}</span>
          )}
        </div>
      </div>
      <PulsingDots color={X_BLUE} />
    </div>
  );
}
