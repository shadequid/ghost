/**
 * Tweet types — parallel to news-types but without LLM/summary/relevance fields.
 * Tweets are stored raw; no pipeline stage touches an LLM.
 */

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
  stats: TweetStats | null;
  publishedAt: number;
  fetchedAt: number;
  expiresAt: number;
}

export interface TweetStats {
  views: number;
  replies: number;
  retweets: number;
  likes: number;
  bookmarks: number;
}

/** Shape of a tweet produced by x-follows fetch before it is persisted. */
export interface RawTweet {
  username: string;
  displayName?: string;
  tweetId: string;
  url: string;
  content: string;
  imageUrl?: string;
  avatarUrl?: string | null;
  coins: string[];
  publishedAt: number;
  stats?: TweetStats;
}

/** 10 days (seconds) — matches prior X TTL. */
export const TWEET_TTL = 10 * 86_400;
