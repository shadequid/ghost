import { createContext, useContext } from 'react';

export interface FeedCountsValue {
  newsCount: number;
  tweetsCount: number;
  setNewsCount: (n: number) => void;
  setTweetsCount: (n: number) => void;
}

export const NEWS_KEY = 'ghost.news.count';
export const TWEETS_KEY = 'ghost.tweets.count';

export function readNumber(key: string): number {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

export function writeNumber(key: string, n: number): void {
  try { localStorage.setItem(key, String(n)); } catch { /* ignore */ }
}

export const FeedCountsContext = createContext<FeedCountsValue>({
  newsCount: 0,
  tweetsCount: 0,
  setNewsCount: () => {},
  setTweetsCount: () => {},
});

export function useFeedCounts(): FeedCountsValue {
  return useContext(FeedCountsContext);
}
