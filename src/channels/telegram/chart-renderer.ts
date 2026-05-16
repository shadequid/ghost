/**
 * ChartRenderer — headless WebView screenshot of the /chart route.
 *
 * API deviations from plan (validated against bun 1.3.13):
 *   - Constructor:  `new WebView(opts)` — NOT `WebView.create(opts)`
 *   - Screenshot:   `screenshot(): Promise<Blob>` — NOT `takeScreenshot(): Promise<Uint8Array>`
 *   - No `hidden` option; headless on Linux without display server by default.
 *
 * Callers invoke `snapshot(spec)` and handle errors with a text fallback.
 */

import { WebView } from "bun";
import type { Logger } from "pino";

export interface ChartSpec {
  symbol: string;
  interval: string;
  indicators?: string;
  levels?: string;
}

const NAVIGATE_TIMEOUT_MS = 2_000;
const READY_TIMEOUT_MS = 5_000;
const SCREENSHOT_TIMEOUT_MS = 2_000;
const READY_POLL_INTERVAL_MS = 50;
const WEBVIEW_WIDTH = 1_200;
const WEBVIEW_HEIGHT = 720;

export class ChartRenderer {
  private webview: WebView | null = null;
  // Mutex — each call chains on the settled tail so concurrent callers serialize.
  private mutex: Promise<unknown> = Promise.resolve();
  // True once we've logged the unavailability warning.
  private unavailableLogged = false;
  // Once closed, refuse to spawn a new WebView — caller is past dispose.
  private closed = false;

  constructor(
    private readonly gatewayBaseUrl: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Capture a PNG screenshot of the chart for the given spec.
   * Concurrent calls are serialized; errors propagate to the caller.
   */
  snapshot(spec: ChartSpec): Promise<Uint8Array> {
    const next = this.mutex.then(() => this.snapshotInner(spec));
    // Let the mutex tail always settle so subsequent calls are not orphaned.
    this.mutex = next.catch(() => undefined);
    return next;
  }

  private async snapshotInner(spec: ChartSpec): Promise<Uint8Array> {
    const wv = await this.ensureWebview();
    const url = this.buildUrl(spec);
    this.logger.debug({ url }, "chart-renderer: navigate");

    await withTimeout(wv.navigate(url), NAVIGATE_TIMEOUT_MS, "navigate");
    await this.waitForReady(wv, READY_TIMEOUT_MS);

    const blob = await withTimeout(
      (wv.screenshot as () => Promise<Blob>)(),
      SCREENSHOT_TIMEOUT_MS,
      "screenshot",
    );
    return new Uint8Array(await blob.arrayBuffer());
  }

  private async ensureWebview(): Promise<WebView> {
    if (this.closed) throw new Error("chart-renderer: closed");
    if (this.webview) return this.webview;
    try {
      this.webview = new WebView({ width: WEBVIEW_WIDTH, height: WEBVIEW_HEIGHT });
      return this.webview;
    } catch (err) {
      if (!this.unavailableLogged) {
        this.logger.info({ err }, "chart-renderer: WebView unavailable — chart snapshots disabled");
        this.unavailableLogged = true;
      }
      throw err;
    }
  }

  buildUrl(spec: ChartSpec): string {
    const u = new URL("/chart", this.gatewayBaseUrl);
    u.searchParams.set("symbol", spec.symbol);
    u.searchParams.set("interval", spec.interval);
    if (spec.indicators) u.searchParams.set("indicators", spec.indicators);
    if (spec.levels) u.searchParams.set("levels", spec.levels);
    u.searchParams.set("headless", "1");
    return u.toString();
  }

  private async waitForReady(wv: WebView, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ready = await wv.evaluate("window.__chartReady === true");
      if (ready === true) return;
      await Bun.sleep(READY_POLL_INTERVAL_MS);
    }
    throw new Error(`chart-renderer: __chartReady timeout after ${timeoutMs}ms`);
  }

  /** Graceful shutdown — idempotent. Sets `closed=true` so post-shutdown
   *  snapshot() calls reject instead of re-spawning a phantom WebView. */
  async close(): Promise<void> {
    this.closed = true;
    if (!this.webview) return;
    const wv = this.webview;
    this.webview = null;
    try {
      await wv.close();
    } catch {
      // Already closed or no display — safe to ignore.
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`chart-renderer: ${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}
