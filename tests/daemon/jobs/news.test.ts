/**
 * Tests for daemon/jobs/news.ts — newsFetchJob, newsSummarizeJob, newsEvaluateJob.
 *
 * All tests use lightweight mocks; no real DB, network, or LLM calls.
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import { newsFetchJob, newsSummarizeJob, newsEvaluateJob } from "../../../src/daemon/jobs/news.js";
import { NEWS_SUMMARY_SYSTEM } from "../../../src/daemon/prompts/news-summary.js";
import { NEWS_EVALUATION_SYSTEM } from "../../../src/daemon/prompts/news-evaluation.js";
import type { JobContext } from "../../../src/daemon/jobs/types.js";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => makeLogger()),
    trace: mock(() => {}),
  } as unknown as Logger;
}

function makeArticle(id: string, overrides: Partial<{
  title: string;
  snippet: string;
  fullSummary: string | null;
}> = {}) {
  return {
    id,
    title: overrides.title ?? `Article ${id}`,
    snippet: overrides.snippet ?? `Snippet for ${id}`,
    fullSummary: overrides.fullSummary ?? null,
    url: `https://example.com/${id}`,
    source: "test",
    publishedAt: Date.now(),
    relevant: null,
    relevanceReason: null,
    fetchedAt: Date.now(),
  };
}

interface NewsServiceMock {
  fetchAll: ReturnType<typeof mock>;
  listPendingSummaries: ReturnType<typeof mock>;
  saveSummary: ReturnType<typeof mock>;
  listPendingEvaluations: ReturnType<typeof mock>;
  saveEvaluation: ReturnType<typeof mock>;
}

function makeNewsService(overrides: Partial<NewsServiceMock> = {}): NewsServiceMock {
  return {
    fetchAll: overrides.fetchAll ?? mock(async () => 0),
    listPendingSummaries: overrides.listPendingSummaries ?? mock(() => []),
    saveSummary: overrides.saveSummary ?? mock(() => {}),
    listPendingEvaluations: overrides.listPendingEvaluations ?? mock(() => ({
      candidates: [],
      existingTitles: [],
      total: 0,
    })),
    saveEvaluation: overrides.saveEvaluation ?? mock(() => {}),
  };
}

function makeRunner(returnText?: string) {
  return {
    call: mock(async () => returnText ?? "summary text"),
  };
}

function makeCtx(overrides: Partial<JobContext> = {}): JobContext {
  const newsService = makeNewsService();
  const runner = makeRunner();

  return {
    taskAgent: {} as never,
    runner: runner as never,
    runtime: { newsService } as never,
    eventBus: {} as never,
    logger: makeLogger(),
    kick: mock(async () => {}),
    lastDelayMs: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// newsFetchJob
// ---------------------------------------------------------------------------

describe("newsFetchJob", () => {
  test("run() calls newsService.fetchAll()", async () => {
    const newsService = makeNewsService({
      fetchAll: mock(async () => 5),
    });
    const ctx = makeCtx({ runtime: { newsService } as never });

    await newsFetchJob.run(ctx);

    expect(newsService.fetchAll).toHaveBeenCalledTimes(1);
  });

  test("run() logs inserted count when > 0", async () => {
    const newsService = makeNewsService({ fetchAll: mock(async () => 3) });
    const logger = makeLogger();
    const ctx = makeCtx({
      runtime: { newsService } as never,
      logger,
    });

    await newsFetchJob.run(ctx);

    expect(logger.info).toHaveBeenCalledWith({ count: 3 }, "fetched new articles");
  });

  test("run() logs debug when 0 new articles", async () => {
    const newsService = makeNewsService({ fetchAll: mock(async () => 0) });
    const logger = makeLogger();
    const ctx = makeCtx({
      runtime: { newsService } as never,
      logger,
    });

    await newsFetchJob.run(ctx);

    expect(logger.debug).toHaveBeenCalledWith("no new articles (all sources up to date)");
  });

  test("run() catches and logs errors from fetchAll()", async () => {
    const newsService = makeNewsService({
      fetchAll: mock(async () => { throw new Error("network error"); }),
    });
    const logger = makeLogger();
    const ctx = makeCtx({ runtime: { newsService } as never, logger });

    // Should not throw
    await expect(newsFetchJob.run(ctx)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "fetch failed",
    );
  });

  test("kickAtStart is true — runner will kick this job at daemon start", () => {
    expect(newsFetchJob.kickAtStart).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// newsSummarizeJob — single article path
// ---------------------------------------------------------------------------

describe("newsSummarizeJob — single article", () => {
  test("run() calls runner.call with NEWS_SUMMARY_SYSTEM for a single article", async () => {
    const article = makeArticle("a1");
    const newsService = makeNewsService({
      listPendingSummaries: mock(() => [article]),
    });
    const runner = makeRunner("A great summary.");
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
    });

    await newsSummarizeJob.run(ctx);

    expect(runner.call).toHaveBeenCalledTimes(1);
    const callArg = (runner.call as ReturnType<typeof mock>).mock.calls[0][0];
    expect(callArg.systemPrompt).toBe(NEWS_SUMMARY_SYSTEM);
  });

  test("run() calls saveSummary with the returned text", async () => {
    const article = makeArticle("a1");
    const newsService = makeNewsService({
      listPendingSummaries: mock(() => [article]),
      saveSummary: mock(() => {}),
    });
    const runner = makeRunner("My summary.");
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
    });

    await newsSummarizeJob.run(ctx);

    expect(newsService.saveSummary).toHaveBeenCalledWith("a1", "My summary.");
  });

  test("run() saves [partial] snippet when runner.call throws", async () => {
    const article = makeArticle("a1", { snippet: "short snippet" });
    const newsService = makeNewsService({
      listPendingSummaries: mock(() => [article]),
      saveSummary: mock(() => {}),
    });
    const runner = {
      call: mock(async () => { throw new Error("LLM failed"); }),
    };
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
    });

    await newsSummarizeJob.run(ctx);

    expect(newsService.saveSummary).toHaveBeenCalledWith("a1", "[partial]short snippet");
  });

  test("run() is a no-op when listPendingSummaries returns empty", async () => {
    const newsService = makeNewsService({
      listPendingSummaries: mock(() => []),
      saveSummary: mock(() => {}),
    });
    const runner = makeRunner();
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
    });

    await newsSummarizeJob.run(ctx);

    expect(runner.call).not.toHaveBeenCalled();
    expect(newsService.saveSummary).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// newsSummarizeJob — batch path
// ---------------------------------------------------------------------------

describe("newsSummarizeJob — batch articles", () => {
  test("run() uses batch prompt when multiple articles present", async () => {
    const articles = [makeArticle("b1"), makeArticle("b2")];
    const newsService = makeNewsService({
      listPendingSummaries: mock(() => articles),
      saveSummary: mock(() => {}),
    });
    // Return valid JSON batch response — summaries must be > 5 chars to pass length check
    const runner = makeRunner('{"b1":"Summary for b1 article","b2":"Summary for b2 article"}');
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
    });

    await newsSummarizeJob.run(ctx);

    expect(runner.call).toHaveBeenCalledTimes(1);
    expect(newsService.saveSummary).toHaveBeenCalledWith("b1", "Summary for b1 article");
    expect(newsService.saveSummary).toHaveBeenCalledWith("b2", "Summary for b2 article");
  });

  test("run() saves [partial] for each article when batch response has no JSON", async () => {
    const articles = [makeArticle("c1", { snippet: "snip1" }), makeArticle("c2", { snippet: "snip2" })];
    const newsService = makeNewsService({
      listPendingSummaries: mock(() => articles),
      saveSummary: mock(() => {}),
    });
    const runner = makeRunner("no json here at all");
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
    });

    await newsSummarizeJob.run(ctx);

    expect(newsService.saveSummary).toHaveBeenCalledWith("c1", "[partial]snip1");
    expect(newsService.saveSummary).toHaveBeenCalledWith("c2", "[partial]snip2");
  });
});

// ---------------------------------------------------------------------------
// newsEvaluateJob
// ---------------------------------------------------------------------------

describe("newsEvaluateJob", () => {
  test("run() calls runner.call with NEWS_EVALUATION_SYSTEM", async () => {
    const candidates = [{ id: "e1", title: "T1", snippet: "S1" }];
    const newsService = makeNewsService({
      listPendingEvaluations: mock(() => ({
        candidates,
        existingTitles: [],
        total: 1,
      })),
      saveEvaluation: mock(() => {}),
    });
    const runner = makeRunner('["e1"]');
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
    });

    await newsEvaluateJob.run(ctx);

    expect(runner.call).toHaveBeenCalledTimes(1);
    const callArg = (runner.call as ReturnType<typeof mock>).mock.calls[0][0];
    expect(callArg.systemPrompt).toBe(NEWS_EVALUATION_SYSTEM);
  });

  test("run() calls saveEvaluation with candidates and parsed selectedIds", async () => {
    const candidates = [
      { id: "e1", title: "T1", snippet: "S1" },
      { id: "e2", title: "T2", snippet: "S2" },
    ];
    const saveEvaluation = mock(() => {});
    const newsService = makeNewsService({
      listPendingEvaluations: mock(() => ({ candidates, existingTitles: [], total: 2 })),
      saveEvaluation,
    });
    const runner = makeRunner('["e1"]');
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
    });

    await newsEvaluateJob.run(ctx);

    expect(saveEvaluation).toHaveBeenCalledWith(candidates, ["e1"]);
  });

  test("run() kicks news-summarize after evaluation produces hits", async () => {
    const candidates = [{ id: "e1", title: "T1", snippet: "S1" }];
    const newsService = makeNewsService({
      listPendingEvaluations: mock(() => ({ candidates, existingTitles: [], total: 1 })),
      saveEvaluation: mock(() => {}),
    });
    const runner = makeRunner('["e1"]');
    const kick = mock(async () => {});
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
      kick,
    });

    await newsEvaluateJob.run(ctx);

    // Must kick news-summarize
    expect(kick).toHaveBeenCalledWith("news-summarize");
  });

  test("run() is a no-op when total === 0", async () => {
    const newsService = makeNewsService({
      listPendingEvaluations: mock(() => ({ candidates: [], existingTitles: [], total: 0 })),
      saveEvaluation: mock(() => {}),
    });
    const runner = makeRunner();
    const kick = mock(async () => {});
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
      kick,
    });

    await newsEvaluateJob.run(ctx);

    expect(runner.call).not.toHaveBeenCalled();
    expect(kick).not.toHaveBeenCalled();
  });

  test("run() skips AI call when candidates array is empty (all pre-filtered)", async () => {
    const newsService = makeNewsService({
      listPendingEvaluations: mock(() => ({ candidates: [], existingTitles: [], total: 5 })),
      saveEvaluation: mock(() => {}),
    });
    const runner = makeRunner();
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
    });

    await newsEvaluateJob.run(ctx);

    expect(runner.call).not.toHaveBeenCalled();
  });

  test("run() catches and logs error when runner throws", async () => {
    const candidates = [{ id: "e1", title: "T1", snippet: "S1" }];
    const newsService = makeNewsService({
      listPendingEvaluations: mock(() => ({ candidates, existingTitles: [], total: 1 })),
      saveEvaluation: mock(() => {}),
    });
    const runner = { call: mock(async () => { throw new Error("LLM down"); }) };
    const logger = makeLogger();
    const ctx = makeCtx({
      runtime: { newsService } as never,
      runner: runner as never,
      logger,
    });

    await expect(newsEvaluateJob.run(ctx)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "taskAgent evaluate failed",
    );
  });

  test("kickAtStart is true — runner will kick this job at daemon start", () => {
    expect(newsEvaluateJob.kickAtStart).toBe(true);
  });
});
