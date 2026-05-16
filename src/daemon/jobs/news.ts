/**
 * Background news jobs — fetch, summarize, evaluate.
 *
 * Three BackgroundJob entries covering the news pipeline: batch vs single
 * summarize routing, partial fallback text, and the evaluate→kick-summarize
 * chain.
 */

import type { BackgroundJob, JobContext } from "./types.js";
import {
  buildBatchSummaryPrompt,
  buildSingleSummaryPrompt,
  NEWS_SUMMARY_SYSTEM,
} from "../prompts/news-summary.js";
import {
  buildEvaluationPrompt,
  DEFAULT_NEWS_FILTER_INSTRUCTION,
  NEWS_EVALUATION_SYSTEM,
  parseEvaluationOutput,
} from "../prompts/news-evaluation.js";
import { NEWS_FILTER_PROMPT_KEY } from "../../services/preferences.js";
import { parseLlmJsonObject } from "../../helpers/parse-llm-json.js";
import type { NewsArticle } from "../../services/news-types.js";

const MAX_SNIPPET_LEN = 300;

// ---------------------------------------------------------------------------
// News fetch — every 30 minutes
// ---------------------------------------------------------------------------

export const newsFetchJob: BackgroundJob = {
  name: "news-fetch",
  schedule: { type: "interval", ms: 30 * 60 * 1000 },
  kickAtStart: true,

  async run({ runtime, logger }: JobContext): Promise<void> {
    try {
      const inserted = await runtime.newsService.fetchAll();
      if (inserted > 0) logger.info({ count: inserted }, "fetched new articles");
      else logger.debug("no new articles (all sources up to date)");
    } catch (err) {
      logger.warn({ err }, "fetch failed");
    }
  },
};

// ---------------------------------------------------------------------------
// News summarize — every 30 seconds. Single-flight guard lives in the runner.
// ---------------------------------------------------------------------------

export const newsSummarizeJob: BackgroundJob = {
  name: "news-summarize",
  schedule: { type: "interval", ms: 30 * 1000 },
  kickAtStart: true,

  async run({ runner, runtime, logger }: JobContext): Promise<void> {
    try {
      const articles = runtime.newsService.listPendingSummaries(10);
      if (articles.length === 0) return;

      let count = 0;
      if (articles.length === 1) {
        count = await summarizeOne(articles[0], runner, runtime.newsService, logger);
      } else {
        count = await summarizeBatch(articles, runner, runtime.newsService, logger);
      }

      if (count > 0) logger.info({ count }, "summarized articles");
    } catch (err) {
      logger.warn({ err }, "summarize failed");
    }
  },
};

// ---------------------------------------------------------------------------
// News evaluate — every 20 seconds
// Chains into summarize immediately when it produces relevant articles.
// ---------------------------------------------------------------------------

export const newsEvaluateJob: BackgroundJob = {
  name: "news-evaluate",
  schedule: { type: "interval", ms: 20 * 1000 },
  kickAtStart: true,

  async run({ runner, runtime, logger, kick }: JobContext): Promise<void> {
    try {
      const { candidates, existingTitles, total } = runtime.newsService.listPendingEvaluations(20);
      if (total === 0) return;

      if (candidates.length === 0) {
        // All pre-filtered as irrelevant — nothing to send to AI.
        return;
      }

      const userPrompt = runtime.preferenceStore.get(NEWS_FILTER_PROMPT_KEY);
      const instruction =
        userPrompt && userPrompt.trim().length > 0 ? userPrompt : DEFAULT_NEWS_FILTER_INSTRUCTION;

      let raw: string;
      try {
        raw = await runner.call({
          systemPrompt: NEWS_EVALUATION_SYSTEM,
          message: buildEvaluationPrompt(candidates, existingTitles, instruction),
        });
      } catch (err) {
        logger.warn({ err }, "taskAgent evaluate failed");
        return;
      }

      const selectedIds = parseEvaluationOutput(raw);
      runtime.newsService.saveEvaluation(candidates, selectedIds);

      if (total > 0) {
        logger.info({ count: total }, "evaluated articles");
        // Drain immediately — evaluate just produced work for summarize.
        void kick("news-summarize");
      }
    } catch (err) {
      logger.warn({ err }, "evaluate failed");
    }
  },
};

// ---------------------------------------------------------------------------
// Private helpers — summarizeOne (single article) + summarizeBatch (≤5).
// ---------------------------------------------------------------------------

async function summarizeOne(
  article: NewsArticle,
  runner: JobContext["runner"],
  newsService: JobContext["runtime"]["newsService"],
  logger: JobContext["logger"],
): Promise<number> {
  let text: string;
  try {
    text = await runner.call({
      systemPrompt: NEWS_SUMMARY_SYSTEM,
      message: buildSingleSummaryPrompt(article),
    });
  } catch (err) {
    logger.warn({ err, articleId: article.id }, "taskAgent summarize-one failed");
    newsService.saveSummary(article.id, `[partial]${article.snippet.slice(0, MAX_SNIPPET_LEN)}`);
    return 0;
  }

  if (text.trim().length === 0) {
    logger.warn({ articleId: article.id }, "summarize-one produced no text; using snippet");
    newsService.saveSummary(article.id, `[partial]${article.snippet.slice(0, MAX_SNIPPET_LEN)}`);
    return 0;
  }

  newsService.saveSummary(article.id, text);
  return 1;
}

async function summarizeBatch(
  articles: NewsArticle[],
  runner: JobContext["runner"],
  newsService: JobContext["runtime"]["newsService"],
  logger: JobContext["logger"],
): Promise<number> {
  const pending = articles.filter((a) => !a.fullSummary);
  if (pending.length === 0) return 0;
  if (pending.length === 1) return summarizeOne(pending[0], runner, newsService, logger);

  let raw: string;
  try {
    raw = await runner.call({
      systemPrompt: NEWS_SUMMARY_SYSTEM,
      message: buildBatchSummaryPrompt(pending),
    });
  } catch (err) {
    logger.warn({ err }, "taskAgent batch-summarize failed");
    for (const a of pending) {
      newsService.saveSummary(a.id, `[partial]${a.snippet.slice(0, MAX_SNIPPET_LEN)}`);
    }
    return 0;
  }

  if (raw.trim().length === 0) {
    logger.warn("batch-summarize produced no text; using snippets");
    for (const a of pending) {
      newsService.saveSummary(a.id, `[partial]${a.snippet.slice(0, MAX_SNIPPET_LEN)}`);
    }
    return 0;
  }

  // Parse JSON map { id: summary, ... } — strip-then-scan handles local
  // models that wrap output in <think> tags or markdown fences.
  const parsed = parseLlmJsonObject(raw);
  if (parsed === undefined || typeof parsed !== "object" || parsed === null) {
    logger.warn({ raw: raw.slice(0, 200) }, "batch-summarize response has no JSON object; using snippets");
    for (const a of pending) {
      newsService.saveSummary(a.id, `[partial]${a.snippet.slice(0, MAX_SNIPPET_LEN)}`);
    }
    return 0;
  }
  const summaries = parsed as Record<string, string>;

  let count = 0;
  for (const a of pending) {
    const summary = summaries[a.id];
    if (summary && summary.length > 5) {
      newsService.saveSummary(a.id, summary);
      count++;
    } else {
      newsService.saveSummary(a.id, `[partial]${a.snippet.slice(0, MAX_SNIPPET_LEN)}`);
    }
  }
  return count;
}
