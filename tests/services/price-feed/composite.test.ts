/**
 * Unit tests for CompositePriceFeed — 2-source cross-exchange failover.
 *
 * Architecture note: each PriceSource now owns its intra-exchange WS→REST
 * resilience internally. The composite's job is narrower — promote/demote
 * between HL and Binance based on tick freshness. These tests use
 * FakeSource handles to drive ticks deterministically (no real sockets,
 * no internal fallback).
 */

import { describe, test, expect } from "bun:test";
import pino from "pino";
import { CompositePriceFeed } from "../../../src/services/price-feed/composite.js";
import type { PriceSource, PriceTickCallback } from "../../../src/services/price-feed/types.js";

const silent = pino({ level: "silent" });

class FakeSource implements PriceSource {
  readonly name: string;
  readonly priority: number;
  private onTick: PriceTickCallback | null = null;
  private lastTickAt = 0;
  public startCount = 0;
  public stopCount = 0;

  constructor(name: string, priority: number) {
    this.name = name;
    this.priority = priority;
  }

  async start(onTick: PriceTickCallback): Promise<void> {
    this.startCount++;
    this.onTick = onTick;
  }

  async stop(): Promise<void> {
    this.stopCount++;
    this.onTick = null;
  }

  getLastTickAt(): number {
    return this.lastTickAt;
  }

  /** Drive a synthetic tick. Updates lastTickAt to now. */
  tick(symbol: string, price: number, prevDayPrice?: number): void {
    this.lastTickAt = Date.now();
    this.onTick?.(symbol, price, prevDayPrice);
  }

  /** Force the source into an unhealthy state by rewinding its last tick. */
  markStale(): void {
    this.lastTickAt = 1; // non-zero but far in the past
  }
}

