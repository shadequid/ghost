// Pure helpers + types shared across TweetsWidget + TweetRow.
// Presentational logic (rendering) lives in TweetRow.tsx; data fetching +
// state lives in TweetsWidget.tsx.

export interface Tweet {
  id: string;
  username: string;
  displayName: string | null;
  tweetId: string;
  url: string | null;
  content: string;
  imageUrl: string | null;
  avatarUrl: string | null;
  coins: string[];
  stats: { views: number; replies: number; retweets: number; likes: number; bookmarks?: number } | null;
  publishedAt: number;
}

export interface FollowRow {
  username: string;
  displayName: string | null;
}

export type FetchState = 'idle' | 'running' | 'backoff';

export const REFRESH_INTERVAL = 60_000;
export const PAGE_SIZE = 10;
export const FEED_MAX_HEIGHT = 420;
export const TWEET_CONTENT_LIMIT = 280;

export const COIN_CHIP_CLS =
  'h-[14px] px-[5px] rounded text-footnote leading-none inline-flex items-center bg-[var(--color-brand-subtle)] text-[var(--color-brand-default)] border border-[var(--color-brand-soft)] box-border';

export const MENU_ITEM_CLS =
  'flex items-center gap-2 w-full bg-transparent border-none px-3.5 py-2.5 text-body-sm text-[var(--color-text-primary)] cursor-pointer text-left transition-colors duration-fast ease-out hover:bg-white/[0.05] focus-visible:bg-white/[0.05]';

const RETWEET_PREFIX_RE = /^RT @([A-Za-z0-9_]{1,15}): /;

export interface RetweetInfo {
  originalHandle: string;
  content: string;
}

export function parseRetweet(raw: string): RetweetInfo | null {
  const m = RETWEET_PREFIX_RE.exec(raw);
  if (!m) return null;
  return { originalHandle: m[1], content: raw.slice(m[0].length) };
}

export type TokenKind = 'text' | 'url' | 'cashtag' | 'mention';
export interface Token { kind: TokenKind; value: string; }

// One combined regex, union of the three match kinds. Longest-match-wins is
// implied because alternation picks the first branch that matches at the
// current index; URLs (greedy \S+) beat cashtags/mentions when they overlap.
const TOKEN_RE = /(https?:\/\/\S+)|(\$[A-Za-z]{1,8}\b)|((?<![A-Za-z0-9_])@[A-Za-z0-9_]{1,15}\b)/g;

export function tokenizeContent(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ kind: 'text', value: text.slice(last, m.index) });
    if (m[1]) tokens.push({ kind: 'url', value: m[1] });
    else if (m[2]) tokens.push({ kind: 'cashtag', value: m[2] });
    else if (m[3]) tokens.push({ kind: 'mention', value: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ kind: 'text', value: text.slice(last) });
  return tokens;
}

export function timeAgo(ts: number, nowMs: number = Date.now()): string {
  const diff = Math.floor(nowMs / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

// hashHue moved to `@/components/ui/Avatar-utils` — re-exported here so
// existing `import { hashHue } from './tweet-utils'` call sites keep
// working.
export { hashHue } from '@/components/ui/Avatar-utils';
