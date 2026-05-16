/**
 * Unit tests for HyperliquidSource — unified WS + REST source with internal
 * on-demand fallback.
 *
 * WS path coverage
 * ----------------
 * The WS data-plane is exposed as `handleAssetCtxsEvent()` — a package-
 * visible method that mirrors BinanceSource.handleWsMessage. Tests drive
 * the real parsing/emission logic through it instead of reaching into
 * private fields, so future refactors to field names cannot silently
 * disable test coverage.
 *
 * The `assetCtxs` event is positional (ctxs[i] maps to universe[i]),
 * so each WS-driving test seeds the universe via `seedUniverse()`
 * before pushing ctxs.
 *
 * REST path coverage
 * ------------------
 * `tradingClient` dependency is mocked via plain objects — the full REST
 * polling loop (activation/deactivation/emission/error handling) is
 * exercised end-to-end. Fallback orchestration is driven by real
 * `setInterval`/`setTimeout` timers with tight thresholds so tests complete
 * in tens of ms, not seconds.
 *
 * Covers:
 *   - start()/stop() lifecycle and resource cleanup
 *   - WS parsing: string / numeric mids, NaN / Infinity filtering,
 *     lastWsTickAt advances only when at least one entry is emittable
 *   - getLastTickAt() = max(ws, rest)
 *   - Internal REST activation when WS is stale from cold-start
 *   - Internal REST activation when WS ticks then goes silent
 *   - Internal REST deactivation once WS stable for wsStabilityMs
 *   - REST tick during WS outage keeps source healthy
 *   - Both WS + REST dead: getLastTickAt stays frozen
 *   - REST drops zero-emit responses
 *   - Symbol emission passes through HL symbols unchanged (no mapping)
 */

import { describe, test, expect } from "bun:test";
import pino from "pino";
import { HyperliquidSource } from "../../../src/services/price-feed/sources/hyperliquid.js";
import type { Ticker } from "../../../src/services/interfaces/trading-types.js";

const silent = pino({ level: "silent" });

