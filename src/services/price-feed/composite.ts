/**
 * CompositePriceFeed — priority-based failover across multiple PriceSources.
 *
 * Mirrors the WsPriceFeed public surface (start/stop/isConnected) so it drops
 * into the gateway without frontend-visible changes. Only the currently-elected
 * primary source's ticks are forwarded downstream; there is no merge, averaging
 * or offset compensation.
 *
 * Architecture note (post-refactor, 2-source model):
 * --------------------------------------------------
 * Each `PriceSource` now owns its intra-exchange resilience internally
 * (WS→REST fallback, retry/backoff). The composite handles only cross-
 * exchange failover: HL source stale → Binance, HL recovers → restore HL.
 *
 * Failover logic:
 *   - Every healthCheckIntervalMs, check if the primary is stale (no tick
 *     within staleThresholdMs). If so, promote the highest-priority source
 *     that IS still healthy.
 *   - If the current primary is not the highest-priority source and a higher-
 *     priority source has been healthy continuously for stabilityWindowMs,
 *     restore it to primary (anti-flap).
 *   - If every source is stale, log once per transition (not every tick).
 */

import type { Logger } from "pino";
import {
  DEFAULT_COMPOSITE_CONFIG,
  type CompositeConfig,
  type PriceSource,
  type PriceTickCallback,
} from "./types.js";

export class CompositePriceFeed {
  private readonly sources: PriceSource[];
  private readonly staleMs: number;
  private readonly stabilityMs: number;
  private readonly checkIntervalMs: number;
  private readonly log: Logger;

  private onPrice: PriceTickCallback | null = null;
  private currentPrimary: string | null = null;
  /** Timestamp when the current primary was installed — used to rate-limit restore. */
  private lastPromotionAt = 0;
  /** Per-source timestamp of when the source first became healthy after being unhealthy. */
  private readonly healthySince = new Map<string, number>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  /** Sticky flag so the "all sources stale" error is logged once per transition
   *  rather than every health tick. Cleared when a promotion happens. */
  private allStale = false;
  /** Serializes start/stop transitions so callers that toggle rapidly (hot reload,
   *  page refresh, WS hiccups) can't interleave and leave sources in an
   *  inconsistent state. All lifecycle work goes through this chain. */
  private lifecycleQueue: Promise<void> = Promise.resolve();
  /** Guards reconcilePrimary against reentry — a slow source.stop() during
   *  stop() shouldn't let a concurrent health tick touch half-torn-down state. */
  private reconcileInFlight = false;

  constructor(sources: PriceSource[], config: CompositeConfig, logger: Logger) {
    // Sort ascending by priority — index 0 is the preferred primary.
    this.sources = [...sources].sort((a, b) => a.priority - b.priority);
    this.staleMs = config.staleThresholdMs ?? DEFAULT_COMPOSITE_CONFIG.staleThresholdMs;
    this.stabilityMs = config.stabilityWindowMs ?? DEFAULT_COMPOSITE_CONFIG.stabilityWindowMs;
    this.checkIntervalMs = config.healthCheckIntervalMs ?? DEFAULT_COMPOSITE_CONFIG.healthCheckIntervalMs;
    this.log = logger;
  }

  /** True if at least one source is healthy (has produced a tick recently). */
  isConnected(): boolean {
    return this.sources.some((s) => this.isHealthy(s));
  }

  start(onPrice: PriceTickCallback): Promise<void> {
    // Serialize through the lifecycle queue — a previous stop() must complete
    // (sources fully torn down) before a new start() runs, and vice versa.
    const next = this.lifecycleQueue.then(
      () => this.doStart(onPrice),
      () => this.doStart(onPrice),
    );
    this.lifecycleQueue = next.catch(() => { /* swallowed — logged inside doStart */ });
    return next;
  }

  stop(): Promise<void> {
    const next = this.lifecycleQueue.then(
      () => this.doStop(),
      () => this.doStop(),
    );
    this.lifecycleQueue = next.catch(() => { /* swallowed — logged inside doStop */ });
    return next;
  }

  private async doStart(onPrice: PriceTickCallback): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.onPrice = onPrice;

    if (this.sources.length === 0) {
      this.log.warn("composite price feed started with no sources");
      return;
    }

    // Start with no primary — handleTick will elect the first source to tick
    // (reconcile then restores higher priority once it's stable). This avoids
    // dropping ticks from faster-connecting fallbacks during the cold-start
    // window.
    this.currentPrimary = null;
    this.lastPromotionAt = Date.now();
    this.allStale = false;

    const names = this.sources.map((s) => `${s.name}(${s.priority})`).join(", ");
    this.log.info({ sources: names }, "composite price feed starting");

