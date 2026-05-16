import { useState, useEffect, useCallback, useRef, type ReactElement, type ReactNode } from 'react';
import { useGateway } from '@/hooks/useGateway';
import { PulsingDots } from '@/components/chat/PulsingDots';
import { XAuthModal } from '@/components/XAuthModal';
import { useFeedCounts } from '@/components/layout/FeedCountsProvider-internals';
import { TweetsFilterModal } from './FilterPromptModal';
import { WidgetHeaderMenu } from './WidgetHeaderMenu';
import settingsIcon from '@/assets/tweets-settings.svg';
import menuFilter from '@/assets/menu-filter.svg';
import menuPersonalCard from '@/assets/menu-personalcard.svg';
import {
  type Tweet,
  type FollowRow,
  type FetchState,
  REFRESH_INTERVAL,
  PAGE_SIZE,
  FEED_MAX_HEIGHT,
} from './tweet-utils';
import { TweetRow } from './TweetRow';
import { TweetsEmpty, TweetsFetching, TweetsStatusPending } from './TweetsEmpty';

interface TweetsAuthUser {
  screenName: string;
  name: string;
}

const X_BRAND = '#40a6ff';

function XLogoSmall() {
  return (
    <svg width="18" height="16" viewBox="0 0 24 24" fill={X_BRAND} aria-hidden="true" className="shrink-0">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

/** Tweets widget shell — Figma node 297:2415. Bordered card with internal
 *  "TWEETS" header so the empty / connected states share the same outline.
 *  When `authUser` is present (connected state), shows `@screenName (name)`
 *  + settings icon on the right of the header. */
interface TweetsShellProps {
  children: ReactNode;
  authUser?: TweetsAuthUser | null;
  onOpenFilter?: () => void;
  onOpenFollows?: () => void;
}

function TweetsShell({ children, authUser, onOpenFilter, onOpenFollows }: TweetsShellProps) {
  const showMenu = Boolean(onOpenFilter && onOpenFollows);
  return (
    <div className="overflow-hidden flex flex-col first:pt-8">
      <div className="bg-surface-base h-10 flex items-center gap-2 px-4 py-1 shrink-0 border-y border-border-subtle">
        <XLogoSmall />
        <span className="text-body-md-semibold text-text-primary">TWEETS</span>
        <div className="ml-auto flex items-center gap-3">
          {authUser && (
            <span className="text-footnote text-[#40a6ff] whitespace-nowrap">
              @{authUser.screenName}{authUser.name ? ` (${authUser.name})` : ''}
            </span>
          )}
          {showMenu && (
            <WidgetHeaderMenu
              triggerLabel="Tweets options"
              menuLabel="Tweets options"
              trigger={<img src={settingsIcon} alt="" aria-hidden="true" className="w-[18px] h-[18px] opacity-70 hover:opacity-100" />}
              items={[
                {
                  key: 'filter',
                  icon: <img src={menuFilter} alt="" aria-hidden="true" width={16} height={16} className="block" />,
                  label: 'Tweets Filter',
                  onSelect: onOpenFilter!,
                },
                {
                  key: 'follows',
                  icon: <img src={menuPersonalCard} alt="" aria-hidden="true" width={16} height={16} className="block" />,
                  label: 'Manage Follower',
                  onSelect: onOpenFollows!,
                },
              ]}
            />
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

export function TweetsWidget() {
  const { request, subscribe, connected } = useGateway();
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [hasAuth, setHasAuth] = useState<boolean | null>(null);
  const [authUser, setAuthUser] = useState<TweetsAuthUser | null>(null);
  const [follows, setFollows] = useState<FollowRow[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [includeFollowing, setIncludeFollowing] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const menuRef = useRef<HTMLDivElement>(null);

  // Ticks every 30 s so relative times ("5m ago") stay fresh without re-fetching.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const topTweetRef = useRef<Tweet | null>(null);
  const bottomTweetRef = useRef<Tweet | null>(null);
  useEffect(() => {
    topTweetRef.current = tweets[0] ?? null;
    bottomTweetRef.current = tweets[tweets.length - 1] ?? null;
  }, [tweets]);

  // Total tweet count syncs via FeedCountsContext (handles persistence).
  // Mirror state stays so setTotal(...) call-sites throughout this file
  // continue working unchanged.
  const { tweetsCount, setTweetsCount } = useFeedCounts();
  const [total, setTotal] = useState<number>(tweetsCount);
  useEffect(() => {
    setTweetsCount(total);
  }, [total, setTweetsCount]);

  const fetchStatus = useCallback(() => {
    if (!connected) return;
    request<{ hasAuth: boolean; authUser?: TweetsAuthUser | null; follows: FollowRow[]; includeFollowing: boolean; fetchState?: FetchState }>(
      'trading.tweets.status',
    )
      .then((res) => {
        setHasAuth(res.hasAuth);
        setAuthUser(res.authUser ?? null);
        setFollows(res.follows ?? []);
        setIncludeFollowing(!!res.includeFollowing);
        setFetchState(res.fetchState ?? 'idle');
      })
      .catch(() => {});
  }, [connected, request]);

  const hasTweetsRef = useRef(false);

  const fetchTweets = useCallback(async () => {
    if (!connected) return;
    const top = topTweetRef.current;
    try {
      const params: {
        limit: number;
        afterPublishedAt?: number;
        afterId?: string;
      } = { limit: PAGE_SIZE };
      if (top) {
        params.afterPublishedAt = top.publishedAt;
        params.afterId = top.id;
      }
      const res = await request<{ tweets: Tweet[]; total?: number }>('trading.tweets.list', params);
      const list = res.tweets ?? [];
      if (typeof res.total === 'number') setTotal(res.total);
      if (!top) {
        setTweets(list);
        setHasMore(list.length >= PAGE_SIZE);
        hasTweetsRef.current = list.length > 0;
      } else if (list.length > 0) {
        setTweets((prev) => [...list, ...prev]);
      }
      setHasFetched(true);
    } catch { /* ignore */ }
  }, [connected, request]);

  // Initial + periodic refresh — runs as long as we have any tweet source
  // (manual follows OR the "include X following" toggle).
  useEffect(() => {
    if (hasAuth !== true) return;
    if (follows.length === 0 && !includeFollowing) return;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const schedule = () => {
      if (cancelled) return;
      fetchTweets();
      const delay = hasTweetsRef.current ? REFRESH_INTERVAL : 5_000;
      timerId = setTimeout(schedule, delay);
    };
    schedule();
    return () => { cancelled = true; if (timerId) clearTimeout(timerId); };
  }, [hasAuth, follows.length, includeFollowing, fetchTweets]);

  // Fetch status on mount + on connect
  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // Push refresh on incremental tweet inserts from the daemon. Without this,
  // users see nothing for the ~50 s first-connect cycle. We re-fetch both the
  // feed (to pull in the new rows) and status (so the spinner clears once
  // the cycle transitions idle).
  useEffect(() => {
    return subscribe((evt) => {
      if (evt.event === 'trading.tweets.inserted') {
        fetchTweets();
        fetchStatus();
      }
    });
  }, [subscribe, fetchTweets, fetchStatus]);

  // Poll status while a fetch cycle is running so the "Fetching…" hint
  // eventually clears even if the last batch emits zero new tweets (and thus
  // no tweets.inserted event) — e.g. followed accounts with no recent posts.
  useEffect(() => {
    if (fetchState !== 'running') return;
    const id = setInterval(fetchStatus, 5_000);
    return () => clearInterval(id);
  }, [fetchState, fetchStatus]);

  const loadMore = useCallback(async () => {
    if (!connected || loadingMore) return;
    const bottom = bottomTweetRef.current;
    if (!bottom) return;
    setLoadingMore(true);
    try {
      const res = await request<{ tweets: Tweet[]; total?: number }>('trading.tweets.list', {
        limit: PAGE_SIZE,
        beforePublishedAt: bottom.publishedAt,
        beforeId: bottom.id,
      });
      const list = res.tweets ?? [];
      if (typeof res.total === 'number') setTotal(res.total);
      if (list.length === 0) { setHasMore(false); return; }
      setTweets((prev) => [...prev, ...list]);
      setHasMore(list.length >= PAGE_SIZE);
    } catch { /* ignore */ }
    finally { setLoadingMore(false); }
  }, [connected, request, loadingMore]);

  const dismissTweet = useCallback((id: string) => {
    request('trading.tweets.dismiss', { id }).catch(() => {});
    setTweets((prev) => prev.filter((t) => t.id !== id));
    setTotal((t) => Math.max(0, t - 1));
  }, [request]);

  // Listen for manage / settings events from sidebar widget header
  useEffect(() => {
    const handler = () => setShowModal(true);
    window.addEventListener('ghost:tweets-manage', handler);
    window.addEventListener('ghost:tweets-open-settings', handler);
    return () => {
      window.removeEventListener('ghost:tweets-manage', handler);
      window.removeEventListener('ghost:tweets-open-settings', handler);
    };
  }, []);

  // Close article menu on click outside
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  const toggleMenu = useCallback((id: string) => {
    setMenuOpenId((prev) => prev === id ? null : id);
  }, []);
  const closeMenu = useCallback(() => setMenuOpenId(null), []);

  let body: ReactElement;
  if (hasAuth === null) {
    body = <TweetsStatusPending />;
  } else if (!hasAuth) {
    body = (
      <TweetsEmpty
        title="Connect X to see tweets"
        subtitle="Tweets from accounts you follow on X."
        cta={{ label: 'Connect X', onClick: () => setShowModal(true) }}
      />
    );
  } else if (follows.length === 0 && !includeFollowing) {
    body = (
      <TweetsEmpty
        title="No accounts followed"
        subtitle='Add an X account or enable "Include accounts you follow on X.com".'
        cta={{ label: 'Manage follows', onClick: () => setShowModal(true) }}
      />
    );
  } else if (!hasFetched || (tweets.length === 0 && fetchState === 'running')) {
    // Daemon is mid-cycle and hasn't inserted anything yet. On first connect
    // this can take up to ~1 minute (50 accounts × 1 req/s rate limit), so
    // we spell it out instead of leaving a bare spinner.
    body = <TweetsFetching running={fetchState === 'running'} />;
  } else if (tweets.length === 0) {
    body = (
      <TweetsEmpty
        title="No tweets yet"
        subtitle="New tweets from your followed accounts will appear here."
      />
    );
  } else {
    body = (
      <div className="overflow-y-auto" style={{ maxHeight: FEED_MAX_HEIGHT }}>
        {tweets.map((t) => (
          <TweetRow
            key={t.id}
            tweet={t}
            now={now}
            isExpanded={expandedIds.has(t.id)}
            menuOpen={menuOpenId === t.id}
            menuRef={menuRef}
            onToggleExpand={toggleExpand}
            onToggleMenu={toggleMenu}
            onDismiss={dismissTweet}
            onCloseMenu={closeMenu}
          />
        ))}
        {hasMore && (
          <div className="h-11 flex items-center justify-center py-3">
            <button
              type="button"
              disabled={loadingMore}
              className={
                'bg-transparent border-none p-0 text-body-sm text-text-secondary inline-flex items-center gap-2 transition-colors duration-fast ease-out '
                + (loadingMore
                  ? 'text-[#00b8ff] cursor-default'
                  : 'cursor-pointer hover:text-text-primary focus-visible:text-text-primary')
              }
              onClick={loadMore}
            >
              {loadingMore ? (
                <><span>Loading</span><PulsingDots color="#00b8ff" /></>
              ) : 'Load more'}
            </button>
          </div>
        )}
      </div>
    );
  }

  const showHeaderControls = hasAuth === true;
  return (
    <>
      <TweetsShell
        authUser={showHeaderControls ? authUser : null}
        onOpenFilter={showHeaderControls ? () => setFilterModalOpen(true) : undefined}
        onOpenFollows={showHeaderControls ? () => setShowModal(true) : undefined}
      >
        {body}
      </TweetsShell>
      <XAuthModal
        open={showModal}
        onClose={() => { setShowModal(false); fetchStatus(); }}
        onSuccess={() => { fetchStatus(); }}
      />
      <TweetsFilterModal open={filterModalOpen} onClose={() => setFilterModalOpen(false)} />
    </>
  );
}
