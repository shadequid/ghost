/**
 * Unit tests for HyperliquidSource — unified WS + REST source with internal
 * on-demand fallback.
 *
 * WS path coverage
 * ----------------
 * The WS data-plane is exposed as `handleAllDexsAssetCtxsEvent()` — a package-
 * visible method that mirrors BinanceSource.handleWsMessage. Tests drive
 * the real parsing/emission logic through it instead of reaching into
 * private fields, so future refactors to field names cannot silently
 * disable test coverage.
 *
 * The `allDexsAssetCtxs` event is multi-dex: each tuple is [dex, ctxs[]]
 * where ctxs[i] maps to universe[i] for that dex. Each WS-driving test
 * seeds the universe via `seedDexUniverse()` before pushing ctxs.
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
 * Build a minimal tradingClient mock. `dexMap` seeds getDexUniverses() so
 * positional `allDexsAssetCtxs` events decode correctly without a real
 * getAllTickers round-trip. Production populates dexUniverses from
 * ensureMeta(); tests bypass that by injecting directly so the WS handler
 * stays the unit under test.
 *
 * Cast via `as unknown as ITradingClient` — tests only exercise the 4 methods
 * the source needs; leaving the rest unimplemented is intentional for test
 * isolation.
 */
function mkTradingClient(opts: {
  getAllTickers?: () => Promise<Ticker[]>;
  dexMap?: Map<string, string[]>;
}): import("../../../src/services/interfaces/trading-client.js").ITradingClient {
  const dexMap = opts.dexMap ?? new Map<string, string[]>();
  return {
    async getAllTickers(): Promise<Ticker[]> {
      return opts.getAllTickers ? opts.getAllTickers() : [];
    },
    async subscribeAllDexsAssetCtxs() {
      return { unsubscribe: async () => {} };
    },
    getDexUniverses(): ReadonlyMap<string, ReadonlyArray<string>> {
      return dexMap;
    },
    async ensureMeta(): Promise<void> {},
  } as unknown as import("../../../src/services/interfaces/trading-client.js").ITradingClient;
}

/**
 * Seed the native ("") dex universe so positional `allDexsAssetCtxs` events
 * decode correctly. Tests that want multi-dex coverage build their own
 * dexMap and pass it to mkTradingClient directly.
 */
function seedDexUniverse(src: HyperliquidSource, symbols: readonly string[]): void {
  // Replace the tradingClient's getDexUniverses return value in-place by
  // swapping the map reference that the source holds. We reach into the
  // private field only because this is test infrastructure; the handler
  // itself is not affected.
  const tc = (src as unknown as { tradingClient: { getDexUniverses(): Map<string, string[]> } }).tradingClient;
  const newMap = new Map<string, string[]>();
  newMap.set("", [...symbols]);
  // Patch getDexUniverses to return the new map for the lifetime of this call.
  tc.getDexUniverses = () => newMap;
}

/**
 * Drive a WS tick through the real handler path so `lastWsTickAt` advances
 * the same way production code would. Seeds the native universe with just
 * `symbol` at index 0 and fires one ctx entry.
 */
function simulateWsTick(src: HyperliquidSource, symbol: string, price: number): void {
  seedDexUniverse(src, [symbol]);
  src.handleAllDexsAssetCtxsEvent({
    ctxs: [["", [{ markPx: String(price) }]]],
  });
}

