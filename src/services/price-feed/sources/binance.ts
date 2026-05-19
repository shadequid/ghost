/**
 * BinanceSource — unified WS + REST price source for Binance USDⓈ-M
 * perpetual futures.
 *
 * Ghost is a perp-trading companion (target venue: Hyperliquid perp).
 * The fallback source must therefore quote the same instrument family,
 * not Binance spot — perp/spot basis (typically 0.05–0.5%, occasionally
 * higher under stressed funding) would otherwise pollute every alert
 * threshold and watchlist tick during HL outages. Endpoints:
 *
 *   - WS transport (primary):  wss://fstream.binance.com/ws/!markPrice@arr@1s
 *   - REST transport (dormant): https://fapi.binance.com/fapi/v1/premiumIndex
 *
 * `!markPrice@arr@1s` streams mark prices for every USDⓈ-M perp every
 * second; `premiumIndex` is the equivalent REST snapshot with the same
 * `markPrice` field. Both keep the source aligned with HL's mark-quoted
 * risk engine; an earlier draft used `!miniTicker@arr` (last-trade)
 * which drifted ~basis points from mark on every tick.
 *
 * Symbol mapping
 * --------------
 * Critical: Binance emits native-base symbols (BTCUSDT → BTC, PEPEUSDT →
 * PEPE) but HL uses unit-normalized perps (kPEPE = 1000 PEPE). Without
 * translation downstream consumers silently drop meme-coin ticks at the
 * watchlist filter. `mapBinanceSymbol()` is applied BEFORE emission; the
 * source only ever emits HL-canonical symbols.
 *
 * Unmapped Binance symbols (markets HL doesn't list) are dropped at the
 * source. Stable-stable pairs and leveraged tokens are filtered structurally
 * so junk doesn't pollute upstream mapping lookups.
 *
 * Health model mirrors HyperliquidSource: getLastTickAt() = max(lastWsTickAt,
 * lastRestTickAt), internal reconcileTransports loop for WS→REST fallback.
 */

import type { Logger } from "pino";
import type { PriceSource, PriceTickCallback } from "../types.js";
import { mapBinanceSymbol } from "../symbol-mapping.js";

export interface BinanceSourceOptions {
  logger: Logger;
  /** Override WS URL for tests. Default: public !markPrice@arr@1s stream. */
  wsUrl?: string;
  /** Override REST URL for tests. Default: public premiumIndex endpoint. */
  restUrl?: string;
  /** REST poll interval while in fallback mode. Default 5s. */
  restIntervalMs?: number;
  /** WS tick must be silent this long before REST fallback activates. Default 10s. */
  wsStaleMs?: number;
  /** WS must be continuously fresh this long before REST fallback deactivates. Default 5s. */
  wsStabilityMs?: number;
  /** How often the internal health loop runs. Default 1s. */
  healthCheckIntervalMs?: number;
  /** Override fetch for tests. Default: global fetch. */
  fetchFn?: (input: string) => Promise<Response>;
}

interface BinanceMarkPriceUpdate {
  /** Event type — "markPriceUpdate" */
  e?: string;
  /** Symbol — e.g. "BTCUSDT" */
  s?: string;
  /** Mark price (stringified number). */
  p?: string;
  /** Open price 24h ago (stringified number) — present on miniTicker streams, absent on markPrice stream. */
  o?: string;
}

interface BinanceRestPremiumIndex {
  symbol?: string;
  /** Mark price (stringified number). */
  markPrice?: string;
  /** Open price 24h ago (stringified number) — absent on premiumIndex, present on ticker/24hr. */
  openPrice?: string;
}

