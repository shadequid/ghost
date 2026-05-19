/**
 * HyperliquidSource — unified WS + REST price source for Hyperliquid perp.
 *
 * Exposes a single PriceSource to the composite. Internally, it runs two
 * transports and orchestrates WS→REST fallback itself:
 *
 *   - WS transport: `assetCtxs` subscription via @nktkas/hyperliquid
 *     (primary). Emits **mark price** per perp asset, not mid — Ghost is
 *     a perp trading companion and HL's risk engine quotes mark for
 *     PnL, liquidation, and funding. Picking mark here keeps the
 *     watchlist widget, alerts, and `ghost_get_price` agreed with
 *     position cards and HL's UI conventions. (Earlier draft used
 *     `allMids` → mid which drifted ~basis points from mark.)
 *   - REST transport: `getAllTickers` polling via the injected trading
 *     client (dormant while WS is healthy, activated on-demand when WS
 *     goes stale). Already returns markPrice — symmetric with WS.
 *
 * Health model
 * ------------
 *   - `lastWsTickAt` + `lastRestTickAt` tracked separately.
 *   - `getLastTickAt() = max(lastWsTickAt, lastRestTickAt)` — the composite
 *     sees one health signal per exchange regardless of which transport
 *     produced the most recent tick.
 *
 * Internal fallback loop (every `healthCheckIntervalMs`):
 *   - If WS has been silent for `wsStaleMs`, activate REST polling.
 *   - Once WS recovers AND has been continuously fresh for `wsStabilityMs`,
 *     deactivate REST polling so we don't keep spending HL /info budget.
 *
 * This keeps the composite simple — cross-exchange failover only — while
 * each source owns its intra-exchange resilience.
 */

import type { Logger } from "pino";
import type { ITradingClient, ITradingSubscription } from "../../interfaces/trading-client.js";
import type { PriceSource, PriceTickCallback } from "../types.js";

export interface HyperliquidSourceOptions {
  testnet?: boolean;
  tradingClient: ITradingClient;
  logger: Logger;
  /** REST poll interval while in fallback mode. Default 5s. */
  restIntervalMs?: number;
  /** WS tick must be silent this long before REST fallback activates. Default 10s. */
  wsStaleMs?: number;
  /** WS must be continuously fresh this long before REST fallback deactivates. Default 5s. */
  wsStabilityMs?: number;
  /** How often the internal health loop runs. Default 1s. */
  healthCheckIntervalMs?: number;
}

const DEFAULT_REST_INTERVAL_MS = 5_000;
const DEFAULT_WS_STALE_MS = 10_000;
const DEFAULT_WS_STABILITY_MS = 5_000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 1_000;

export class HyperliquidSource implements PriceSource {
  readonly name = "hyperliquid";
  readonly priority = 0;

  private readonly testnet: boolean;
  private readonly tradingClient: ITradingClient;
  private readonly log: Logger;
  private readonly restIntervalMs: number;
  private readonly wsStaleMs: number;
  private readonly wsStabilityMs: number;
  private readonly healthCheckIntervalMs: number;

  private onTick: PriceTickCallback | null = null;
  private stopped = true;

  // --- WS state ---
  private wsSubscription: ITradingSubscription | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private wsRetryCount = 0;
  private lastWsTickAt = 0;

  // --- REST state ---
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private restPolling = false;
  private lastRestTickAt = 0;

  // --- Internal fallback orchestration ---
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  /** Wall-clock marker for when we last saw the WS tick. Used to decide if
   *  "WS has been stable for wsStabilityMs" when deciding to deactivate REST. */
  private wsHealthySinceMs = 0;
  /** Captured at start() so cold-start fallback uses wall time, not tick time. */
  private startedAt = 0;

  constructor(opts: HyperliquidSourceOptions) {
    // testnet stored for future use (e.g. if tradingClient exposes a testnet flag)
    this.testnet = opts.testnet ?? false;
    this.tradingClient = opts.tradingClient;
    this.log = opts.logger;
    this.restIntervalMs = opts.restIntervalMs ?? DEFAULT_REST_INTERVAL_MS;
    this.wsStaleMs = opts.wsStaleMs ?? DEFAULT_WS_STALE_MS;
    this.wsStabilityMs = opts.wsStabilityMs ?? DEFAULT_WS_STABILITY_MS;
    this.healthCheckIntervalMs = opts.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS;
  }