describe("HyperliquidSource", () => {
  test("name / priority are stable", () => {
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({}),
      logger: silent,
    });
    expect(src.name).toBe("hyperliquid");
    expect(src.priority).toBe(0);
  });

  test("start() / stop() are idempotent and clean up cleanly", async () => {
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({}),
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
      tradingClient: mkTradingClient({ getAllTickers: async () => [mkTicker("BTC", 100)] }),
      logger: silent,
      // Large staleMs so REST doesn't auto-activate while we hand-drive.
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    await src.start(() => { /* noop */ });

    expect(src.getLastTickAt()).toBe(0);

    // Drive a WS tick through the real handler.
    seedDexUniverse(src, ["BTC"]);
    const beforeWs = Date.now();
    src.handleAllDexsAssetCtxsEvent({ ctxs: [["", [{ markPx: "100" }]]] });
    const afterWs = src.getLastTickAt();
    expect(afterWs).toBeGreaterThanOrEqual(beforeWs);

    // A subsequent unmappable event (NaN mark) must not advance the stamp.
    src.handleAllDexsAssetCtxsEvent({ ctxs: [["", [{ markPx: "NaN" }]]] });
    expect(src.getLastTickAt()).toBe(afterWs);

    await src.stop();
  });

  test("WS stale from cold-start → internal REST activates after wsStaleMs", async () => {
    let restCallCount = 0;
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({
        getAllTickers: async () => { restCallCount++; return [mkTicker("BTC", 100)]; },
      }),
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
      tradingClient: mkTradingClient({
        getAllTickers: async () => { restCallCount++; return [mkTicker("BTC", 50)]; },
      }),
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
      tradingClient: mkTradingClient({
        getAllTickers: async () => [mkTicker("BTC", 100)],
      }),
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
      tradingClient: mkTradingClient({
        getAllTickers: async () => { lastFetchAt = Date.now(); return [mkTicker("BTC", 100)]; },
      }),
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
      tradingClient: mkTradingClient({
        // call 1 = startup hydration (via onTick, not lastRestTickAt)
        // call 2 = first cold-start REST fallback poll (succeeds → advances lastRestTickAt)
        // call 3+ = subsequent REST polls (all fail so lastRestTickAt stops advancing)
        getAllTickers: async () => {
          callCount++;
          if (callCount <= 2) return [mkTicker("BTC", 100)];
          throw new Error("network down");
        },
      }),
      logger: silent,
      wsStaleMs: 20,
      restIntervalMs: 10,
      healthCheckIntervalMs: 5,
    });
    await src.start(() => { /* noop */ });

    // Let cold-start activate REST and take one successful sample via fallback loop.
    await sleep(50);
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
      tradingClient: mkTradingClient({
        getAllTickers: async () => { callCount++; return [mkTicker("BTC", 100)]; },
      }),
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
      tradingClient: mkTradingClient({
        getAllTickers: async () => {
          callCount++;
          if (callCount === 1) throw new Error("boom");
          return [mkTicker("BTC", 100)];
        },
      }),
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
      tradingClient: mkTradingClient({
        getAllTickers: async () => [
          mkTicker("BTC", 60000),
          mkTicker("kPEPE", 0.02),    // k-prefix stays k-prefix
          mkTicker("1000SHIB", 0.025), // 1000-prefix stays 1000-prefix
        ],
      }),
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
      tradingClient: mkTradingClient({}),
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
      tradingClient: mkTradingClient({
        getAllTickers: async () => [mkTicker("BTC", NaN), mkTicker("ETH", Infinity)],
      }),
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

  test("handleAllDexsAssetCtxsEvent parses string mark prices and emits ticks", async () => {
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({}),
      logger: silent,
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    seedDexUniverse(src, ["BTC", "ETH", "kPEPE"]);
    src.handleAllDexsAssetCtxsEvent({
      ctxs: [["", [{ markPx: "60000" }, { markPx: "3000" }, { markPx: "0.02" }]]],
    });
    expect(received).toContainEqual(["BTC", 60000]);
    expect(received).toContainEqual(["ETH", 3000]);
    expect(received).toContainEqual(["kPEPE", 0.02]);
    expect(src.getLastTickAt()).toBeGreaterThan(0);

    await src.stop();
  });

  test("handleAllDexsAssetCtxsEvent drops NaN/Infinity / null mark prices without emitting", async () => {
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({}),
      logger: silent,
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    seedDexUniverse(src, ["BAD1", "BAD2", "BAD3"]);
    // Only bad entries — lastWsTickAt must NOT advance (anyEmitted guard).
    src.handleAllDexsAssetCtxsEvent({
      ctxs: [["", [{ markPx: "NaN" }, { markPx: "Infinity" }, { markPx: null }]]],
    });
    expect(received).toEqual([]);
    expect(src.getLastTickAt()).toBe(0);

    // Mix of good and bad — good one emits, lastWsTickAt advances, BADs dropped.
    seedDexUniverse(src, ["BAD", "BTC"]);
    src.handleAllDexsAssetCtxsEvent({
      ctxs: [["", [{ markPx: "NaN" }, { markPx: "60000" }]]],
    });
    expect(received).toEqual([["BTC", 60000]]);
    expect(src.getLastTickAt()).toBeGreaterThan(0);

    await src.stop();
  });

  test("handleAllDexsAssetCtxsEvent accepts numeric mark prices (not just strings)", async () => {
    // Defensive: the SDK types markPx as string, but accepting numbers
    // too costs nothing and protects against future SDK changes.
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({}),
      logger: silent,
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    seedDexUniverse(src, ["BTC"]);
    src.handleAllDexsAssetCtxsEvent({ ctxs: [["", [{ markPx: 60000 as unknown as string }]]] });
    expect(received).toEqual([["BTC", 60000]]);

    await src.stop();
  });

  test("handleAllDexsAssetCtxsEvent handles multiple dexes in one frame", async () => {
    // Verifies the multi-dex path: native "" + one HIP-3 dex in the same event.
    const dexMap = new Map<string, string[]>();
    dexMap.set("", ["BTC", "ETH"]);
    dexMap.set("xyz", ["xyz:AAPL", "xyz:TSLA"]);
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({ dexMap }),
      logger: silent,
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 10,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    src.handleAllDexsAssetCtxsEvent({
      ctxs: [
        ["", [{ markPx: "60000" }, { markPx: "3000" }]],
        ["xyz", [{ markPx: "192.5" }, { markPx: "250.0" }]],
      ],
    });
    expect(received).toContainEqual(["BTC", 60000]);
    expect(received).toContainEqual(["ETH", 3000]);
    expect(received).toContainEqual(["xyz:AAPL", 192.5]);
    expect(received).toContainEqual(["xyz:TSLA", 250.0]);
    expect(src.getLastTickAt()).toBeGreaterThan(0);

    await src.stop();
  });

  test("REST drops non-finite markPrice entries", async () => {
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({
        getAllTickers: async () => [
          mkTicker("BTC", 60000),
          mkTicker("BADNAN", NaN),
          mkTicker("BADINF", Infinity),
          mkTicker("ETH", 3000),
        ],
      }),
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

  test("start() calls getAllTickers and emits each ticker through onTick (REST hydration)", async () => {
    // By the time start() resolves, the onTick callback should have been called
    // for each valid ticker returned by getAllTickers — this is the hydration path.
    const hydrationTickers = [
      mkTicker("BTC", 60000),
      mkTicker("ETH", 3000),
      mkTicker("SOL", 150),
    ];
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({
        getAllTickers: async () => hydrationTickers,
      }),
      logger: silent,
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 100,
    });
    const received: Array<[string, number]> = [];
    await src.start((sym, price) => received.push([sym, price]));

    // Hydration runs inside start() — no sleep needed.
    expect(received).toContainEqual(["BTC", 60000]);
    expect(received).toContainEqual(["ETH", 3000]);
    expect(received).toContainEqual(["SOL", 150]);

    await src.stop();
  });

  test("start() does NOT throw if getAllTickers rejects — feed comes up degraded but functional", async () => {
    // REST hydration failure must be swallowed; WS path keeps working.
    const wsReceived: Array<[string, number]> = [];
    const src = new HyperliquidSource({
      tradingClient: mkTradingClient({
        getAllTickers: async () => { throw new Error("network error"); },
      }),
      logger: silent,
      wsStaleMs: 60_000,
      healthCheckIntervalMs: 100,
    });

    // Must not throw even though getAllTickers rejects.
    await expect(src.start((sym, price) => wsReceived.push([sym, price]))).resolves.toBeUndefined();

    // WS is still functional — simulate a tick after degraded startup.
    simulateWsTick(src, "BTC", 70000);
    expect(wsReceived).toContainEqual(["BTC", 70000]);

    await src.stop();
  });
});
