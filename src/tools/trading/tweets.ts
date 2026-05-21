/**
 * Tweet tools — agent-facing.
 *
 * ghost_tweets_search — query the local tweets cache (read-only).
 *
 * The filter prompt is no longer exposed as a chat tool. Users edit it via
 * the "Tweets Filter" modal in the web UI, which writes the same
 * `tweets.filter_prompt` PreferenceStore key the background evaluator reads.
 */

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { defineTool } from "./types.js";
import type { TweetService } from "../../services/tweets.js";
import { textResult, errorResult, getErrorMessage } from "../../helpers/result.js";

export function createTweetsTools(tweets: TweetService): AgentTool[] {
  return [
    defineTool({
      name: "ghost_tweets_search",
      label: "Tweets Search",
      description:
        "Search tweets from followed X/Twitter accounts. " +
        "Local cache, updated every ~5 min. Tweets are stored raw (no LLM). " +
        "No params returns recent tweets. Filter by keyword, coins, or username. " +
        "For news articles, use ghost_news_search.",
      parameters: Type.Object({
        query: Type.Optional(Type.String({ description: "Keyword to search in tweet content" })),
        coins: Type.Optional(Type.Array(Type.String(), { description: "Filter by coin symbols, e.g. ['BTC', 'ETH']" })),
        username: Type.Optional(Type.String({ description: "Filter by a specific account, e.g. 'cz_binance'" })),
        limit: Type.Optional(Type.Number({ description: "Max results. Default 50, max 100." })),
      }),
      async execute(_toolCallId: string, params: unknown) {
        try {
          const p = params as { query?: string; coins?: string[]; username?: string; limit?: number };
          const rows = tweets.searchTweets(p);
          if (rows.length === 0) return textResult("No matching tweets found.");

          const lines = [`Tweets (${rows.length})`, "─".repeat(50)];
          for (const t of rows) {
            const ago = timeAgo(t.publishedAt);
            const coins = t.coins.length > 0 ? ` [${t.coins.join(", ")}]` : "";
            lines.push(`@${t.username}${coins} (${ago})`);
            lines.push(t.content);
            if (t.stats) {
              lines.push(
                `  👁 ${t.stats.views} 💬 ${t.stats.replies} 🔁 ${t.stats.retweets} ♥ ${t.stats.likes}`,
              );
            }
            if (t.url) lines.push(`  ${t.url}`);
            lines.push("");
          }
          return textResult(lines.join("\n"));
        } catch (e: unknown) {
          return errorResult(getErrorMessage(e));
        }
      },
    }),
  ];
}

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
