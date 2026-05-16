/**
 * Snapshot fetcher — pulls positions, open orders, and recent fills from the
 * trading client for one observer tick.
 *
 * Load distribution
 * -----------------
 * Calls are deliberately SEQUENTIAL with a small inter-call gap. Reasons:
 *
 *   - Each tick fires three HTTP calls against the HL info endpoint. Running
 *     them via `Promise.all` is faster wall-clock but spikes 3 concurrent
 *     connections every 60s — easy to rate-limit or to compete with the
 *     gateway's own market-data fetches.
 *   - Sequential keeps total work ~1.5s but distributes it across the tick.
 *     The 58s remaining is more than enough headroom.
 *
 * Price reuse
 * -----------
 * The observer does NOT call `getAllTickers` or `getTicker`. Two reasons:
 *
 *   1. HL's `clearinghouseState` (consumed by `getPositions`) embeds the
 *      `markPrice`, `liquidationPrice`, and `unrealizedPnl` for every open
 *      position. No separate ticker fetch is needed.
 *   2. The gateway-owned `CompositePriceFeed` already streams socket prices
 *      into `PriceCache`. If the judge skill ever needs a fresh tick for a
 *      non-position symbol (watchlist, news subject), the cache is the right
 *      source — not a synchronous REST call.
 *
 * Fills are fetched incrementally from `lastFillTimestamp + 1`. The +1 avoids
 * re-emitting the same fill twice when two fills share a timestamp.
 */

import type { ITradingClient } from "../services/interfaces/trading-client.js";
import type { Fill, OpenOrder, OrderRecord, Position } from "../services/interfaces/trading-types.js";

export interface SnapshotInput {
  positions: Position[];
  openOrders: OpenOrder[];
  newFills: Fill[];
  /**
   * Historical orders observed since the prior tick. Drives `OrderCanceledEvent`
   * for order cancellations the fill list does not surface. Filtered to
   * exclude engine-driven `scheduledCancel` rows upstream (in `diff.ts`).
   */
  newHistoricalOrders: OrderRecord[];
  /** Latest fill timestamp observed in this tick — caller persists this for next tick. */
  latestFillTimestamp: number;
}

/** Small inter-call gap. Keeps three HL info-endpoint fetches from spiking
 *  concurrent connections every tick. Tunable; 150ms is well within budget. */
const STAGGER_MS = 150;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch one tick of state. Throws on any upstream failure — the loop catches
 * and skips the tick rather than mutating state on partial reads.
 */
export async function fetchSnapshot(
  client: ITradingClient,
  lastFillTimestamp: number,
): Promise<SnapshotInput> {
  const positions = await client.getPositions();
  await delay(STAGGER_MS);

  const openOrders = await client.getOpenOrders();
  await delay(STAGGER_MS);

  // HL `userFillsByTime` is inclusive on startTime — bump by 1ms so we
  // don't re-classify the same fill across ticks.
  const fillSince = lastFillTimestamp > 0 ? lastFillTimestamp + 1 : Date.now() - 60_000;
  const newFills = await client.getFillsByTime(undefined, fillSince);
  await delay(STAGGER_MS);

  // Historical orders since the same anchor. Captures cancellations that the
  // fill list does not surface (HL only emits fills for executions; cancels
  // never produce a fill row).
  const newHistoricalOrders = await client.getHistoricalOrders(undefined, fillSince);

  let latest = lastFillTimestamp;
  for (const f of newFills) {
    if (f.timestamp > latest) latest = f.timestamp;
  }

  return { positions, openOrders, newFills, newHistoricalOrders, latestFillTimestamp: latest };
}
