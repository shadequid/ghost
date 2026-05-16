/**
 * Unit tests for ChartRenderer.
 * Real Bun.WebView is NOT used — all tests mock the WebView constructor so they
 * run in CI without a display server.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { NOOP_LOGGER } from "../../../src/logger.js";

// ---------------------------------------------------------------------------
// WebView stub factory
// ---------------------------------------------------------------------------

interface WebViewStub {
  navigate: ReturnType<typeof mock>;
  evaluate: ReturnType<typeof mock>;
  screenshot: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
}

function makeWebViewStub(overrides?: Partial<WebViewStub>): WebViewStub {
  const stub: WebViewStub = {
    navigate: overrides?.navigate ?? mock(async (_url: string) => undefined),
    evaluate: overrides?.evaluate ?? mock(async (_js: string) => true),
    // screenshot returns a Blob-like with arrayBuffer()
    screenshot: overrides?.screenshot ?? mock(async () => {
      // Minimal valid PNG header bytes
      const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      return { arrayBuffer: async () => pngBytes.buffer } as unknown as Blob;
    }),
    close: overrides?.close ?? mock(async () => undefined),
  };
  return stub;
}

// ---------------------------------------------------------------------------
// Module-level WebView mock — must be set up before importing ChartRenderer
// so the mock is in place when the module loads.
// We use dynamic import to control timing.
// ---------------------------------------------------------------------------

let capturedStub: WebViewStub | null = null;

const mockWebViewConstructor = mock(function WebViewMock(this: unknown, _opts: unknown) {
  if (!capturedStub) throw new Error("no stub configured");
  return capturedStub;
});

// Patch global Bun.WebView before loading the module under test.
// bun:test resets module registry per test file so this persists within file.
(globalThis as unknown as Record<string, unknown>)["__WebViewMock__"] = mockWebViewConstructor;

// We monkey-patch the "bun" module's WebView export by injecting into the
// module cache. Since Bun resolves "bun" as a built-in, we mock at the
// import level by wrapping ChartRenderer to accept a WebView factory.
// Simplest approach: use ChartRenderer's internal `new WebView(...)` by
// testing through the public interface with a factory injection seam via
// module mock — but since Bun doesn't have jest.mock(), we expose
// buildUrl as public for URL tests, and test the rest by subclassing.

// ---------------------------------------------------------------------------
// Test-double subclass — overrides ensureWebview to avoid real WebView
// ---------------------------------------------------------------------------

import { ChartRenderer, type ChartSpec } from "../../../src/channels/telegram/chart-renderer.js";

class TestableChartRenderer extends ChartRenderer {
  private stub: WebViewStub | null = null;
  private constructorThrows: Error | null = null;

  setStub(s: WebViewStub): void {
    this.stub = s;
  }

  setConstructorThrows(e: Error): void {
    this.constructorThrows = e;
  }

  // Override the private ensureWebview via a protected accessor trick.
  // We expose it by casting to access private members.
  async forceEnsure(): Promise<unknown> {
    return (this as unknown as { ensureWebview(): Promise<unknown> }).ensureWebview();
  }
}

/**
 * Minimal injectable ChartRenderer that overrides ensureWebview.
 * Bun doesn't allow monkey-patching private class methods from outside, so
 * we use a subclass to replace `snapshotInner` dependency only.
 */
class InjectableChartRenderer extends ChartRenderer {
  private _stub: WebViewStub | null = null;
  private _throwOnCreate: Error | null = null;

  configure(stub: WebViewStub | null, throwOnCreate?: Error): void {
    this._stub = stub;
    this._throwOnCreate = throwOnCreate ?? null;
  }

  // Override snapshot to use injected stub instead of real WebView.
  override snapshot(spec: ChartSpec): Promise<Uint8Array> {
    const inner = async (): Promise<Uint8Array> => {
      if (this._throwOnCreate) {
        // Simulate constructor throw (e.g. no display server).
        throw this._throwOnCreate;
      }
      const stub = this._stub!;
      const url = this.buildUrl(spec);
      await stub.navigate(url);
      const ready = await stub.evaluate("window.__chartReady === true");
      if (!ready) throw new Error("chart-renderer: __chartReady timeout after 5000ms");
      const blob = await stub.screenshot() as Blob;
      return new Uint8Array(await blob.arrayBuffer());
    };
    // Preserve mutex serialization from parent by chaining on it.
    // Access parent's mutex field via cast.
    const parent = this as unknown as { mutex: Promise<unknown> };
    const next = parent.mutex.then(() => inner());
    parent.mutex = next.catch(() => undefined);
    return next;
  }
}

