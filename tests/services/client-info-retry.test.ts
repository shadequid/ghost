/**
 * Unit tests for HyperliquidClient.fetchInfo — 429 retry-with-backoff.
 *
 * Strategy: replace the global fetch with a stub that returns pre-programmed
 * response sequences, then drive info() through the public API surface.
 * We test the private fetchInfo path indirectly: info() calls infoCache.get()
 * which calls fetchInfo when there is no cached entry.  We clear infoCache
 * between calls that must go to the network.
 */

import { describe, it, expect, mock, beforeEach, afterEach, jest } from "bun:test";
import { HyperliquidClient } from "../../src/services/live/client";

// ─── Logger stub ───

const noopLogger = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => noopLogger,
} as any;

// ─── Helpers ───

function makeResponse(status: number, body = "null", headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Build a client whose infoCache is exposed for test manipulation. */
function makeClient(): HyperliquidClient {
  return new HyperliquidClient(undefined, noopLogger);
}

/** Clear the infoCache so the next info() call always hits the network. */
function clearCache(client: HyperliquidClient): void {
  (client as any).infoCache.clear();
}

/** Directly call fetchInfo (bypasses cache). */
async function callFetchInfo(
  client: HyperliquidClient,
  type: string,
  extra: Record<string, unknown> = {},
  attempt = 0,
): Promise<unknown> {
  return (client as any).fetchInfo(type, extra, attempt);
}

// ─── Tests ───

describe("HyperliquidClient fetchInfo — 429 retry", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries once on 429 and resolves on second call", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) return makeResponse(429, "null");
      return makeResponse(200, '{"ok":true}');
    }) as unknown as typeof fetch;

    const client = makeClient();
    const result = await callFetchInfo(client, "metaAndAssetCtxs");
    expect(result).toEqual({ ok: true });
    expect(callCount).toBe(2);
  });

  it("retries up to 3 times then resolves on 4th call", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      if (callCount <= 3) return makeResponse(429, "null");
      return makeResponse(200, '"success"');
    }) as unknown as typeof fetch;

    const client = makeClient();
    const result = await callFetchInfo(client, "perpDexs");
    expect(result).toBe("success");
    expect(callCount).toBe(4);
  });

  it("rejects after 3 retry attempts (4 total calls) when all return 429", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return makeResponse(429, "null");
    }) as unknown as typeof fetch;

    const client = makeClient();
    await expect(callFetchInfo(client, "metaAndAssetCtxs")).rejects.toThrow("429");
    // attempt 0 → 1 → 2 → 3 (attempt === 3, condition `< 3` is false) → throws
    expect(callCount).toBe(4);
  });

  it("rejects immediately on 500 without retrying", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return makeResponse(500, "internal error");
    }) as unknown as typeof fetch;

    const client = makeClient();
    await expect(callFetchInfo(client, "clearinghouseState")).rejects.toThrow("500");
    expect(callCount).toBe(1);
  });

  it("uses Retry-After header delay when present and numeric", async () => {
    const delays: number[] = [];
    let callCount = 0;

    // Intercept setTimeout to record delays without actually waiting.
    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, delay: number) => {
      delays.push(delay);
      // Execute immediately so the test stays fast.
      fn();
      return 0 as any;
    };

    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) return makeResponse(429, "null", { "retry-after": "1" });
      return makeResponse(200, '"ok"');
    }) as unknown as typeof fetch;

    try {
      const client = makeClient();
      await callFetchInfo(client, "metaAndAssetCtxs");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    expect(callCount).toBe(2);
    // The delay should be ≥ 1000 ms (Retry-After: 1 → 1000 ms base + jitter).
    expect(delays.length).toBeGreaterThanOrEqual(1);
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
  });

  it("uses exponential backoff when Retry-After header is absent", async () => {
    const delays: number[] = [];
    let callCount = 0;

    const originalSetTimeout = globalThis.setTimeout;
    (globalThis as any).setTimeout = (fn: () => void, delay: number) => {
      delays.push(delay);
      fn();
      return 0 as any;
    };

    globalThis.fetch = (async () => {
      callCount++;
      if (callCount <= 2) return makeResponse(429, "null");
      return makeResponse(200, "null");
    }) as unknown as typeof fetch;

    try {
      const client = makeClient();
      await callFetchInfo(client, "metaAndAssetCtxs");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }

    // First retry: base 250 ms (+jitter), second retry: base 500 ms (+jitter).
    expect(delays.length).toBe(2);
    expect(delays[0]).toBeGreaterThanOrEqual(250);
    expect(delays[0]).toBeLessThan(500);  // 250 + max 100 jitter
    expect(delays[1]).toBeGreaterThanOrEqual(500);
    expect(delays[1]).toBeLessThan(750);  // 500 + max 100 jitter
  });

  it("does not retry on non-429 4xx errors", async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount++;
      return makeResponse(403, "forbidden");
    }) as unknown as typeof fetch;

    const client = makeClient();
    await expect(callFetchInfo(client, "clearinghouseState")).rejects.toThrow("403");
    expect(callCount).toBe(1);
  });
});
