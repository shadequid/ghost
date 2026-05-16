import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import pino from "pino";
import { VersionCheckService, fetchLatestVersion } from "../../src/update/version-check.js";
import type { UpdateCache } from "../../src/update/version-cache.js";

const logger = pino({ level: "silent" });

/**
 * Default no-op persist for tests — the real persist writes under
 * `~/.ghost/` which we never want to touch from the suite. Tests that
 * assert persistence pass their own recording stub.
 */
const noopPersist = (): void => {};

// Per-test fetch mock — assigned in each test's setup.
let mockedFetch: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | null = null;
const originalFetch = globalThis.fetch;

// Per-test Date.now spy — installed only in tests that need a controllable clock.
let dateNowSpy: ReturnType<typeof spyOn> | null = null;

beforeEach(() => {
  mockedFetch = null;
  // Install a global fetch trampoline that routes to the per-test mock when set.
  globalThis.fetch = ((input, init) => {
    if (mockedFetch) return mockedFetch(input as string | URL | Request, init);
    return originalFetch(input, init);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mockedFetch = null;
  dateNowSpy?.mockRestore();
  dateNowSpy = null;
});

/**
 * Install a controllable clock for tests that need to step time forward.
 * Returns an `advance` function that increments the mocked timestamp.
 */
function setupClock(initialMs: number): { advance: (deltaMs: number) => void } {
  let current = initialMs;
  dateNowSpy = spyOn(Date, "now").mockImplementation(() => current);
  return {
    advance: (deltaMs: number) => {
      current += deltaMs;
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("VersionCheckService", () => {
  test("returns latest on a 200 response", async () => {
    mockedFetch = mock(async () => jsonResponse({ "dist-tags": { latest: "0.0.2" } }));
    const svc = new VersionCheckService({ logger, ttlMs: 60_000, persistCache: noopPersist });
    expect(await svc.getLatest()).toBe("0.0.2");
  });

  test("returns null on 404", async () => {
    mockedFetch = mock(async () => new Response("", { status: 404 }));
    const svc = new VersionCheckService({ logger, ttlMs: 60_000, persistCache: noopPersist });
    expect(await svc.getLatest()).toBeNull();
  });

  test("returns null on 500", async () => {
    mockedFetch = mock(async () => new Response("oops", { status: 500 }));
    const svc = new VersionCheckService({ logger, ttlMs: 60_000, persistCache: noopPersist });
    expect(await svc.getLatest()).toBeNull();
  });

  test("returns null when fetch throws (network error)", async () => {
    mockedFetch = mock(async () => {
      throw new Error("network down");
    });
    const svc = new VersionCheckService({ logger, ttlMs: 60_000, persistCache: noopPersist });
    expect(await svc.getLatest()).toBeNull();
  });

  test("returns null when body is malformed JSON", async () => {
    mockedFetch = mock(async () =>
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const svc = new VersionCheckService({ logger, ttlMs: 60_000, persistCache: noopPersist });
    expect(await svc.getLatest()).toBeNull();
  });

  test("returns null when dist-tags.latest is missing", async () => {
    mockedFetch = mock(async () => jsonResponse({ name: "@hyperflow/ghost" }));
    const svc = new VersionCheckService({ logger, ttlMs: 60_000, persistCache: noopPersist });
    expect(await svc.getLatest()).toBeNull();
  });

  test("caches within TTL", async () => {
    let calls = 0;
    mockedFetch = mock(async () => {
      calls++;
      return jsonResponse({ "dist-tags": { latest: "0.0.2" } });
    });
    const clock = setupClock(1000);
    const svc = new VersionCheckService({
      logger,
      ttlMs: 10_000,
      persistCache: noopPersist,
    });
    expect(await svc.getLatest()).toBe("0.0.2");
    clock.advance(5_000); // within TTL
    expect(await svc.getLatest()).toBe("0.0.2");
    expect(calls).toBe(1);
  });

  test("force bypasses cache", async () => {
    let calls = 0;
    mockedFetch = mock(async () => {
      calls++;
      return jsonResponse({ "dist-tags": { latest: `0.0.${calls}` } });
    });
    const clock = setupClock(1000);
    const svc = new VersionCheckService({
      logger,
      ttlMs: 10_000,
      persistCache: noopPersist,
    });
    expect(await svc.getLatest()).toBe("0.0.1");
    clock.advance(0); // time doesn't matter for force
    expect(await svc.getLatest(true)).toBe("0.0.2");
    expect(calls).toBe(2);
  });

  test("refetches when TTL has expired", async () => {
    let calls = 0;
    mockedFetch = mock(async () => {
      calls++;
      return jsonResponse({ "dist-tags": { latest: `0.0.${calls}` } });
    });
    const clock = setupClock(1000);
    const svc = new VersionCheckService({
      logger,
      ttlMs: 10_000,
      persistCache: noopPersist,
    });
    expect(await svc.getLatest()).toBe("0.0.1");
    clock.advance(11_000); // past TTL
    expect(await svc.getLatest()).toBe("0.0.2");
    expect(calls).toBe(2);
  });

  test("times out and returns null when fetch hangs", async () => {
    // mockedFetch honors AbortSignal. When the signal aborts, the returned
    // promise rejects — matching the real `fetch` contract. Using a tiny
    // timeoutMs keeps the test fast and deterministic.
    mockedFetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }
      });
    });
    const svc = new VersionCheckService({
      logger,
      ttlMs: 60_000,
      timeoutMs: 20,
      persistCache: noopPersist,
    });
    // Uses real Date.now() — no spy installed in this test.
    const start = Date.now();
    const result = await svc.getLatest();
    const elapsed = Date.now() - start;
    expect(result).toBeNull();
    // Allow generous slack for CI jitter; the key assertion is that we
    // did NOT wait anywhere near the default 5s timeout.
    expect(elapsed).toBeLessThan(500);
  });

  test("coalesces concurrent calls to a single fetch", async () => {
    // Deferred fetch — resolves exactly once the test is ready. Without
    // coalescing, two parallel `getLatest(true)` calls would each fire
    // the fetch. With coalescing, the second call reuses the in-flight
    // promise.
    let resolveFetch: (value: Response) => void = () => {};
    let calls = 0;
    mockedFetch = mock(async () => {
      calls++;
      return await new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    const svc = new VersionCheckService({ logger, ttlMs: 60_000, persistCache: noopPersist });

    const p1 = svc.getLatest(true);
    const p2 = svc.getLatest(true);
    // Let the microtask queue flush so the second call observes inflight.
    await Promise.resolve();
    resolveFetch(jsonResponse({ "dist-tags": { latest: "0.0.9" } }));
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe("0.0.9");
    expect(r2).toBe("0.0.9");
    expect(calls).toBe(1);
  });

  test("force call reuses in-flight non-force fetch", async () => {
    // A non-force caller (e.g. startup background probe) may be in flight
    // when `ghost update` issues a force fetch. Both must resolve from the
    // same underlying request — not a second network call.
    let resolveFetch: (value: Response) => void = () => {};
    let calls = 0;
    mockedFetch = mock(async () => {
      calls++;
      return await new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    const svc = new VersionCheckService({
      logger,
      ttlMs: 60_000,
      persistCache: noopPersist,
    });

    const p1 = svc.getLatest(false);
    const p2 = svc.getLatest(true);
    await Promise.resolve();
    resolveFetch(jsonResponse({ "dist-tags": { latest: "1.2.3" } }));
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe("1.2.3");
    expect(r2).toBe("1.2.3");
    expect(calls).toBe(1);
  });

  test("caches null result only briefly so offline boots recover quickly", async () => {
    // A full-TTL cache of null leaves users stuck with "no update" for an
    // hour after a transient failure. The service caches null for a short
    // retry window (~60s) and proceeds to refetch once it elapses.
    let calls = 0;
    mockedFetch = mock(async () => {
      calls++;
      if (calls === 1) return new Response("", { status: 500 });
      return jsonResponse({ "dist-tags": { latest: "0.0.5" } });
    });
    const clock = setupClock(1_000_000);
    const svc = new VersionCheckService({
      logger,
      ttlMs: 60 * 60 * 1000, // 1h success TTL
      persistCache: noopPersist,
    });

    expect(await svc.getLatest()).toBeNull();
    expect(calls).toBe(1);

    // Immediately after — still within the null-retry cooldown.
    clock.advance(1_000);
    expect(await svc.getLatest()).toBeNull();
    expect(calls).toBe(1);

    // After the short cooldown elapses (>60s), the next call refetches.
    clock.advance(61_000);
    expect(await svc.getLatest()).toBe("0.0.5");
    expect(calls).toBe(2);
  });

  test("persists successful fetch to the on-disk cache", async () => {
    mockedFetch = mock(async () =>
      jsonResponse({ "dist-tags": { latest: "0.0.7" } }),
    );
    const writes: UpdateCache[] = [];
    dateNowSpy = spyOn(Date, "now").mockImplementation(() => 1_700_000_000_000);
    const svc = new VersionCheckService({
      logger,
      ttlMs: 60_000,
      persistCache: (c) => writes.push(c),
    });

    expect(await svc.getLatest()).toBe("0.0.7");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({
      latestVersion: "0.0.7",
      checkedAt: 1_700_000_000_000,
    });
  });

  test("persists failed fetch as latestVersion=null", async () => {
    mockedFetch = mock(async () => new Response("", { status: 503 }));
    const writes: UpdateCache[] = [];
    dateNowSpy = spyOn(Date, "now").mockImplementation(() => 42);
    const svc = new VersionCheckService({
      logger,
      ttlMs: 60_000,
      persistCache: (c) => writes.push(c),
    });

    expect(await svc.getLatest()).toBeNull();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ latestVersion: null, checkedAt: 42 });
  });

  test("persistCache errors never escape getLatest", async () => {
    mockedFetch = mock(async () =>
      jsonResponse({ "dist-tags": { latest: "0.0.7" } }),
    );
    const svc = new VersionCheckService({
      logger,
      ttlMs: 60_000,
      persistCache: () => {
        throw new Error("disk full");
      },
    });

    // Even though persistCache throws, the returned value is unaffected.
    expect(await svc.getLatest()).toBe("0.0.7");
  });

  test("non-latest tag is cached within TTL", async () => {
    let calls = 0;
    mockedFetch = mock(async () => {
      calls++;
      return jsonResponse({ "dist-tags": { rc: "0.1.0-rc.1" } });
    });
    const clock = setupClock(1000);
    const svc = new VersionCheckService({
      logger,
      ttlMs: 10_000,
      persistCache: noopPersist,
    });

    expect(await svc.getLatest(false, "rc")).toBe("0.1.0-rc.1");
    clock.advance(5_000); // within TTL
    expect(await svc.getLatest(false, "rc")).toBe("0.1.0-rc.1");
    expect(calls).toBe(1);
  });

  test("non-latest tag coalesces concurrent fetches", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    let calls = 0;
    mockedFetch = mock(async () => {
      calls++;
      return await new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    });
    const svc = new VersionCheckService({
      logger,
      ttlMs: 60_000,
      persistCache: noopPersist,
    });

    const p1 = svc.getLatest(false, "rc");
    const p2 = svc.getLatest(false, "rc");
    await Promise.resolve();
    resolveFetch(jsonResponse({ "dist-tags": { rc: "0.1.0-rc.2" } }));
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe("0.1.0-rc.2");
    expect(r2).toBe("0.1.0-rc.2");
    expect(calls).toBe(1);
  });

  test("non-latest tag is NOT persisted to the on-disk cache", async () => {
    mockedFetch = mock(async () =>
      jsonResponse({ "dist-tags": { rc: "0.1.0-rc.3" } }),
    );
    const writes: UpdateCache[] = [];
    const svc = new VersionCheckService({
      logger,
      ttlMs: 60_000,
      persistCache: (c) => writes.push(c),
    });

    expect(await svc.getLatest(false, "rc")).toBe("0.1.0-rc.3");
    expect(writes).toHaveLength(0);
  });

  test("each tag has an independent cache entry", async () => {
    let calls = 0;
    mockedFetch = mock(async () => {
      calls++;
      return jsonResponse({
        "dist-tags": { latest: "1.0.0", rc: "1.1.0-rc.1" },
      });
    });
    const svc = new VersionCheckService({
      logger,
      ttlMs: 60_000,
      persistCache: noopPersist,
    });

    // First fetch per tag populates its own cache entry.
    expect(await svc.getLatest(false, "latest")).toBe("1.0.0");
    expect(await svc.getLatest(false, "rc")).toBe("1.1.0-rc.1");
    expect(calls).toBe(2);

    // Both entries now cached — re-asking either tag doesn't refetch.
    expect(await svc.getLatest(false, "latest")).toBe("1.0.0");
    expect(await svc.getLatest(false, "rc")).toBe("1.1.0-rc.1");
    expect(calls).toBe(2);
  });
});

describe("fetchLatestVersion", () => {
  test("returns the dist-tag on a 200 response", async () => {
    mockedFetch = mock(async () => jsonResponse({ "dist-tags": { latest: "1.2.3" } }));
    expect(await fetchLatestVersion({ timeoutMs: 1000, logger })).toBe("1.2.3");
  });

  test("honors a custom tag", async () => {
    mockedFetch = mock(async () => jsonResponse({ "dist-tags": { rc: "1.2.4-rc.0" } }));
    expect(
      await fetchLatestVersion({ timeoutMs: 1000, tag: "rc", logger }),
    ).toBe("1.2.4-rc.0");
  });

  test("returns null on 404", async () => {
    mockedFetch = mock(async () => new Response("", { status: 404 }));
    expect(await fetchLatestVersion({ timeoutMs: 1000, logger })).toBeNull();
  });

  test("returns null on 500", async () => {
    mockedFetch = mock(async () => new Response("", { status: 500 }));
    expect(await fetchLatestVersion({ timeoutMs: 1000, logger })).toBeNull();
  });

  test("returns null when fetch throws", async () => {
    mockedFetch = mock(async () => {
      throw new Error("network down");
    });
    expect(await fetchLatestVersion({ timeoutMs: 1000, logger })).toBeNull();
  });

  test("returns null when AbortSignal fires (timeout)", async () => {
    mockedFetch = mock(
      (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "TimeoutError";
            reject(err);
          });
        }),
    );
    expect(await fetchLatestVersion({ timeoutMs: 5, logger })).toBeNull();
  });

  test("returns null on malformed JSON", async () => {
    mockedFetch = mock(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await fetchLatestVersion({ timeoutMs: 1000, logger })).toBeNull();
  });

  test("returns null when dist-tags.latest is missing", async () => {
    mockedFetch = mock(async () => jsonResponse({ "dist-tags": { rc: "1.0.0-rc.1" } }));
    expect(await fetchLatestVersion({ timeoutMs: 1000, logger })).toBeNull();
  });
});
