/**
 * Prompt builders for the news summarize background job.
 *
 * Lets the job pass the prompt directly to taskAgent without routing through
 * NewsService. The system prompt and user prompt are kept separate because
 * pi-agent-core exposes no per-call systemPrompt override: the caller must
 * mutate taskAgent.state.systemPrompt before each prompt() call.
 */

import type { NewsArticle } from "../../services/news-types.js";

/** System prompt for the background summarizer taskAgent call. */
export const NEWS_SUMMARY_SYSTEM =
  "You are a concise crypto news summarizer. Reply with plain text only — no markdown, no bold, no asterisks. Keep the same language and narrative voice as the original.";

/** Build the user prompt for summarizing a single article. */
export function buildSingleSummaryPrompt(article: NewsArticle): string {
  return `Summarize this crypto news for a trader. Be thorough — capture what happened, relevant context, key numbers and facts, and implications for the reader. Don't be terse; if the source has rich detail, your summary should reflect that. You decide the best structure (one or several paragraphs) for clarity.

Be factual. Do not invent details not present in the source.
Use plain text only — no markdown, no bold, no asterisks.
Keep the same language and narrative voice as the original — do NOT translate, do NOT change first-person to third-person.

Headline: ${article.title}
Source: ${article.snippet}`;
}

/** Build the user prompt for batch-summarizing multiple articles in one call. */
export function buildBatchSummaryPrompt(articles: ReadonlyArray<NewsArticle>): string {
  const numbered = articles
    .map((a, i) => `${i + 1}. [${a.id}] ${a.title} | ${a.snippet}`)
    .join("\n");

  return `Summarize each crypto news article for a trader. Be thorough — for each article, capture what happened, relevant context, key numbers and facts, and implications for the reader. Don't be terse; if a source has rich detail, the summary should reflect that. You decide the best structure (one or several paragraphs) for clarity.

Be factual. Do not invent details not present in the source.
Use plain text only — no markdown, no bold, no asterisks.
Keep the same language and narrative voice as the original — do NOT translate, do NOT change first-person to third-person.

Articles:
${numbered}

Respond with ONLY a JSON object mapping article ID to its summary:
{"id1":"summary text...","id2":"summary text..."}

Escape newlines as \\n inside summary strings. Output valid JSON only. No markdown, no explanation.`;
}
