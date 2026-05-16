import { describe, expect, test } from "bun:test";
import { filterPassesLlm } from "../../src/observer/loop.js";
import type { ObserverEvent } from "../../src/observer/events.js";
import type { ObserverSnapshot } from "../../src/observer/state-store.js";

function snapshot(overrides: Partial<ObserverSnapshot> = {}): ObserverSnapshot {
  return {
    positions: {},
    lastFillTimestamp: 0,
    openOrderIds: [],
    lastRestSyncAtMs: 0,
    recentCancelOids: [], recentEmittedFillIds: [],
    ...overrides,
  };
}

const pnlEvent = (): ObserverEvent => ({
  type: "pnl_snapshot",
  detectedAt: Date.now(),
  symbol: "BTC",
  side: "long",
  size: 0.1,
  entryPrice: 70_000,
  markPrice: 70_500,
  priceMovePct: 0.7,
  unrealizedPnl: 50,
  unrealizedPnlPct: 7,
  margin: 700,
  leverage: 10,
  holdDurationMs: 60_000,
  peakPnl: 50,
  troughPnl: 0,
});

describe("filterPassesLlm", () => {
  test("empty events + unchanged orders → skip", () => {
    expect(filterPassesLlm([], snapshot(), [])).toBe(false);
  });

  test("only pnl_snapshot + unchanged orders → skip (cost guard)", () => {
    expect(filterPassesLlm([pnlEvent()], snapshot(), [])).toBe(false);
  });

  test("any non-snapshot event → pass", () => {
    const tpEvent: ObserverEvent = {
      type: "tp_hit",
      detectedAt: Date.now(),
      symbol: "BTC",
      side: "long",
      size: 0.1,
      exitPrice: 72_000,
      realizedPnl: 100,
      fillId: "f1",
    };
    expect(filterPassesLlm([tpEvent, pnlEvent()], snapshot(), [])).toBe(true);
  });

  test("new open order appears → pass even with no events", () => {
    expect(filterPassesLlm([], snapshot({ openOrderIds: [] }), ["o1"])).toBe(true);
  });

  test("open order disappears → pass (cancel detection)", () => {
    expect(filterPassesLlm([], snapshot({ openOrderIds: ["o1"] }), [])).toBe(true);
  });

  test("same open orders + pnl_snapshot only → skip", () => {
    expect(filterPassesLlm([pnlEvent()], snapshot({ openOrderIds: ["o1"] }), ["o1"])).toBe(false);
  });
});