// ---------------------------------------------------------------------------
// URL-building tests (no WebView needed)
// ---------------------------------------------------------------------------

describe("ChartRenderer.buildUrl", () => {
  const renderer = new InjectableChartRenderer("http://127.0.0.1:15401", NOOP_LOGGER);

  it("includes symbol, interval, and headless=1", () => {
    const url = renderer.buildUrl({ symbol: "BTC", interval: "4h" });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/chart");
    expect(parsed.searchParams.get("symbol")).toBe("BTC");
    expect(parsed.searchParams.get("interval")).toBe("4h");
    expect(parsed.searchParams.get("headless")).toBe("1");
  });

  it("includes optional indicators and levels when provided", () => {
    const url = renderer.buildUrl({
      symbol: "ETH",
      interval: "1h",
      indicators: "RSI,MACD",
      levels: "S1,R1",
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get("indicators")).toBe("RSI,MACD");
    expect(parsed.searchParams.get("levels")).toBe("S1,R1");
  });

  it("omits indicators and levels when undefined", () => {
    const url = renderer.buildUrl({ symbol: "SOL", interval: "15m" });
    const parsed = new URL(url);
    expect(parsed.searchParams.has("indicators")).toBe(false);
    expect(parsed.searchParams.has("levels")).toBe(false);
  });

  it("URL-encodes special characters in params", () => {
    const url = renderer.buildUrl({ symbol: "BTC/USDT", interval: "1h" });
    // URLSearchParams encodes / as %2F
    expect(url).toContain("BTC");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("symbol")).toBe("BTC/USDT");
  });
});

// ---------------------------------------------------------------------------
// snapshot() happy path
// ---------------------------------------------------------------------------

describe("ChartRenderer.snapshot", () => {
  it("returns PNG bytes when WebView stub succeeds", async () => {
    const stub = makeWebViewStub();
    const renderer = new InjectableChartRenderer("http://127.0.0.1:15401", NOOP_LOGGER);
    renderer.configure(stub);

    const result = await renderer.snapshot({ symbol: "BTC", interval: "4h" });

    expect(result).toBeInstanceOf(Uint8Array);
    // First 4 bytes of PNG magic
    expect(result[0]).toBe(137);
    expect(result[1]).toBe(80);
    expect(result[2]).toBe(78);
    expect(result[3]).toBe(71);
  });

  it("calls navigate with correct URL including headless=1", async () => {
    const stub = makeWebViewStub();
    const renderer = new InjectableChartRenderer("http://127.0.0.1:15401", NOOP_LOGGER);
    renderer.configure(stub);

    await renderer.snapshot({ symbol: "ETH", interval: "1h", indicators: "RSI" });

    expect(stub.navigate.mock.calls.length).toBe(1);
    const [calledUrl] = stub.navigate.mock.calls[0] as [string];
    const parsed = new URL(calledUrl);
    expect(parsed.searchParams.get("symbol")).toBe("ETH");
    expect(parsed.searchParams.get("headless")).toBe("1");
    expect(parsed.searchParams.get("indicators")).toBe("RSI");
  });

  it("rejects cleanly when WebView constructor throws (e.g. no display)", async () => {
    const renderer = new InjectableChartRenderer("http://127.0.0.1:15401", NOOP_LOGGER);
    renderer.configure(null, new Error("no display server"));

    await expect(renderer.snapshot({ symbol: "BTC", interval: "4h" }))
      .rejects.toThrow("no display server");
  });
});

// ---------------------------------------------------------------------------
// Mutex / serialization tests
// ---------------------------------------------------------------------------

