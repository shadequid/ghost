/**
 * Prompt builders for the tweet relevance evaluation background job.
 *
 * TWEET_FILTER_SYSTEM is fixed and must not be overridden by user input —
 * it anchors the JSON-only response contract regardless of what instruction
 * the user provides via PreferenceStore.
 *
 * DEFAULT_TWEET_FILTER_INSTRUCTION is the fallback when no user preference
 * is stored. The evaluate job reads the live preference each tick so changes
 * take effect within the next 20-second cycle without a daemon restart.
 */

export const TWEET_FILTER_SYSTEM =
  "You are a crypto-trader tweet curator. Reply with valid JSON only — no markdown, no explanation.";

export const DEFAULT_TWEET_FILTER_INSTRUCTION = `Select ALL tweets relevant for a Hyperliquid perpetual-contract trader.

Criteria:
- Price moves, exchange news, regulatory changes, on-chain analysis, market commentary
- Skip personal life updates, retweets that add no info, jokes, off-topic banter
- Skip pure shill/promo with no analysis
- When in doubt, include it`;

interface EvalTweet {
  id: string;
  username: string;
  content: string;
  coins: string[];
}

export function buildEvaluationPrompt(
  tweets: ReadonlyArray<EvalTweet>,
  instruction: string,
): string {
  const list = tweets
    .map(
      (t, i) =>
        `  ${i + 1}. [${t.id}] @${t.username}${t.coins.length ? ` (${t.coins.join(",")})` : ""}: ${t.content.slice(0, 200)}`,
    )
    .join("\n");
  return `${instruction}

CANDIDATE TWEETS (${tweets.length} total):
${list}

Respond with ONLY a JSON array of relevant tweet IDs:
["id1","id2"]

Output valid JSON only, no markdown, no explanation.`;
}
