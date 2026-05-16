import { useCallback, useEffect, useRef, useState } from 'react';
import { useGateway } from '@/hooks/useGateway';
import type { NewsArticle } from './news-utils';

const REFRESH_INTERVAL = 60_000;
const PAGE_SIZE = 10;

export interface UseNewsArticlesResult {
  articles: NewsArticle[];
  total: number;
  hasFetched: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => Promise<void>;
  setArticlesDirect: (updater: (prev: NewsArticle[]) => NewsArticle[]) => void;
  setTotal: (updater: (prev: number) => number) => void;
}

/**
 * News list data layer — owns the connected-aware initial fetch, the
 * cursor-based auto-refresh (newest above), and pagination via `loadMore`.
 * Lifted out of NewsWidget so the component stays under the 300 LOC bar and
 * the data-fetching behavior can be unit-tested independently.
 *
 * `setArticlesDirect` is exposed because the widget needs to splice articles
 * locally (dismiss). Same for `setTotal` (decrement on dismiss).
 */
export function useNewsArticles(initialTotal: number): UseNewsArticlesResult {
  const { request, connected } = useGateway();
  const [articles, setArticles] = useState<NewsArticle[]>([]);
  const [total, setTotal] = useState<number>(initialTotal);
  const [hasFetched, setHasFetched] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const hasArticlesRef = useRef(false);
  const topArticleRef = useRef<NewsArticle | null>(null);
  const bottomArticleRef = useRef<NewsArticle | null>(null);
  useEffect(() => {
    topArticleRef.current = articles[0] ?? null;
    bottomArticleRef.current = articles[articles.length - 1] ?? null;
  }, [articles]);

  const fetchArticles = useCallback(async () => {
    if (!connected) return;
    const top = topArticleRef.current;
    try {
      // Cursor-based refresh: if we already have articles, only pull ones newer than the top.
      // Prevents auto-refresh from wiping Load more pages and stops shuffling when the
      // evaluator job marks new articles as relevant mid-session.
      const params: { limit: number; afterPublishedAt?: number; afterId?: string } = {
        limit: PAGE_SIZE,
      };
      if (top) {
        params.afterPublishedAt = top.publishedAt;
        params.afterId = top.id;
      }
      const res = await request<{ articles: NewsArticle[]; total?: number }>(
        'trading.news.list',
        params,
      );
      const list = res.articles ?? [];
      if (typeof res.total === 'number') setTotal(res.total);
      if (!top) {
        setArticles(list);
        setHasMore(list.length >= PAGE_SIZE);
        hasArticlesRef.current = list.length > 0;
      } else if (list.length > 0) {
        setArticles((prev) => [...list, ...prev]);
      }
      setHasFetched(true);
    } catch {
      /* ignore */
    }
  }, [connected, request]);

  const loadMore = useCallback(async () => {
    if (!connected || loadingMore) return;
    const bottom = bottomArticleRef.current;
    if (!bottom) return;
    setLoadingMore(true);
    try {
      const res = await request<{ articles: NewsArticle[]; total?: number }>(
        'trading.news.list',
        {
          limit: PAGE_SIZE,
          beforePublishedAt: bottom.publishedAt,
          beforeId: bottom.id,
        },
      );
      const list = res.articles ?? [];
      if (typeof res.total === 'number') setTotal(res.total);
      if (list.length === 0) {
        setHasMore(false);
        return;
      }
      setArticles((prev) => [...prev, ...list]);
      setHasMore(list.length >= PAGE_SIZE);
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [connected, request, loadingMore]);

  useEffect(() => {
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      fetchArticles();
      const delay = hasArticlesRef.current ? REFRESH_INTERVAL : 5_000;
      timerId = setTimeout(schedule, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
  }, [fetchArticles]);

  const setArticlesDirect = useCallback(
    (updater: (prev: NewsArticle[]) => NewsArticle[]) => setArticles(updater),
    [],
  );
  const setTotalDirect = useCallback(
    (updater: (prev: number) => number) => setTotal(updater),
    [],
  );

  return {
    articles,
    total,
    hasFetched,
    hasMore,
    loadingMore,
    loadMore,
    setArticlesDirect,
    setTotal: setTotalDirect,
  };
}