  getLastTickAt(): number {
    return Math.max(this.lastWsTickAt, this.lastRestTickAt);
  }

  /** Test introspection — is the internal REST polling loop currently armed? */
  isRestPolling(): boolean {
    return this.restPolling;
  }

  async start(onTick: PriceTickCallback): Promise<void> {
    if (!this.stopped) return; // already running
    this.stopped = false;
    this.onTick = onTick;
    this.wsRetryCount = 0;
    this.startedAt = Date.now();
    this.wsHealthySinceMs = 0;

    this.log.info({
      wsStaleMs: this.wsStaleMs,
      restIntervalMs: this.restIntervalMs,
    }, "hyperliquid source starting (WS primary, REST dormant)");

    // Connect WS first so it can stream deltas while REST hydration is in flight.
    await this.connectWs();
    // Raced with stop() during the WS handshake — bail before REST hydration
    // and arming the reconcile loop so we don't leave live timers on a stopped source.
    if (this.stopped) return;

    await this.hydrateFromRest();

    if (this.stopped) return;

    // Arm the internal fallback loop.
    this.healthTimer = setInterval(() => { this.reconcileTransports(); }, this.healthCheckIntervalMs);
  }

  /**
   * One-shot REST snapshot at startup. Pushes every ticker through the normal
   * onTick path so the cache is hot before start() resolves — no gateway-level
   * gate needed. Failure is non-fatal: WS will catch up.
   */
  private async hydrateFromRest(): Promise<void> {
    try {
      const tickers = await this.tradingClient.getAllTickers();
      if (this.stopped) return;
      const callback = this.onTick;
      if (!callback) return;
      for (const t of tickers) {
        if (!Number.isFinite(t.markPrice)) continue;
        const prev = Number.isFinite(t.prevDayPrice) && t.prevDayPrice > 0
          ? t.prevDayPrice
          : undefined;
        callback(t.symbol, t.markPrice, prev);
      }
      this.log.info({ count: tickers.length }, "hyperliquid source: REST hydration complete");
    } catch (err) {
      this.log.warn({ err }, "hyperliquid source: REST hydration failed; relying on WS");
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    if (this.wsRetryTimer) {
      clearTimeout(this.wsRetryTimer);
      this.wsRetryTimer = null;
    }
    this.deactivateRest(); // idempotent
    await this.cleanupWs();

    this.onTick = null;
  }

  // --- WS transport ---------------------------------------------------------

  private async connectWs(): Promise<void> {
    if (this.stopped) return;
    try {
      // Ensure meta is loaded so dexUniverses is populated before the first
      // allDexsAssetCtxs frame arrives. ensureMeta is single-flight so
      // concurrent callers are fine.
      await this.tradingClient.ensureMeta();

      if (this.stopped) return;

      const sub = await this.tradingClient.subscribeAllDexsAssetCtxs(
        (event) => this.handleAllDexsAssetCtxsEvent(event),
      );

      if (this.stopped) {
        // Raced with stop() during the await — tear down immediately.
        try { await sub.unsubscribe(); } catch { /* ignore */ }
        return;
      }

      this.wsSubscription = sub;
      this.wsRetryCount = 0;
      this.log.info("hyperliquid source: WS connected (allDexsAssetCtxs)");
    } catch (err) {
      this.log.warn({ err }, "hyperliquid source: WS failed to connect");
      await this.cleanupWs();
      this.scheduleWsRetry();
    }
  }

  /**
   * Handle one `allDexsAssetCtxs` event. The event carries all dexes
   * (native "" + every HIP-3 dex) in a single frame. Each tuple is
   * [dex, ctxs[]] where ctxs is positional — index i maps to the i-th
   * symbol in tradingClient.getDexUniverses().get(dex).
   *
   * Exposed as a non-private method so unit tests can drive the parsing
   * path without a live WS connection.
   */
  handleAllDexsAssetCtxsEvent(
    event: { ctxs: ReadonlyArray<readonly [dex: string, ctxs: ReadonlyArray<{ markPx?: string | number | null; prevDayPx?: string | number | null; [k: string]: unknown }>]> },
  ): void {
    if (this.stopped) return;
    const callback = this.onTick;
    if (!callback) return;

    const dexUniverses = this.tradingClient.getDexUniverses();
    const now = Date.now();
    let anyEmitted = false;

    for (const [dex, ctxs] of event.ctxs) {
      const universe = dexUniverses.get(dex) ?? [];
      for (let i = 0; i < ctxs.length; i++) {
        const symbol = universe[i];
        if (!symbol) continue;
        const ctx = ctxs[i];
        const raw = ctx?.markPx;
        if (raw === null || raw === undefined) continue;
        const mark = typeof raw === "string" ? parseFloat(raw) : Number(raw);
        if (!Number.isFinite(mark)) continue;
        const prevRaw = ctx?.prevDayPx;
        const prevDay = prevRaw != null
          ? (typeof prevRaw === "string" ? parseFloat(prevRaw) : Number(prevRaw))
          : undefined;
        callback(symbol, mark, Number.isFinite(prevDay) ? prevDay : undefined);
        anyEmitted = true;
      }
    }
    if (anyEmitted) this.lastWsTickAt = now;
  }

  private scheduleWsRetry(): void {
    if (this.stopped || this.wsRetryTimer) return;
    const delay = Math.min(5_000 * 2 ** this.wsRetryCount, 60_000);
    this.wsRetryCount++;
    this.log.info({ delay, attempt: this.wsRetryCount }, "hyperliquid source: WS retry scheduled");
    this.wsRetryTimer = setTimeout(async () => {
      this.wsRetryTimer = null;
      if (this.stopped) return;
      await this.cleanupWs();
      await this.connectWs();
    }, delay);
  }

  private async cleanupWs(): Promise<void> {
    if (this.wsSubscription) {
      try { await this.wsSubscription.unsubscribe(); } catch { /* ignore */ }
      this.wsSubscription = null;
    }
  }

  // --- REST transport -------------------------------------------------------

  private activateRest(): void {
    if (this.stopped) return;
    if (this.restPolling) return;
    this.restPolling = true;
    this.log.info({ intervalMs: this.restIntervalMs }, "hyperliquid source: REST fallback activated");
    // Kick off the first poll immediately so we start serving ticks ASAP
    // rather than waiting a full interval.
    this.restTimer = setTimeout(() => this.restTick(), 0);
  }

  private deactivateRest(): void {
    if (!this.restPolling && this.restTimer === null) return;
    this.restPolling = false;
    if (this.restTimer) {
      clearTimeout(this.restTimer);
      this.restTimer = null;
    }
    this.log.info("hyperliquid source: REST fallback deactivated");
  }

  private async restTick(): Promise<void> {
    if (this.stopped || !this.restPolling) return;
    try {
      const tickers = await this.tradingClient.getAllTickers();
      if (this.stopped || !this.restPolling) return;
      // Snapshot the callback so a concurrent stop() clearing this.onTick
      // mid-loop can't null-dereference.
      const callback = this.onTick;
      if (!callback) return;
      const now = Date.now();
      let anyEmitted = false;
      for (const t of tickers) {
        if (this.stopped || !this.restPolling) return;
        if (!Number.isFinite(t.markPrice)) continue;
        const prevDay = Number.isFinite(t.prevDayPrice) && t.prevDayPrice > 0
          ? t.prevDayPrice
          : undefined;
        callback(t.symbol, t.markPrice, prevDay);
        anyEmitted = true;
      }
      // Only advance lastRestTickAt if at least one tick actually made it
      // downstream. Symmetric with BinanceSource.restTick — a REST call that
      // resolves successfully but produces zero emittable ticks (HL ships an
      // empty or all-NaN universe during upgrades) is indistinguishable from
      // a dead source and must trigger failover, not mask it.
      if (anyEmitted) this.lastRestTickAt = now;
    } catch (err) {
      this.log.warn({ err }, "hyperliquid source: REST poll failed");
    } finally {
      // Invariant: next setTimeout is armed only after this poll resolves —
      // polls can't overlap even if getAllTickers is slower than intervalMs.
      if (!this.stopped && this.restPolling) {
        this.restTimer = setTimeout(() => this.restTick(), this.restIntervalMs);
      }
    }
  }

  // --- Internal fallback orchestration --------------------------------------

  /**
   * Decide whether REST should be polling based on WS freshness.
   *
   * Activate when: WS has been silent for `wsStaleMs` (either never produced
   * a tick since start — cold-start WS failure — or produced ticks then went
   * silent).
   *
   * Deactivate when: WS has been continuously fresh for `wsStabilityMs` — we
   * only drop REST once we're confident WS is stable, to avoid flapping back
   * and forth on transient recoveries.
   */
  private reconcileTransports(): void {
    if (this.stopped) return;
    const now = Date.now();
    const wsAge = this.lastWsTickAt === 0
      ? now - this.startedAt
      : now - this.lastWsTickAt;
    const wsFresh = wsAge <= this.wsStaleMs && this.lastWsTickAt > 0;

    // Track how long WS has been continuously fresh.
    // The previous impl reset `wsHealthySinceMs = 0` on ANY
    // stale observation. HL's allMids can have 8-15s quiet stretches (well
    // within typical operation) — on default wsStaleMs=10s, a single
    // reconcile tick finding wsAge slightly over 10s would reset the
    // stability counter, meaning REST never deactivates even though WS is
    // mostly delivering. Only reset once we've definitively entered the
    // stale regime (wsAge > wsStaleMs), not on ties/edges. Going stale
    // naturally triggers `activateRest()` below regardless.
    if (wsFresh) {
      if (this.wsHealthySinceMs === 0) this.wsHealthySinceMs = now;
    } else if (wsAge > this.wsStaleMs) {
      this.wsHealthySinceMs = 0;
    }

    if (!this.restPolling) {
      // Cold-start: WS has never ticked AND enough time has elapsed for its
      // first tick → activate REST. Steady-state: WS was fresh and went
      // stale → activate REST.
      const shouldActivate = wsAge > this.wsStaleMs;
      if (shouldActivate) {
        this.log.warn(
          { wsAgeMs: wsAge },
          "hyperliquid source: WS stale, activating internal REST fallback",
        );
        this.activateRest();
      }
      // Watchdog: even with REST activated, force a WS reconnect if
      // it's been silent for 3× wsStaleMs. Covers SDK quirks where the
      // underlying socket dies without firing `failureSignal` or `terminate`
      // (idle timeout + missed ping-pong). Without this, long-uptime daemons
      // can end up stuck on REST forever after an undetected WS disconnect.
      this.maybeForceWsReconnect(wsAge);
      return;
    }

    // REST is polling. Deactivate only once WS has been stably fresh.
    if (!wsFresh) {
      // Same watchdog when REST is already active — drives recovery back to
      // WS when the socket is zombied.
      this.maybeForceWsReconnect(wsAge);
      return;
    }
    const stableFor = now - this.wsHealthySinceMs;
    if (stableFor < this.wsStabilityMs) return;

    this.log.info(
      { stableForMs: stableFor },
      "hyperliquid source: WS stable, deactivating internal REST fallback",
    );
    this.deactivateRest();
  }

  /**
   * Tear down and reconnect the WS if it's been silent past the watchdog.
   * Protects against SDK quirks where the underlying socket stops delivering
   * ticks but neither `failureSignal` nor `terminate` fires (e.g. silent
   * server-side close the client can't detect without a ping-pong cycle).
   */
  private maybeForceWsReconnect(wsAge: number): void {
    if (!this.wsSubscription) return; // no live WS to rescue
    if (this.wsRetryTimer) return;  // retry already scheduled
    if (wsAge <= 3 * this.wsStaleMs) return;
    this.log.warn(
      { wsAgeMs: wsAge },
      "hyperliquid source: WS silent past watchdog, forcing reconnect",
    );
    // Fire-and-forget is fine — cleanupWs + scheduleWsRetry both already
    // handle the stopped flag internally.
    void this.cleanupWs().then(() => {
      if (this.stopped) return;
      this.scheduleWsRetry();
    });
  }
}

