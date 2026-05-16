import { useCallback, useState, type ReactNode } from 'react';
import {
  FeedCountsContext,
  NEWS_KEY,
  TWEETS_KEY,
  readNumber,
  writeNumber,
} from './FeedCountsProvider-internals';

// Feed count sync without `window.dispatchEvent`. Previously NewsWidget /
// TweetsWidget fired CustomEvents that Sidebar listened for — two global
// listeners, implicit contract, no TypeScript safety. A context replaces
// both with one typed source of truth that still persists to localStorage
// so counts survive page reloads.

export function FeedCountsProvider({ children }: { children: ReactNode }) {
  const [newsCount, setNewsCountState] = useState<number>(() => readNumber(NEWS_KEY));
  const [tweetsCount, setTweetsCountState] = useState<number>(() => readNumber(TWEETS_KEY));

  const setNewsCount = useCallback((n: number) => {
    setNewsCountState(n);
    writeNumber(NEWS_KEY, n);
  }, []);

  const setTweetsCount = useCallback((n: number) => {
    setTweetsCountState(n);
    writeNumber(TWEETS_KEY, n);
  }, []);

  return (
    <FeedCountsContext.Provider value={{ newsCount, tweetsCount, setNewsCount, setTweetsCount }}>
      {children}
    </FeedCountsContext.Provider>
  );
}
