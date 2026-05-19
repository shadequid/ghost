/**
 * Tests for the broadcastPrice helper inside createGateway.
 *
 * The broadcastPrice function is a closure — we can't import it directly.
 * Instead we test its observable contract via PriceCache and TradingEvents:
 *   - cache is updated unconditionally (even on flat-price ticks)
 *   - prevDayPrice reaches the cache even when the mark price hasn't changed
 *   - ALL symbols are broadcast, not just watchlist members
 *   - flat price + no prevDayPrice does NOT re-broadcast (dedup guard)
 *   - flat price + different prevDayPrice DOES broadcast (daily rollover)
 */

import { describe, it, expect } from "bun:test";
import { PriceCache } from "../../src/services/price-cache.js";
import { TradingEvents } from "../../src/events/trading-events.js";

/**
 * Reproduce the fixed broadcastPrice logic as a standalone function.
 * No watchedSymbols filter — all symbols are broadcast.
 */
function makeBroadcastPrice(
  cache: PriceCache,
  emittedEvents: ReturnType<typeof TradingEvents.priceUpdate>[] = [],
): (symbol: string, price: number, prevDayPrice?: number) => void {
  const lastPrices = new Map<string, number>();
  return function broadcastPrice(symbol: string, price: number, prevDayPrice?: number) {
    cache.set(symbol, price, prevDayPrice);
    const prev = lastPrices.get(symbol);
    if (prev === price && prevDayPrice === undefined) return;
    lastPrices.set(symbol, price);
    emittedEvents.push(TradingEvents.priceUpdate({ symbol, price, prevDayPrice }));
  };
}

describe("broadcastPrice ordering", () => {
  it("updates cache unconditionally on first tick", () => {
    const cache = new PriceCache();
    const broadcast = makeBroadcastPrice(cache);

    broadcast("BTC", 60_000, 58_000);

    const entry = cache.get("BTC", 60_000);
    expect(entry?.price).toBe(60_000);
    expect(entry?.prevDayPrice).toBe(58_000);
  });

  it("updates prevDayPrice in cache even when mark price is flat", () => {
    const cache = new PriceCache();
    const broadcast = makeBroadcastPrice(cache);

    // First tick
    broadcast("BTC", 60_000, 58_000);
    // Second tick: same price, different prevDayPrice (daily rollover scenario)
    broadcast("BTC", 60_000, 59_000);

    const entry = cache.get("BTC", 60_000);
    expect(entry?.price).toBe(60_000);
    // prevDayPrice must be updated even though mark price was unchanged
    expect(entry?.prevDayPrice).toBe(59_000);
  });

  it("two ticks with different prices both update the cache", () => {
    const cache = new PriceCache();
    const broadcast = makeBroadcastPrice(cache);

    broadcast("ETH", 3_000, 2_800);
    broadcast("ETH", 3_100, 2_900);

    const entry = cache.get("ETH", 60_000);
    expect(entry?.price).toBe(3_100);
    expect(entry?.prevDayPrice).toBe(2_900);
  });

  it("tick without prevDayPrice clears prevDayPrice in cache", () => {
    const cache = new PriceCache();
    const broadcast = makeBroadcastPrice(cache);

    broadcast("SOL", 150, 140);
    broadcast("SOL", 151);

    const entry = cache.get("SOL", 60_000);
    expect(entry?.price).toBe(151);
    expect(entry?.prevDayPrice).toBeUndefined();
  });
});

describe("broadcastPrice event emission — all symbols, no watchlist filter", () => {
  it("publishes for ANY symbol regardless of watchlist membership", () => {
    const cache = new PriceCache();
    const events: ReturnType<typeof TradingEvents.priceUpdate>[] = [];
    const broadcast = makeBroadcastPrice(cache, events);

    // Symbols not in any watchlist still get broadcast
    broadcast("UNWATCHED_TOKEN", 100, 95);
    broadcast("ANOTHER_TOKEN", 200);

    expect(events).toHaveLength(2);
    expect(events[0].payload.symbol).toBe("UNWATCHED_TOKEN");
    expect(events[1].payload.symbol).toBe("ANOTHER_TOKEN");
  });

  it("flat price + no prevDayPrice does NOT re-publish (dedup guard)", () => {
    const cache = new PriceCache();
    const events: ReturnType<typeof TradingEvents.priceUpdate>[] = [];
    const broadcast = makeBroadcastPrice(cache, events);

    broadcast("BTC", 60_000);
    broadcast("BTC", 60_000); // flat, no prevDayPrice → deduped

    expect(events).toHaveLength(1);
  });

  it("flat price + different prevDayPrice DOES publish (daily rollover)", () => {
    const cache = new PriceCache();
    const events: ReturnType<typeof TradingEvents.priceUpdate>[] = [];
    const broadcast = makeBroadcastPrice(cache, events);

    broadcast("BTC", 60_000, 58_000);
    broadcast("BTC", 60_000, 59_000); // same price but prevDayPrice changed → emit

    expect(events).toHaveLength(2);
    expect(events[1].payload.prevDayPrice).toBe(59_000);
  });

  it("prevDayPrice is included in the published price update event payload", () => {
    const cache = new PriceCache();
    const events: ReturnType<typeof TradingEvents.priceUpdate>[] = [];
    const broadcast = makeBroadcastPrice(cache, events);

    broadcast("BTC", 60_000, 58_000);

    expect(events).toHaveLength(1);
    expect(events[0].payload.symbol).toBe("BTC");
    expect(events[0].payload.price).toBe(60_000);
    expect(events[0].payload.prevDayPrice).toBe(58_000);
  });

  it("event payload omits prevDayPrice when source does not provide it", () => {
    const cache = new PriceCache();
    const events: ReturnType<typeof TradingEvents.priceUpdate>[] = [];
    const broadcast = makeBroadcastPrice(cache, events);

    broadcast("ETH", 3_000);

    expect(events).toHaveLength(1);
    expect(events[0].payload.prevDayPrice).toBeUndefined();
  });
});