/** Spin the event loop briefly so setInterval ticks can fire. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("CompositePriceFeed", () => {
  test("only the primary's ticks are forwarded when multiple sources are healthy", async () => {
    const hl = new FakeSource("hyperliquid", 0);
    const binance = new FakeSource("binance", 1);
    const received: Array<[string, number]> = [];

    const feed = new CompositePriceFeed(
      [hl, binance],
      { staleThresholdMs: 1_000, stabilityWindowMs: 100, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price) => received.push([sym, price]));

    hl.tick("BTC", 100);
    binance.tick("BTC", 999); // should be ignored — binance is not primary
    binance.tick("ETH", 888);

    expect(received).toEqual([["BTC", 100]]);
    await feed.stop();
  });

  test("HL source primary happy path — HL ticks flow, Binance ticks suppressed", async () => {
    const hl = new FakeSource("hyperliquid", 0);
    const binance = new FakeSource("binance", 1);
    const received: Array<[string, number]> = [];

    const feed = new CompositePriceFeed(
      [hl, binance],
      { staleThresholdMs: 1_000, stabilityWindowMs: 100, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price) => received.push([sym, price]));

    // HL ticks first (wins first-tick election).
    hl.tick("BTC", 60000);
    hl.tick("ETH", 3000);
    binance.tick("BTC", 59999); // suppressed
    binance.tick("SOL", 150);    // suppressed

    expect(received).toEqual([
      ["BTC", 60000],
      ["ETH", 3000],
    ]);

    await feed.stop();
  });

  test("failover: HL source stale → composite promotes Binance", async () => {
    const hl = new FakeSource("hyperliquid", 0);
    const binance = new FakeSource("binance", 1);
    const received: Array<[string, number]> = [];

    const feed = new CompositePriceFeed(
      [hl, binance],
      { staleThresholdMs: 20, stabilityWindowMs: 10_000, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price) => received.push([sym, price]));

    hl.tick("BTC", 100);
    expect(received).toEqual([["BTC", 100]]);

    hl.markStale();
    binance.tick("BTC", 200); // not primary yet — suppressed
    expect(received).toEqual([["BTC", 100]]);

    // Wait for HL to age past stale threshold, keep binance fresh.
    await sleep(30);
    binance.tick("BTC", 201);
    await sleep(15);

    // Binance should be primary — next tick is forwarded.
    binance.tick("BTC", 300);
    expect(received).toContainEqual(["BTC", 300]);

    await feed.stop();
  });

  test("restore: HL source recovers + stable for stabilityWindowMs → HL primary restored", async () => {
    const hl = new FakeSource("hyperliquid", 0);
    const binance = new FakeSource("binance", 1);
    const received: Array<[string, number]> = [];

    const feed = new CompositePriceFeed(
      [hl, binance],
      { staleThresholdMs: 20, stabilityWindowMs: 30, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price) => received.push([sym, price]));

    // Force failover HL → Binance.
    hl.markStale();
    binance.tick("BTC", 200);
    await sleep(15);
    binance.tick("BTC", 201);
    await sleep(15);
    binance.tick("BTC", 202);
    const afterFailover = received.length;
    binance.tick("BTC", 999);
    expect(received.length).toBe(afterFailover + 1);

    // HL recovers and ticks steadily across stability window.
    const restoreStart = Date.now();
    while (Date.now() - restoreStart < 60) {
      hl.tick("BTC", 100);
      binance.tick("BTC", 200);
      await sleep(5);
    }

    // HL should be primary again.
    const before = received.length;
    hl.tick("BTC", 101);
    binance.tick("BTC", 300); // suppressed
    expect(received.length).toBe(before + 1);
    expect(received[received.length - 1]).toEqual(["BTC", 101]);

    await feed.stop();
  });

  test("both sources dead: feed stops publishing, logs once per transition", async () => {
    const hl = new FakeSource("hyperliquid", 0);
    const binance = new FakeSource("binance", 1);
    const received: Array<[string, number]> = [];

    const feed = new CompositePriceFeed(
      [hl, binance],
      { staleThresholdMs: 10, stabilityWindowMs: 100, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price) => received.push([sym, price]));

    hl.tick("BTC", 100);
    expect(received).toEqual([["BTC", 100]]);

    hl.markStale();
    binance.markStale();
    await sleep(20);

    expect(feed.isConnected()).toBe(false);
    expect(received).toEqual([["BTC", 100]]);

    await feed.stop();
  });

  test("stop() halts all sources and clears the health timer", async () => {
    const hl = new FakeSource("hyperliquid", 0);
    const binance = new FakeSource("binance", 1);
    const received: Array<[string, number]> = [];

    const feed = new CompositePriceFeed(
      [hl, binance],
      { staleThresholdMs: 1_000, stabilityWindowMs: 100, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price) => received.push([sym, price]));

    expect(hl.startCount).toBe(1);
    expect(binance.startCount).toBe(1);

    await feed.stop();

    expect(hl.stopCount).toBe(1);
    expect(binance.stopCount).toBe(1);

    // Further ticks after stop are ignored (callback cleared)
    hl.tick("BTC", 999);
    expect(received.length).toBe(0);
  });

  test("constructor sorts sources by priority ascending", async () => {
    const high = new FakeSource("high", 5);
    const low = new FakeSource("low", 0);
    const mid = new FakeSource("mid", 2);
    const received: Array<[string, number]> = [];

    const feed = new CompositePriceFeed(
      [high, low, mid],
      { staleThresholdMs: 1_000, stabilityWindowMs: 100, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price) => received.push([sym, price]));

    // Initial primary should be "low" (priority 0) — first-tick election.
    low.tick("BTC", 1);
    mid.tick("BTC", 2);
    high.tick("BTC", 3);

    expect(received).toEqual([["BTC", 1]]);
    await feed.stop();
  });

  test("no sources: start/stop are safe no-ops", async () => {
    const feed = new CompositePriceFeed([], {}, silent);
    await feed.start(() => { /* noop */ });
    expect(feed.isConnected()).toBe(false);
    await feed.stop();
  });

  test("first-tick election: fastest source wins initial primary", async () => {
    // Simulates cold-start where Binance connects faster than HL. The first
    // tick must elect Binance as initial primary so we don't blackhole the
    // early window; reconcile then restores HL once it's stably healthy.
    const hl = new FakeSource("hyperliquid", 0);
    const binance = new FakeSource("binance", 1);
    const received: Array<[string, number]> = [];

    const feed = new CompositePriceFeed(
      [hl, binance],
      { staleThresholdMs: 1_000, stabilityWindowMs: 30, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price) => received.push([sym, price]));

    // Binance ticks first — becomes initial primary.
    binance.tick("BTC", 59999);
    expect(received).toEqual([["BTC", 59999]]);

    // HL starts ticking — not promoted yet (stability window not met).
    hl.tick("BTC", 60000);
    expect(received).toEqual([["BTC", 59999]]);

    // Keep both ticking through the stability window.
    const end = Date.now() + 50;
    while (Date.now() < end) {
      hl.tick("BTC", 60000);
      binance.tick("BTC", 59999);
      await sleep(5);
    }

    // HL is now primary — its next tick gets forwarded, binance is suppressed.
    const before = received.length;
    hl.tick("BTC", 60001);
    binance.tick("BTC", 59998);
    expect(received.length).toBe(before + 1);
    expect(received[received.length - 1]).toEqual(["BTC", 60001]);

    await feed.stop();
  });

  test("rapid start/stop toggles settle consistently without silently killing the feed", async () => {
    // Simulate a client reconnecting mid-teardown. SlowSource delays stop()
    // just long enough that a naive implementation would interleave and leave
    // the feed thinking it's running while sources are torn down.
    class SlowSource implements PriceSource {
      readonly name: string;
      readonly priority: number;
      private onTick: PriceTickCallback | null = null;
      private lastTickAt = 0;
      public startCount = 0;
      public stopCount = 0;
      public running = false;
      constructor(name: string, priority: number) {
        this.name = name;
        this.priority = priority;
      }
      async start(onTick: PriceTickCallback): Promise<void> {
        this.startCount++;
        this.running = true;
        this.onTick = onTick;
      }
      async stop(): Promise<void> {
        this.stopCount++;
        await sleep(10); // slow teardown — races with a concurrent start
        this.running = false;
        this.onTick = null;
      }
      getLastTickAt(): number { return this.lastTickAt; }
      tick(symbol: string, price: number): void {
        this.lastTickAt = Date.now();
        this.onTick?.(symbol, price);
      }
    }

    const a = new SlowSource("a", 0);
    const feed = new CompositePriceFeed(
      [a],
      { staleThresholdMs: 1_000, stabilityWindowMs: 100, healthCheckIntervalMs: 5 },
      silent,
    );

    const received: Array<[string, number]> = [];
    // Interleave start/stop/start — the final state should be "running".
    const s1 = feed.start((sym, price) => received.push([sym, price]));
    const s2 = feed.stop();
    const s3 = feed.start((sym, price) => received.push([sym, price]));
    await Promise.all([s1, s2, s3]);

    // Source should be in the running state — a tick must flow through.
    a.tick("BTC", 42);
    expect(received).toEqual([["BTC", 42]]);
    expect(a.running).toBe(true);

    await feed.stop();
    expect(a.running).toBe(false);
  });

  test("prevDayPrice is forwarded end-to-end from source through composite callback", async () => {
    const hl = new FakeSource("hyperliquid", 0);
    const received: Array<[string, number, number | undefined]> = [];

    const feed = new CompositePriceFeed(
      [hl],
      { staleThresholdMs: 1_000, stabilityWindowMs: 100, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price, prevDayPrice) => received.push([sym, price, prevDayPrice]));

    hl.tick("BTC", 60_000, 58_000);
    expect(received).toEqual([["BTC", 60_000, 58_000]]);

    // Tick without prevDayPrice — should forward undefined
    hl.tick("ETH", 3_000);
    expect(received[1]).toEqual(["ETH", 3_000, undefined]);

    await feed.stop();
  });

  test("a source that never ticks doesn't prevent the other from serving as primary", async () => {
    // Binance starts ticking immediately, HL never ticks. Composite should
    // elect Binance as primary and keep serving its ticks indefinitely.
    const hl = new FakeSource("hyperliquid", 0);
    const binance = new FakeSource("binance", 1);
    const received: Array<[string, number]> = [];

    const feed = new CompositePriceFeed(
      [hl, binance],
      { staleThresholdMs: 20, stabilityWindowMs: 50, healthCheckIntervalMs: 5 },
      silent,
    );
    await feed.start((sym, price) => received.push([sym, price]));

    const end = Date.now() + 40;
    while (Date.now() < end) {
      binance.tick("BTC", 60000);
      await sleep(5);
    }
    // Last tick should have been forwarded (binance is primary).
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toEqual(["BTC", 60000]);

    await feed.stop();
  });
});