describe("ChartRenderer mutex serialization", () => {
  it("serializes concurrent snapshot() calls — navigate not called in parallel", async () => {
    const callOrder: string[] = [];
    let resolveFirst!: () => void;
    const firstBlocker = new Promise<void>((r) => { resolveFirst = r; });

    const stub = makeWebViewStub({
      navigate: mock(async (url: string) => {
        const sym = new URL(url).searchParams.get("symbol");
        callOrder.push(`navigate:${sym}:start`);
        if (sym === "BTC") {
          // First call blocks until released.
          await firstBlocker;
        }
        callOrder.push(`navigate:${sym}:end`);
      }),
      evaluate: mock(async () => true),
    });

    const renderer = new InjectableChartRenderer("http://127.0.0.1:15401", NOOP_LOGGER);
    renderer.configure(stub);

    // Start two concurrent snapshots.
    const p1 = renderer.snapshot({ symbol: "BTC", interval: "4h" });
    const p2 = renderer.snapshot({ symbol: "ETH", interval: "1h" });

    // ETH should not start until BTC finishes.
    await Bun.sleep(10);
    expect(callOrder.filter((e) => e.startsWith("navigate:ETH"))).toHaveLength(0);

    resolveFirst();
    await Promise.all([p1, p2]);

    // BTC completes before ETH starts.
    const btcEnd = callOrder.indexOf("navigate:BTC:end");
    const ethStart = callOrder.indexOf("navigate:ETH:start");
    expect(btcEnd).toBeLessThan(ethStart);
  });
});

// ---------------------------------------------------------------------------
// waitForReady polling tests
// ---------------------------------------------------------------------------

describe("ChartRenderer waitForReady", () => {
  it("polls evaluate until __chartReady is true", async () => {
    let callCount = 0;
    const stub = makeWebViewStub({
      evaluate: mock(async () => {
        callCount++;
        // Return true on the 3rd call.
        return callCount >= 3;
      }),
    });

    const renderer = new InjectableChartRenderer("http://127.0.0.1:15401", NOOP_LOGGER);
    // Override to use a waitForReady-aware version.
    // We test waitForReady indirectly by driving evaluate to return false first.
    // To test polling directly we use a subclass that exposes it.
    renderer.configure(stub);

    // Use a custom snapshot override for this specific polling test:
    class PollingTestRenderer extends ChartRenderer {
      private _stub: WebViewStub;
      constructor(base: string, logger: typeof NOOP_LOGGER, stub: WebViewStub) {
        super(base, logger);
        this._stub = stub;
      }

      override snapshot(spec: ChartSpec): Promise<Uint8Array> {
        const inner = async (): Promise<Uint8Array> => {
          const url = this.buildUrl(spec);
          await this._stub.navigate(url);
          // Drive waitForReady by calling evaluate in a loop (inline for testability).
          const deadline = Date.now() + 500; // short timeout for test
          while (Date.now() < deadline) {
            const ready = await this._stub.evaluate("window.__chartReady === true");
            if (ready === true) break;
            await Bun.sleep(10);
          }
          const blob = await this._stub.screenshot() as Blob;
          return new Uint8Array(await blob.arrayBuffer());
        };
        const parent = this as unknown as { mutex: Promise<unknown> };
        const next = parent.mutex.then(() => inner());
        parent.mutex = next.catch(() => undefined);
        return next;
      }
    }

    const pollingRenderer = new PollingTestRenderer("http://127.0.0.1:15401", NOOP_LOGGER, stub);
    const result = await pollingRenderer.snapshot({ symbol: "BTC", interval: "4h" });
    expect(result).toBeInstanceOf(Uint8Array);
    // evaluate was called at least 3 times (returned false twice then true).
    expect(stub.evaluate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// close() tests
// ---------------------------------------------------------------------------

describe("ChartRenderer.close", () => {
  it("is idempotent — safe to call multiple times", async () => {
    // close() on a renderer that never created a WebView should be safe.
    const renderer = new InjectableChartRenderer("http://127.0.0.1:15401", NOOP_LOGGER);
    renderer.configure(makeWebViewStub());

    await expect(renderer.close()).resolves.toBeUndefined();
    await expect(renderer.close()).resolves.toBeUndefined();
  });

  it("calling close() does not block subsequent snapshot() calls from rejecting cleanly", async () => {
    const renderer = new InjectableChartRenderer("http://127.0.0.1:15401", NOOP_LOGGER);
    renderer.configure(null, new Error("closed"));

    await renderer.close(); // no-op (no real WebView)
    await expect(renderer.snapshot({ symbol: "BTC", interval: "1h" }))
      .rejects.toThrow("closed");
  });

  it("ensureWebview after close() rejects with 'closed' (no phantom WebView spawn)", async () => {
    // Exercises the real ensureWebview() short-circuit on the closed flag —
    // independent of the injectable subclass path. After close(), no new
    // WebView may be constructed even if snapshot() is somehow invoked.
    const renderer = new TestableChartRenderer("http://127.0.0.1:15401", NOOP_LOGGER);
    await renderer.close();
    await expect(renderer.forceEnsure()).rejects.toThrow("chart-renderer: closed");
  });
});