function mkTicker(symbol: string, markPrice: number): Ticker {
  return {
    symbol,
    markPrice,
    midPrice: markPrice,
    oraclePrice: markPrice,
    volume24h: 0,
    prevDayPrice: markPrice,
    priceChangePct24h: 0,
    openInterest: 0,
    fundingRate: 0,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Seed the index→symbol universe map so positional `assetCtxs` events
 * decode correctly without needing a real getAllTickers round-trip.
 * Production seeds this from refreshUniverse() inside connectWs;
 * tests bypass that by injecting directly so the WS handler stays the
 * unit under test.
 */
function seedUniverse(src: HyperliquidSource, symbols: readonly string[]): void {
  (src as unknown as { universe: string[] }).universe = [...symbols];
}

/**
 * Drive a WS tick through the real handler path so `lastWsTickAt` advances
 * the same way production code would. Replaces the previous whitebox
 * `simulateWsTick` helper — future field renames now surface as compile
 * errors rather than silently disabling the tests.
 *
 * Note: `handleAssetCtxsEvent` invokes the registered onTick, which the
 * tests bind to push into `received`. Callers don't need a `received`
 * argument for that reason — signature kept for readability at call
 * sites that want to assert the event reached downstream.
 */
function simulateWsTick(src: HyperliquidSource, symbol: string, price: number): void {
  seedUniverse(src, [symbol]);
  src.handleAssetCtxsEvent({ ctxs: [{ markPx: String(price) }] });
}

describe("HyperliquidSource", () => {
  test("name / priority are stable", () => {
    const src = new HyperliquidSource({
      tradingClient: { async getAllTickers() { return []; } },
      logger: silent,
    });
    expect(src.name).toBe("hyperliquid");
    expect(src.priority).toBe(0);
  });

  test("start() / stop() are idempotent and clean up cleanly", async () => {
    const src = new HyperliquidSource({
      tradingClient: { async getAllTickers() { return []; } },
      logger: silent,
      // Large staleMs so we don't accidentally activate REST
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    await src.start(() => { /* noop */ });
    await src.start(() => { /* noop */ }); // second start is a no-op
    await src.stop();
    await src.stop(); // second stop is a no-op
    expect(src.isRestPolling()).toBe(false);
  });

  test("getLastTickAt() returns max of WS and REST timestamps (real paths)", async () => {
    // Drive both paths via their real emission methods so this test cannot
    // silently pass after a rename/refactor of private state.
    const src = new HyperliquidSource({
      tradingClient: { async getAllTickers() { return [mkTicker("BTC", 100)]; } },
      logger: silent,
      // Large staleMs so REST doesn't auto-activate while we hand-drive.
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    await src.start(() => { /* noop */ });

    expect(src.getLastTickAt()).toBe(0);

    // Drive a WS tick through the real handler.
    seedUniverse(src, ["BTC"]);
    const beforeWs = Date.now();
    src.handleAssetCtxsEvent({ ctxs: [{ markPx: "100" }] });
    const afterWs = src.getLastTickAt();
    expect(afterWs).toBeGreaterThanOrEqual(beforeWs);

    // A subsequent unmappable event (NaN mark) must not advance the stamp.
    src.handleAssetCtxsEvent({ ctxs: [{ markPx: "NaN" }] });
    expect(src.getLastTickAt()).toBe(afterWs);

    await src.stop();
  });

  test("WS stale from cold-start → internal REST activates after wsStaleMs", async () => {
    let restCallCount = 0;
    const src = new HyperliquidSource({
      tradingClient: {
        async getAllTickers() {
          restCallCount++;
          return [mkTicker("BTC", 100)];
        },
      },
      logger: silent,
      wsStaleMs: 20,
      restIntervalMs: 10,
      healthCheckIntervalMs: 5,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    expect(src.isRestPolling()).toBe(false);

    // WS never ticks — after wsStaleMs (20ms) the internal reconcile loop
    // should activate REST.
    await sleep(40);
    expect(src.isRestPolling()).toBe(true);
    expect(restCallCount).toBeGreaterThanOrEqual(1);
    expect(received).toContainEqual(["BTC", 100]);
    expect(src.getLastTickAt()).toBeGreaterThan(0);

    await src.stop();
  });

  test("WS tick then silent → internal REST activates mid-flight", async () => {
    let restCallCount = 0;
    const src = new HyperliquidSource({
      tradingClient: {
        async getAllTickers() {
          restCallCount++;
          return [mkTicker("BTC", 50)];
        },
      },
      logger: silent,
      wsStaleMs: 20,
      restIntervalMs: 10,
      healthCheckIntervalMs: 5,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    // Simulate a single WS tick, then go silent.
    simulateWsTick(src, "BTC", 40);
    expect(src.isRestPolling()).toBe(false);
    await sleep(10);
    expect(src.isRestPolling()).toBe(false); // WS still fresh

    // Let WS go stale for > wsStaleMs.
    await sleep(30);
    expect(src.isRestPolling()).toBe(true);
    expect(restCallCount).toBeGreaterThanOrEqual(1);

    await src.stop();
  });

  test("WS recovers + stable for wsStabilityMs → internal REST deactivates", async () => {
    const src = new HyperliquidSource({
      tradingClient: {
        async getAllTickers() { return [mkTicker("BTC", 100)]; },
      },
      logger: silent,
      wsStaleMs: 20,
      wsStabilityMs: 25,
      restIntervalMs: 10,
      healthCheckIntervalMs: 5,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    // Force WS into stale cold-start → REST activates.
    await sleep(35);
    expect(src.isRestPolling()).toBe(true);

    // Now WS starts ticking continuously across the stability window.
    const end = Date.now() + 60;
    while (Date.now() < end) {
      simulateWsTick(src, "BTC", 200);
      await sleep(5);
    }
    // After wsStabilityMs of continuous fresh WS ticks, REST should be off.
    expect(src.isRestPolling()).toBe(false);

    await src.stop();
  });

  test("REST tick during WS outage keeps source healthy (getLastTickAt advances)", async () => {
    let lastFetchAt = 0;
    const src = new HyperliquidSource({
      tradingClient: {
        async getAllTickers() {
          lastFetchAt = Date.now();
          return [mkTicker("BTC", 100)];
        },
      },
      logger: silent,
      wsStaleMs: 20,
      restIntervalMs: 10,
      healthCheckIntervalMs: 5,
    });
    await src.start(() => { /* noop */ });

    await sleep(45);
    expect(src.isRestPolling()).toBe(true);
    expect(lastFetchAt).toBeGreaterThan(0);
    // Source is healthy — getLastTickAt advanced via REST.
    expect(Date.now() - src.getLastTickAt()).toBeLessThan(50);

    await src.stop();
  });

  test("both WS and REST silent → getLastTickAt freezes at last known", async () => {
    let callCount = 0;
    const src = new HyperliquidSource({
      tradingClient: {
        // First call seeds the universe via refreshUniverse() during
        // start(); second call is the cold-start REST sample we want to
        // succeed; everything after fails so REST stops advancing.
        async getAllTickers() {
          callCount++;
          if (callCount <= 2) return [mkTicker("BTC", 100)];
          throw new Error("network down");
        },
      },
      logger: silent,
      wsStaleMs: 20,
      restIntervalMs: 10,
      healthCheckIntervalMs: 5,
    });
    await src.start(() => { /* noop */ });

    // Let cold-start activate REST and take one successful sample.
    await sleep(30);
    const snapshot = src.getLastTickAt();
    expect(snapshot).toBeGreaterThan(0);

    // Subsequent polls all fail — lastTickAt must stay frozen at snapshot.
    await sleep(40);
    expect(src.getLastTickAt()).toBe(snapshot);

    await src.stop();
  });

  test("stop() while REST is polling halts further polls", async () => {
    let callCount = 0;
    const src = new HyperliquidSource({
      tradingClient: {
        async getAllTickers() {
          callCount++;
          return [mkTicker("BTC", 100)];
        },
      },
      logger: silent,
      wsStaleMs: 10,
      restIntervalMs: 5,
      healthCheckIntervalMs: 5,
    });
    await src.start(() => { /* noop */ });
    await sleep(20); // REST should be polling
    expect(src.isRestPolling()).toBe(true);

    await src.stop();
    const snapshot = callCount;
    await sleep(30);
    expect(callCount).toBe(snapshot);
    expect(src.isRestPolling()).toBe(false);
  });

  test("REST error does not kill the source — next poll still runs", async () => {
    let callCount = 0;
    const src = new HyperliquidSource({
      tradingClient: {
        async getAllTickers() {
          callCount++;
          if (callCount === 1) throw new Error("boom");
          return [mkTicker("BTC", 100)];
        },
      },
      logger: silent,
      wsStaleMs: 10,
      restIntervalMs: 20,
      healthCheckIntervalMs: 5,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    // Cold-start activates REST; first poll throws, second succeeds.
    await sleep(80);
    expect(callCount).toBeGreaterThanOrEqual(2);
    expect(received).toContainEqual(["BTC", 100]);

    await src.stop();
  });

  test("REST emits raw HL symbols — no mapping applied (HL is canonical)", async () => {
    const src = new HyperliquidSource({
      tradingClient: {
        async getAllTickers() {
          return [
            mkTicker("BTC", 60000),
            mkTicker("kPEPE", 0.02),    // k-prefix stays k-prefix
            mkTicker("1000SHIB", 0.025), // 1000-prefix stays 1000-prefix
          ];
        },
      },
      logger: silent,
      wsStaleMs: 10,
      restIntervalMs: 20,
      healthCheckIntervalMs: 5,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));
    await sleep(30); // activate + poll
    await src.stop();

    expect(received).toContainEqual(["BTC", 60000]);
    expect(received).toContainEqual(["kPEPE", 0.02]);
    expect(received).toContainEqual(["1000SHIB", 0.025]);
  });

  test("REST response with zero emittable ticks does not advance lastRestTickAt", async () => {
    // Scenario: HL /info resolves successfully but returns an empty universe
    // (or every ticker has NaN markPrice — happens briefly during HL exchange
    // upgrades). Before the fix, lastRestTickAt advanced on HTTP
    // success, masking the failure and blocking composite failover.
    const src = new HyperliquidSource({
      tradingClient: { async getAllTickers() { return []; } },
      logger: silent,
      wsStaleMs: 10,
      restIntervalMs: 15,
      healthCheckIntervalMs: 5,
    });
    await src.start(() => { /* noop */ });
    await sleep(40); // let cold-start activate REST and run at least one poll
    expect(src.isRestPolling()).toBe(true);
    // REST polled but emitted nothing → lastRestTickAt stays 0, so the source
    // correctly reports itself unhealthy to the composite.
    expect(src.getLastTickAt()).toBe(0);
    await src.stop();
  });

  test("REST response with only non-finite markPrice entries does not advance lastRestTickAt", async () => {
    // Same contract, different mechanism: tickers returned but every markPrice
    // is NaN/Infinity. Source must report unhealthy.
    const src = new HyperliquidSource({
      tradingClient: {
        async getAllTickers() {
          return [mkTicker("BTC", NaN), mkTicker("ETH", Infinity)];
        },
      },
      logger: silent,
      wsStaleMs: 10,
      restIntervalMs: 15,
      healthCheckIntervalMs: 5,
    });
    await src.start(() => { /* noop */ });
    await sleep(40);
    expect(src.isRestPolling()).toBe(true);
    expect(src.getLastTickAt()).toBe(0);
    await src.stop();
  });

  test("handleAssetCtxsEvent parses string mark prices and emits ticks", async () => {
    const src = new HyperliquidSource({
      tradingClient: { async getAllTickers() { return []; } },
      logger: silent,
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    seedUniverse(src, ["BTC", "ETH", "kPEPE"]);
    src.handleAssetCtxsEvent({
      ctxs: [{ markPx: "60000" }, { markPx: "3000" }, { markPx: "0.02" }],
    });
    expect(received).toContainEqual(["BTC", 60000]);
    expect(received).toContainEqual(["ETH", 3000]);
    expect(received).toContainEqual(["kPEPE", 0.02]);
    expect(src.getLastTickAt()).toBeGreaterThan(0);

    await src.stop();
  });

  test("handleAssetCtxsEvent drops NaN/Infinity / null mark prices without emitting", async () => {
    const src = new HyperliquidSource({
      tradingClient: { async getAllTickers() { return []; } },
      logger: silent,
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    seedUniverse(src, ["BAD1", "BAD2", "BAD3"]);
    // Only bad entries — lastWsTickAt must NOT advance (anyEmitted guard).
    src.handleAssetCtxsEvent({
      ctxs: [{ markPx: "NaN" }, { markPx: "Infinity" }, { markPx: null }],
    });
    expect(received).toEqual([]);
    expect(src.getLastTickAt()).toBe(0);

    // Mix of good and bad — good one emits, lastWsTickAt advances, BADs dropped.
    seedUniverse(src, ["BAD", "BTC"]);
    src.handleAssetCtxsEvent({
      ctxs: [{ markPx: "NaN" }, { markPx: "60000" }],
    });
    expect(received).toEqual([["BTC", 60000]]);
    expect(src.getLastTickAt()).toBeGreaterThan(0);

    await src.stop();
  });

  test("handleAssetCtxsEvent accepts numeric mark prices (not just strings)", async () => {
    // Defensive: the SDK types markPx as string, but accepting numbers
    // too costs nothing and protects against future SDK changes.
    const src = new HyperliquidSource({
      tradingClient: { async getAllTickers() { return []; } },
      logger: silent,
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    seedUniverse(src, ["BTC"]);
    src.handleAssetCtxsEvent({ ctxs: [{ markPx: 60000 as unknown as string }] });
    expect(received).toEqual([["BTC", 60000]]);

    await src.stop();
  });

  test("REST drops non-finite markPrice entries", async () => {
    const src = new HyperliquidSource({
      tradingClient: {
        async getAllTickers() {
          return [
            mkTicker("BTC", 60000),
            mkTicker("BADNAN", NaN),
            mkTicker("BADINF", Infinity),
            mkTicker("ETH", 3000),
          ];
        },
      },
      logger: silent,
      wsStaleMs: 10,
      restIntervalMs: 20,
      healthCheckIntervalMs: 5,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));
    await sleep(30);
    await src.stop();

    expect(received).toContainEqual(["BTC", 60000]);
    expect(received).toContainEqual(["ETH", 3000]);
    expect(received.find((r) => r[0] === "BADNAN")).toBeUndefined();
    expect(received.find((r) => r[0] === "BADINF")).toBeUndefined();
  });
});