// USDⓈ-M perpetual futures, MARK price streams. Ghost is a perp companion
// and HL's risk engine quotes mark for PnL/liquidation/funding — Binance
// fallback must emit the same metric (last-trade or mid would drift by
// basis vs HL mark on every failover, polluting alert thresholds and the
// watchlist widget with mismatched numbers).
const DEFAULT_WS_URL = "wss://fstream.binance.com/ws/!markPrice@arr@1s";
const DEFAULT_REST_URL = "https://fapi.binance.com/fapi/v1/premiumIndex";
const DEFAULT_REST_INTERVAL_MS = 5_000;
const DEFAULT_WS_STALE_MS = 10_000;
const DEFAULT_WS_STABILITY_MS = 5_000;
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 1_000;

/**
 * Stable-stable bases: USDCUSDT / FDUSDUSDT / ... have bases (USDC, FDUSD)
 * that aren't HL perp symbols. Filtered pre-mapping for symmetry with the
 * old BinanceWsSource behavior and to keep trace logs clean.
 */
const STABLE_BASES = new Set([
  "USDC", "FDUSD", "TUSD", "DAI", "USDP", "BUSD", "USDD", "USDE", "PYUSD", "USDB",
]);

/** Binance leveraged token suffixes — don't exist on HL. */
const LEVERAGED_SUFFIX_RE = /(?:UP|DOWN|BULL|BEAR)$/;

export class BinanceSource implements PriceSource {
  readonly name = "binance";
  readonly priority = 1;

  private readonly log: Logger;
  private readonly wsUrl: string;
  private readonly restUrl: string;
  private readonly restIntervalMs: number;
  private readonly wsStaleMs: number;
  private readonly wsStabilityMs: number;
  private readonly healthCheckIntervalMs: number;
  private readonly fetchFn: (input: string) => Promise<Response>;

  private onTick: PriceTickCallback | null = null;
  private stopped = true;

  // --- WS state ---
  private ws: WebSocket | null = null;
  private wsRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private wsRetryCount = 0;
  private lastWsTickAt = 0;

  // --- REST state ---
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  private restPolling = false;
  private lastRestTickAt = 0;

  // --- Internal fallback orchestration ---
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private wsHealthySinceMs = 0;
  private startedAt = 0;

  constructor(opts: BinanceSourceOptions) {
    this.log = opts.logger;
    this.wsUrl = opts.wsUrl ?? DEFAULT_WS_URL;
    this.restUrl = opts.restUrl ?? DEFAULT_REST_URL;
    this.restIntervalMs = opts.restIntervalMs ?? DEFAULT_REST_INTERVAL_MS;
    this.wsStaleMs = opts.wsStaleMs ?? DEFAULT_WS_STALE_MS;
    this.wsStabilityMs = opts.wsStabilityMs ?? DEFAULT_WS_STABILITY_MS;
    this.healthCheckIntervalMs = opts.healthCheckIntervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS;
    this.fetchFn = opts.fetchFn ?? ((input: string) => fetch(input));
  }

  getLastTickAt(): number {
    return Math.max(this.lastWsTickAt, this.lastRestTickAt);
  }

  /** Test introspection — is the internal REST polling loop currently armed? */
  isRestPolling(): boolean {
    return this.restPolling;
  }

  async start(onTick: PriceTickCallback): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.onTick = onTick;
    this.wsRetryCount = 0;
    this.startedAt = Date.now();
    this.wsHealthySinceMs = 0;

    this.log.info({
      wsStaleMs: this.wsStaleMs,
      restIntervalMs: this.restIntervalMs,
    }, "binance source starting (WS primary, REST dormant)");

    this.connectWs();

    this.healthTimer = setInterval(() => { this.reconcileTransports(); }, this.healthCheckIntervalMs);
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
    this.deactivateRest();
    this.cleanupWs();