    // Start all sources in parallel. Failures are logged per source and don't
    // block the others — composite is designed to tolerate missing sources.
    await Promise.all(this.sources.map(async (source) => {
      try {
        await source.start((symbol, price, prevDayPrice) => this.handleTick(source, symbol, price, prevDayPrice));
      } catch (err) {
        this.log.warn({ err, source: source.name }, "source failed to start");
      }
    }));

    // If stop() ran while sources were starting, bail out — doStop queued
    // behind us will run next and tear everything down.
    if (!this.started) return;

    this.healthTimer = setInterval(() => { void this.reconcilePrimary(); }, this.checkIntervalMs);
  }

  private async doStop(): Promise<void> {
    if (!this.started) return;
    // Clear the timer first so reconcile can't run during teardown. But keep
    // `started = true` until sources finish stopping so that a concurrent
    // start() queued behind us observes the correct "still running" state and
    // waits rather than racing into a half-stopped source.
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    await Promise.all(this.sources.map(async (source) => {
      try { await source.stop(); } catch (err) {
        this.log.warn({ err, source: source.name }, "source failed to stop cleanly");
      }
    }));
    this.started = false;
    this.currentPrimary = null;
    this.allStale = false;
    this.healthySince.clear();
    this.onPrice = null;
  }

  private handleTick(source: PriceSource, symbol: string, price: number, prevDayPrice?: number): void {
    if (!this.onPrice) return;
    // First-tick election — whichever source ticks first during the cold-start
    // window becomes initial primary. Reconcile will still promote the top-
    // priority source once it's stably healthy.
    if (this.currentPrimary === null) {
      this.currentPrimary = source.name;
      this.lastPromotionAt = Date.now();
      this.log.info({ source: source.name }, "price-feed initial primary elected");
    }
    // Only the elected primary's ticks are forwarded downstream. Other sources
    // still tick internally so their getLastTickAt() stays fresh for failover.
    if (source.name !== this.currentPrimary) return;
    this.onPrice(symbol, price, prevDayPrice);
  }

  private isHealthy(source: PriceSource): boolean {
    const last = source.getLastTickAt();
    if (last === 0) return false;
    return Date.now() - last <= this.staleMs;
  }

  /** Pick the highest-priority (lowest number) currently-healthy source, or null. */
  private pickHealthy(): PriceSource | null {
    for (const s of this.sources) {
      if (this.isHealthy(s)) return s;
    }
    return null;
  }

  private reconcilePrimary(): void {
    if (this.reconcileInFlight) return;
    if (!this.started || this.sources.length === 0) return;
    this.reconcileInFlight = true;
    try {
      this.doReconcile();
    } finally {
      this.reconcileInFlight = false;
    }
  }

  private doReconcile(): void {
    const now = Date.now();

    // Update the per-source "healthy since" tracker. Cleared when a source
    // drops, set to "now" on the first check it passes health.
    for (const s of this.sources) {
      if (this.isHealthy(s)) {
        if (!this.healthySince.has(s.name)) this.healthySince.set(s.name, now);
      } else {
        this.healthySince.delete(s.name);
      }
    }

    const primary = this.sources.find((s) => s.name === this.currentPrimary) ?? null;
    const primaryHealthy = primary ? this.isHealthy(primary) : false;

    // Case 1: primary is unhealthy — try to promote something.
    if (!primaryHealthy) {
      const next = this.pickHealthy();
      if (next && next.name !== this.currentPrimary) {
        const from = this.currentPrimary;
        this.currentPrimary = next.name;
        this.lastPromotionAt = now;
        this.allStale = false; // a source recovered — reset sticky flag
        this.log.warn({ from, to: next.name }, "price-feed primary failover");
      } else if (!next) {
        // All stale — log once per healthy→degraded transition rather than on
        // every health tick. Recovery is logged by the failover branch above.
        if (!this.allStale) {
          this.allStale = true;
          this.log.error("price-feed: all sources stale, no ticks published");
        }
      }
      return;
    }

    // Primary recovered (or never lost) — clear the sticky all-stale flag so
    // the next degradation logs once again.
    this.allStale = false;

    // Case 2: primary healthy but not top-priority. Consider restoring a
    // higher-priority source if it has been stably healthy long enough.
    const primaryIndex = this.sources.findIndex((s) => s.name === this.currentPrimary);
    if (primaryIndex <= 0) return; // already at top priority
    for (let i = 0; i < primaryIndex; i++) {
      const candidate = this.sources[i]!;
      if (!this.isHealthy(candidate)) continue;
      const since = this.healthySince.get(candidate.name) ?? now;
      const stableFor = now - since;
      // Also require we haven't just promoted — avoids rapid back-and-forth.
      if (stableFor >= this.stabilityMs && now - this.lastPromotionAt >= this.stabilityMs) {
        const from = this.currentPrimary;
        this.currentPrimary = candidate.name;
        this.lastPromotionAt = now;
        this.log.info({ from, to: candidate.name, stableForMs: stableFor }, "price-feed primary restored");
        return;
      }
    }
  }
}
