import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { TweetService } from "../../src/services/tweets.js";
import type { RawTweet } from "../../src/services/tweets-types.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import { initDatabase } from "../../src/core/database.js";
import { runDbMigrations } from "../../src/core/migrations/db.js";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function createTempDb(): Promise<{ db: Database; path: string }> {
  const dir = join(tmpdir(), `ghost-test-tweets-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  const dbPath = join(dir, "test.db");
  const db = initDatabase(dbPath);
  await runDbMigrations(db, DB_MIGRATIONS);
  return { db, path: dbPath };
}

function makeTweet(overrides: Partial<RawTweet> = {}): RawTweet {
  const now = Math.floor(Date.now() / 1000);
  return {
    username: "cz_binance",
    tweetId: String(Math.floor(Math.random() * 1e16)),
    url: "https://x.com/cz_binance/status/1",
    content: "BTC to the moon",
    coins: ["BTC"],
    publishedAt: now,
    ...overrides,
  };
}

describe("TweetService", () => {
  let db: Database;
  let service: TweetService;

  beforeEach(async () => {
    const res = await createTempDb();
    db = res.db;
    service = new TweetService(db, NOOP_LOGGER);
  });

  afterEach(() => { db.close(); });

  describe("insertTweets", () => {
    test("inserts a fresh tweet", () => {
      const count = service.insertTweets([makeTweet({ tweetId: "111" })]);
      expect(count).toBe(1);
      expect(service.getTweets()).toHaveLength(1);
    });

    test("is idempotent on (username, tweet_id)", () => {
      const raw = makeTweet({ tweetId: "222" });
      expect(service.insertTweets([raw])).toBe(1);
      expect(service.insertTweets([raw])).toBe(0);
      expect(service.getTweets()).toHaveLength(1);
    });

    test("still refreshes stats on re-insert", () => {
      const raw = makeTweet({
        tweetId: "333",
        stats: { views: 10, replies: 0, retweets: 0, likes: 0, bookmarks: 0 },
      });
      service.insertTweets([raw]);
      service.insertTweets([{ ...raw, stats: { views: 50, replies: 1, retweets: 2, likes: 3, bookmarks: 0 } }]);
      const [tw] = service.getTweets();
      expect(tw.stats?.views).toBe(50);
      expect(tw.stats?.likes).toBe(3);
    });

    test("prunes expired tweets on insert", () => {
      const long_ago = Math.floor(Date.now() / 1000) - 20 * 86_400;
      // Manually insert an already-expired row so we can verify pruning
      db.prepare(`
        INSERT INTO tweets (id, username, tweet_id, url, content, coins, stats_json, published_at, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), "old", "9", null, "old content", "[]", null, long_ago, long_ago, long_ago - 100);

      expect(service.getTweets({ limit: 100 })).toHaveLength(1);
      service.insertTweets([makeTweet({ tweetId: "444" })]);
      expect(service.getTweets({ limit: 100 })).toHaveLength(1);
    });
  });

  describe("getTweets cursor pagination", () => {
    test("returns tweets ordered by published_at desc", () => {
      const now = Math.floor(Date.now() / 1000);
      service.insertTweets([
        makeTweet({ tweetId: "1", publishedAt: now - 100 }),
        makeTweet({ tweetId: "2", publishedAt: now - 50 }),
        makeTweet({ tweetId: "3", publishedAt: now }),
      ]);
      const rows = service.getTweets();
      expect(rows[0].tweetId).toBe("3");
      expect(rows[2].tweetId).toBe("1");
    });

    test("before cursor returns older tweets only", () => {
      const now = Math.floor(Date.now() / 1000);
      service.insertTweets([
        makeTweet({ tweetId: "a", publishedAt: now - 300 }),
        makeTweet({ tweetId: "b", publishedAt: now - 200 }),
        makeTweet({ tweetId: "c", publishedAt: now - 100 }),
      ]);
      const first = service.getTweets({ limit: 1 });
      expect(first).toHaveLength(1);
      const rest = service.getTweets({
        limit: 10,
        beforePublishedAt: first[0].publishedAt,
        beforeId: first[0].id,
      });
      expect(rest.map((t) => t.tweetId)).toEqual(["b", "a"]);
    });

    test("after cursor returns newer tweets only", () => {
      const now = Math.floor(Date.now() / 1000);
      service.insertTweets([
        makeTweet({ tweetId: "x", publishedAt: now - 300 }),
        makeTweet({ tweetId: "y", publishedAt: now - 200 }),
      ]);
      const baseline = service.getTweets();
      const oldest = baseline[baseline.length - 1];

      service.insertTweets([makeTweet({ tweetId: "z", publishedAt: now })]);

      const newer = service.getTweets({
        limit: 10,
        afterPublishedAt: baseline[0].publishedAt,
        afterId: baseline[0].id,
      });
      expect(newer.map((t) => t.tweetId)).toEqual(["z"]);
      expect(oldest.tweetId).toBe("x");
    });
  });

  describe("searchTweets", () => {
    test("filters by keyword", () => {
      service.insertTweets([
        makeTweet({ tweetId: "1", content: "BTC halving soon" }),
        makeTweet({ tweetId: "2", content: "New ETH upgrade" }),
      ]);
      const rows = service.searchTweets({ query: "halving" });
      expect(rows).toHaveLength(1);
      expect(rows[0].tweetId).toBe("1");
    });

    test("filters by coins", () => {
      service.insertTweets([
        makeTweet({ tweetId: "1", coins: ["BTC"] }),
        makeTweet({ tweetId: "2", coins: ["ETH"] }),
      ]);
      const rows = service.searchTweets({ coins: ["BTC"] });
      expect(rows).toHaveLength(1);
      expect(rows[0].coins).toContain("BTC");
    });

    test("filters by username", () => {
      service.insertTweets([
        makeTweet({ username: "cz_binance", tweetId: "1" }),
        makeTweet({ username: "vitalikbuterin", tweetId: "2" }),
      ]);
      expect(service.searchTweets({ username: "vitalikbuterin" })).toHaveLength(1);
      expect(service.searchTweets({ username: "@cz_binance" })).toHaveLength(1);
    });

    test("respects limit", () => {
      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < 25; i++) {
        service.insertTweets([makeTweet({ tweetId: `id-${i}`, publishedAt: now - i })]);
      }
      expect(service.searchTweets({ limit: 5 })).toHaveLength(5);
    });
  });

  describe("dismissTweet", () => {
    test("dismissed tweets are hidden from getTweets", () => {
      service.insertTweets([makeTweet({ tweetId: "1" }), makeTweet({ tweetId: "2" })]);
      const rows = service.getTweets();
      expect(rows).toHaveLength(2);
      service.dismissTweet(rows[0].id);
      expect(service.getTweets()).toHaveLength(1);
    });
  });

  describe("pruneExpired", () => {
    test("removes tweets past their expires_at", () => {
      const long_ago = Math.floor(Date.now() / 1000) - 20 * 86_400;
      db.prepare(`
        INSERT INTO tweets (id, username, tweet_id, url, content, coins, stats_json, published_at, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), "old", "1", null, "", "[]", null, long_ago, long_ago, long_ago - 10);

      expect(service.pruneExpired()).toBe(1);
      expect(service.getTweets()).toHaveLength(0);
    });
  });
});