    this.onTick = null;
  }

  // --- WS transport ---------------------------------------------------------

  private connectWs(): void {
    if (this.stopped) return;
    try {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;

      ws.addEventListener("open", () => {
        this.wsRetryCount = 0;
        this.log.info("binance source: WS connected");
      });

      ws.addEventListener("message", (ev: MessageEvent) => {
        this.handleWsMessage(ev.data);
      });

      ws.addEventListener("close", () => {
        if (this.stopped) return;
        this.log.warn("binance source: WS closed, scheduling retry");
        this.scheduleWsRetry();
      });

      ws.addEventListener("error", (ev) => {
        if (this.stopped) return;
        // `{ err: ev }` makes pino serialize a DOM ErrorEvent,
        // which flattens to `{isTrusted:false}` — useless for ops diagnosing
        // a Binance WS flake. Extract the fields pino can actually serialize.
        this.log.warn(
          { event: serializeWsErrorEvent(ev) },
          "binance source: WS error",
        );
      });
    } catch (err) {
      this.log.warn({ err }, "binance source: WS failed to open");
      this.scheduleWsRetry();
    }
  }

  /**
   * Parse one mini-ticker frame and emit mapped ticks. Exposed
   * (package-private) for unit tests so the pure parsing path can be
   * exercised without opening a real socket.
   */
  handleWsMessage(raw: unknown): void {
    if (this.stopped) return;
    const callback = this.onTick;
    if (!callback) return;
    const text = typeof raw === "string" ? raw : null;
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }
    // Stream is an array of mark-price updates per frame.
    if (!Array.isArray(parsed)) return;
    const now = Date.now();
    let anyEmitted = false;
    for (const entry of parsed as BinanceMarkPriceUpdate[]) {
      const sym = entry?.s;
      const mark = entry?.p;
      if (typeof sym !== "string" || typeof mark !== "string") continue;
      const emitted = this.emitMapped(sym, mark, entry.o, callback);
      if (emitted) anyEmitted = true;
    }
    if (anyEmitted) this.lastWsTickAt = now;
  }

  private scheduleWsRetry(): void {
    if (this.stopped || this.wsRetryTimer) return;
    this.cleanupWs();
    const delay = Math.min(5_000 * 2 ** this.wsRetryCount, 60_000);
    this.wsRetryCount++;
    this.log.info({ delay, attempt: this.wsRetryCount }, "binance source: WS retry scheduled");
    this.wsRetryTimer = setTimeout(() => {
      this.wsRetryTimer = null;
      if (this.stopped) return;
      this.connectWs();
    }, delay);
  }

  private cleanupWs(): void {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
  }

  // --- REST transport -------------------------------------------------------

  private activateRest(): void {
    if (this.stopped) return;
    if (this.restPolling) return;
    this.restPolling = true;
    this.log.info({ intervalMs: this.restIntervalMs }, "binance source: REST fallback activated");
    this.restTimer = setTimeout(() => this.restTick(), 0);
  }

  private deactivateRest(): void {
    if (!this.restPolling && this.restTimer === null) return;
    this.restPolling = false;
    if (this.restTimer) {
      clearTimeout(this.restTimer);
      this.restTimer = null;
    }
    this.log.info("binance source: REST fallback deactivated");
  }

  private async restTick(): Promise<void> {
    if (this.stopped || !this.restPolling) return;
    try {
      const res = await this.fetchFn(this.restUrl);
      if (this.stopped || !this.restPolling) return;
      if (!res.ok) {
        this.log.warn({ status: res.status }, "binance source: REST poll non-OK");
      } else {
        const body = await res.json() as unknown;
        if (this.stopped || !this.restPolling) return;
        if (Array.isArray(body)) {
          const callback = this.onTick;
          if (callback) {
            const now = Date.now();
            let anyEmitted = false;
            for (const row of body as BinanceRestPremiumIndex[]) {
              if (this.stopped || !this.restPolling) return;
              const sym = row?.symbol;
              const mark = row?.markPrice;
              if (typeof sym !== "string" || typeof mark !== "string") continue;
              const emitted = this.emitMapped(sym, mark, row.openPrice, callback);
              if (emitted) anyEmitted = true;
            }
            if (anyEmitted) this.lastRestTickAt = now;
          }
        }
      }
    } catch (err) {
      this.log.warn({ err }, "binance source: REST poll failed");
    } finally {
      if (!this.stopped && this.restPolling) {
        this.restTimer = setTimeout(() => this.restTick(), this.restIntervalMs);
      }
    }
  }

  // --- Symbol mapping + filtering ------------------------------------------

  /**
   * Apply the canonical filter→map→multiply→emit pipeline to a single
   * Binance (symbol, priceStr, prevDayPriceStr) tuple. Returns true when a
   * tick was emitted, false when filtered/mapped-out/parse-error. Shared
   * between WS and REST paths so mapping semantics cannot drift between the
   * two. `prevDayPriceStr` is optional — absent on the markPrice stream and
   * premiumIndex REST endpoint; present if a richer stream is ever adopted.
   */
  private emitMapped(
    binanceSymbol: string,
    priceStr: string,
    prevDayPriceStr: string | undefined,
    callback: PriceTickCallback,
  ): boolean {
    // Structural filters first — cheap rejection before mapping lookup and
    // before we count the symbol as "seen" for tick-age purposes.
    if (!binanceSymbol.endsWith("USDT")) return false;
    const base = binanceSymbol.slice(0, -4);
    if (base.length < 2) return false;
    if (STABLE_BASES.has(base)) return false;
    if (LEVERAGED_SUFFIX_RE.test(base)) return false;

    const mapping = mapBinanceSymbol(binanceSymbol);
    if (!mapping) return false;

    const binancePrice = parseFloat(priceStr);
    if (!Number.isFinite(binancePrice)) return false;

    const hlPrice = binancePrice * mapping.multiplier;

    let prevDayPrice: number | undefined;
    if (prevDayPriceStr !== undefined) {
      const rawPrev = Number.parseFloat(prevDayPriceStr);
      if (Number.isFinite(rawPrev) && rawPrev > 0) {
        prevDayPrice = rawPrev * mapping.multiplier;
      }
    }

    callback(mapping.hlSymbol, hlPrice, prevDayPrice);
    return true;
  }

  // --- Internal fallback orchestration --------------------------------------

  private reconcileTransports(): void {
    if (this.stopped) return;
    const now = Date.now();
    const wsAge = this.lastWsTickAt === 0
      ? now - this.startedAt
      : now - this.lastWsTickAt;
    const wsFresh = wsAge <= this.wsStaleMs && this.lastWsTickAt > 0;

    // Only reset the stability counter when we've entered the
    // definitively-stale regime (wsAge > wsStaleMs), not on any edge-case
    // observation. Binance !markPrice@arr@1s is typically 1s-cadence but
    // can burst-gap on rare Binance infra blips; the previous reset-on-any-stale
    // behavior prevented REST from ever deactivating under those conditions.
    if (wsFresh) {
      if (this.wsHealthySinceMs === 0) this.wsHealthySinceMs = now;
    } else if (wsAge > this.wsStaleMs) {
      this.wsHealthySinceMs = 0;
    }

    if (!this.restPolling) {
      const shouldActivate = wsAge > this.wsStaleMs;
      if (shouldActivate) {
        this.log.warn(
          { wsAgeMs: wsAge },
          "binance source: WS stale, activating internal REST fallback",
        );
        this.activateRest();
      }
      return;
    }

    if (!wsFresh) return;
    const stableFor = now - this.wsHealthySinceMs;
    if (stableFor < this.wsStabilityMs) return;

    this.log.info(
      { stableForMs: stableFor },
      "binance source: WS stable, deactivating internal REST fallback",
    );
    this.deactivateRest();
  }
}

/** Extract pino-serializable fields from a DOM-style ErrorEvent. */
function serializeWsErrorEvent(ev: Event): Record<string, unknown> {
  const e = ev as Event & { message?: unknown; error?: unknown };
  const underlying = e.error;
  return {
    type: ev.type,
    message: typeof e.message === "string" ? e.message : undefined,
    error: underlying instanceof Error
      ? { name: underlying.name, message: underlying.message }
      : underlying !== undefined
        ? String(underlying)
        : undefined,
  };
}
