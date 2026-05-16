import { describe, expect, test } from "bun:test";
import { diffSnapshot, liquidationProgress } from "../../src/observer/diff.js";
import {
  filterPnlSnapshots,
  MIN_PNL_PCT_DELTA,
  MIN_PRICE_PCT_DELTA,
  MIN_COOLDOWN_MS,
} from "../../src/observer/loop.js";
import type { ObserverSnapshot, PositionSnapshot } from "../../src/observer/state-store.js";
import type { ObserverEvent } from "../../src/observer/events.js";
import type { Fill, Position } from "../../src/services/interfaces/trading-types.js";

function emptySnapshot(): ObserverSnapshot {
  return {
    positions: {},
    lastFillTimestamp: 0,
    openOrderIds: [],
    lastRestSyncAtMs: 0,
    recentCancelOids: [],
    recentEmittedFillIds: [],
  };
}

function pos(overrides: Partial<Position> = {}): Position {
  return {
    symbol: "BTC",
    side: "long",
    size: 0.1,
    entryPrice: 70_000,
    markPrice: 70_500,
    liquidationPrice: 60_000,
    unrealizedPnl: 50,
    unrealizedPnlPct: 5,
    leverage: 10,
    marginMode: "cross",
    margin: 700,
    ...overrides,
  };
}

function priorPos(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    symbol: "BTC",
    side: "long",
    size: 0.1,
    entryPrice: 70_000,
    markPrice: 70_000,
    liquidationPrice: 60_000,
    unrealizedPnl: 0,
    margin: 700,
    leverage: 10,
    openedAtMs: 1_700_000_000_000,
    peakPnl: 0,
    troughPnl: 0,
    liqRiskFired: false,
    lastFiredPnl: null,
    lastFiredPnlPct: null,
    lastFiredMarkPrice: null,
    lastFiredAtMs: null,
    ...overrides,
  };
}

function fill(overrides: Partial<Fill> = {}): Fill {
  return {
    tradeId: "1",
    symbol: "BTC",
    side: "buy",
    price: 70_000,
    size: 0.1,
    fee: 0.5,
    feeToken: "USDC",
    realizedPnl: 0,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("liquidationProgress", () => {
  test("returns null when liq is missing", () => {
    expect(liquidationProgress(70_000, 71_000, null)).toBeNull();
  });
  test("returns null when liq == entry (degenerate)", () => {
    expect(liquidationProgress(70_000, 71_000, 70_000)).toBeNull();
  });
  test("long position: mark midway between entry and liq → 0.5", () => {
    // entry 70k, liq 60k → 10k range. Mark 65k → 5k from entry → 0.5
    expect(liquidationProgress(70_000, 65_000, 60_000)).toBeCloseTo(0.5);
  });
  test("long position: mark at 80% → 0.8", () => {
    expect(liquidationProgress(70_000, 62_000, 60_000)).toBeCloseTo(0.8);
  });
  test("short position: mark moved up toward liq", () => {
    // entry 70k, liq 80k → 10k range. Mark 78k → 8k from entry → 0.8
    expect(liquidationProgress(70_000, 78_000, 80_000)).toBeCloseTo(0.8);
  });
  test("leverage-agnostic: low leverage same progress fires same", () => {
    // Different leverage, same entry/liq/mark → same progress
    const a = liquidationProgress(70_000, 62_000, 60_000);
    const b = liquidationProgress(70_000, 62_000, 60_000);
    expect(a).toBe(b);
  });
});

describe("diffSnapshot — pnl_snapshot emission", () => {
  test("every open position emits one pnl_snapshot per tick", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [pos(), pos({ symbol: "ETH", entryPrice: 3000, markPrice: 3100, liquidationPrice: 2500 })],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const snaps = result.events.filter((e) => e.type === "pnl_snapshot");
    expect(snaps.length).toBe(2);
  });

  test("no positions → no pnl_snapshot events", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.length).toBe(0);
  });

  test("peakPnl / troughPnl carry forward from prior snapshot", () => {
    const result = diffSnapshot({
      prior: {
        positions: { "BTC|long": priorPos({ peakPnl: 200, troughPnl: -50 }) },
        lastFillTimestamp: 0,
        openOrderIds: [],
        lastRestSyncAtMs: 0,
        recentCancelOids: [],
        recentEmittedFillIds: [],
      },
      positions: [pos({ unrealizedPnl: 100 })],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_120_000,
    });
    const snap = result.events.find((e) => e.type === "pnl_snapshot");
    if (snap?.type !== "pnl_snapshot") throw new Error("expected pnl_snapshot");
    expect(snap.peakPnl).toBe(200);    // unchanged because current (100) < peak
    expect(snap.troughPnl).toBe(-50);  // unchanged because current (100) > trough
  });
});

describe("diffSnapshot — liquidation_risk", () => {
  test("does NOT fire when freshly opened at safe price", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [pos({ markPrice: 70_500 })], // progress ~ 0.05
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.find((e) => e.type === "liquidation_risk")).toBeUndefined();
  });

  test("fires when mark crosses 80% progress, regardless of leverage", () => {
    // Same entry/liq/mark, different leverage. Both must fire.
    const r10x = diffSnapshot({
      prior: emptySnapshot(),
      positions: [pos({ markPrice: 62_000, leverage: 10 })],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const r50x = diffSnapshot({
      prior: emptySnapshot(),
      positions: [pos({ markPrice: 62_000, leverage: 50 })],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(r10x.events.some((e) => e.type === "liquidation_risk")).toBe(true);
    expect(r50x.events.some((e) => e.type === "liquidation_risk")).toBe(true);
  });

  test("anti-spam: doesn't refire when liqRiskFired flag set", () => {
    const result = diffSnapshot({
      prior: {
        positions: { "BTC|long": priorPos({ liqRiskFired: true }) },
        lastFillTimestamp: 0,
        openOrderIds: [],
        lastRestSyncAtMs: 0,
        recentCancelOids: [],
        recentEmittedFillIds: [],
      },
      positions: [pos({ markPrice: 61_000 })], // still in danger zone
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.find((e) => e.type === "liquidation_risk")).toBeUndefined();
  });

  test("flag persists in nextPositions after fire", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [pos({ markPrice: 62_000 })],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.nextPositions["BTC|long"]?.liqRiskFired).toBe(true);
  });
});

describe("diffSnapshot — fill classification", () => {
  test("liquidation flag → position_liquidated event", () => {
    const result = diffSnapshot({
      prior: {
        positions: { "BTC|long": priorPos({ openedAtMs: 1_699_999_000_000 }) },
        lastFillTimestamp: 0,
        openOrderIds: [],
        lastRestSyncAtMs: 0,
        recentCancelOids: [],
        recentEmittedFillIds: [],
      },
      positions: [], // position gone
      openOrders: [],
      newFills: [
        fill({
          tradeId: "liq-1",
          side: "sell",
          dir: "Liquidated Cross Long",
          liquidation: true,
          realizedPnl: -500,
          price: 60_000,
        }),
      ],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const ev = result.events.find((e) => e.type === "position_liquidated");
    expect(ev).toBeDefined();
    if (ev?.type !== "position_liquidated") throw new Error("expected position_liquidated");
    expect(ev.side).toBe("long");
    expect(ev.realizedPnl).toBe(-500);
    expect(ev.fillId).toBe("liq-1");
  });

  test("dir 'Close Long Tp' → tp_hit event", () => {
    const result = diffSnapshot({
      prior: {
        positions: { "BTC|long": priorPos() },
        lastFillTimestamp: 0,
        openOrderIds: [],
        lastRestSyncAtMs: 0,
        recentCancelOids: [],
        recentEmittedFillIds: [],
      },
      positions: [],
      openOrders: [],
      newFills: [
        fill({ tradeId: "tp-1", side: "sell", dir: "Close Long Tp", realizedPnl: 120, price: 72_000 }),
      ],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.some((e) => e.type === "tp_hit")).toBe(true);
  });

  test("dir 'Close Short Sl' → sl_hit event with correct side", () => {
    const result = diffSnapshot({
      prior: {
        positions: { "BTC|short": priorPos({ side: "short" }) },
        lastFillTimestamp: 0,
        openOrderIds: [],
        lastRestSyncAtMs: 0,
        recentCancelOids: [],
        recentEmittedFillIds: [],
      },
      positions: [],
      openOrders: [],
      newFills: [
        fill({ tradeId: "sl-1", side: "buy", dir: "Close Short Sl", realizedPnl: -80, price: 71_000 }),
      ],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const ev = result.events.find((e) => e.type === "sl_hit");
    expect(ev).toBeDefined();
    if (ev?.type !== "sl_hit") throw new Error("expected sl_hit");
    expect(ev.side).toBe("short");
  });

  test("dir 'Open Long' → order_filled", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [pos()],
      openOrders: [],
      newFills: [fill({ tradeId: "open-1", side: "buy", dir: "Open Long", price: 70_000 })],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.some((e) => e.type === "order_filled")).toBe(true);
  });

  test("user-initiated close → position_closed with realized PnL pct from prior margin", () => {
    const result = diffSnapshot({
      prior: {
        positions: { "BTC|long": priorPos({ margin: 700, openedAtMs: 1_699_999_000_000 }) },
        lastFillTimestamp: 0,
        openOrderIds: [],
        lastRestSyncAtMs: 0,
        recentCancelOids: [],
        recentEmittedFillIds: [],
      },
      positions: [],
      openOrders: [],
      newFills: [
        fill({ tradeId: "close-1", side: "sell", dir: "Close Long", realizedPnl: 140, price: 71_500 }),
      ],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const ev = result.events.find((e) => e.type === "position_closed");
    expect(ev).toBeDefined();
    if (ev?.type !== "position_closed") throw new Error("expected position_closed");
    expect(ev.realizedPnl).toBe(140);
    expect(ev.realizedPnlPct).toBeCloseTo((140 / 700) * 100);
    expect(ev.holdDurationMs).toBe(1_700_000_060_000 - 1_699_999_000_000);
  });

  test("fallback close detection: position disappeared without classified fill", () => {
    const result = diffSnapshot({
      prior: {
        positions: { "ETH|long": priorPos({ symbol: "ETH", unrealizedPnl: 50 }) },
        lastFillTimestamp: 0,
        openOrderIds: [],
        lastRestSyncAtMs: 0,
        recentCancelOids: [],
        recentEmittedFillIds: [],
      },
      positions: [], // gone
      openOrders: [],
      newFills: [], // no matching fill (HL race / fills lag)
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const ev = result.events.find((e) => e.type === "position_closed");
    expect(ev).toBeDefined();
    if (ev?.type !== "position_closed") throw new Error("expected position_closed");
    expect(ev.symbol).toBe("ETH");
    expect(ev.fillId).toStartWith("synthetic:");
  });
});

describe("diffSnapshot — fill dedup (between REST syncs)", () => {
  // Reproduces the observed bug: cachedRest holds the same `newFills` for 12
  // eval ticks per 60s sync window. Without dedup, every tick re-emits the
  // same `order_filled` (and `tp_hit` / `sl_hit` / `position_closed` /
  // `position_liquidated`) and the filter passes → wasted LLM calls.

  test("same tradeId across ticks: emits once, then skipped via recentEmittedFillIds", () => {
    const fillA = fill({ tradeId: "T-1", dir: "Open Long" });

    const t1 = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [fillA],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(t1.events.filter((e) => e.type === "order_filled").length).toBe(1);
    expect(t1.emittedFillIds).toEqual(["T-1"]);

    // Tick 2: same cached fill array, prior now carries T-1 in the dedup
    // window. Detector skips it entirely — no event, filter sees only
    // pnl_snapshots (or nothing) and skips the LLM.
    const t2 = diffSnapshot({
      prior: { ...emptySnapshot(), recentEmittedFillIds: ["T-1"] },
      positions: [],
      openOrders: [],
      newFills: [fillA],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_120_000,
    });
    expect(t2.events.find((e) => e.type === "order_filled")).toBeUndefined();
    expect(t2.emittedFillIds).toEqual([]);
  });

  test("position_closed from a close fill: dedup window prevents re-emit next tick", () => {
    // Same scenario the user hit on the web: close BTC, then 10 ticks of
    // cached fills re-firing the judge.
    const closeFill = fill({
      tradeId: "C-1",
      side: "sell",
      dir: "Close Long",
      realizedPnl: -12,
    });
    const t1 = diffSnapshot({
      prior: {
        ...emptySnapshot(),
        positions: { "BTC|long": priorPos() },
      },
      positions: [], // closed → not in current snapshot
      openOrders: [],
      newFills: [closeFill],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(t1.events.filter((e) => e.type === "position_closed").length).toBe(1);
    expect(t1.emittedFillIds).toEqual(["C-1"]);

    const t2 = diffSnapshot({
      prior: { ...emptySnapshot(), recentEmittedFillIds: ["C-1"] },
      positions: [],
      openOrders: [],
      newFills: [closeFill],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_120_000,
    });
    expect(t2.events.find((e) => e.type === "position_closed")).toBeUndefined();
    expect(t2.emittedFillIds).toEqual([]);
  });

  test("duplicate tradeId within the same tick is emitted only once", () => {
    const f = fill({ tradeId: "DUP-F", dir: "Open Long" });
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [f, f],
      newHistoricalOrders: [],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.filter((e) => e.type === "order_filled").length).toBe(1);
    expect(result.emittedFillIds).toEqual(["DUP-F"]);
  });
});

describe("diffSnapshot — order cancellations", () => {
  const baseOrder = {
    oid: "100",
    cloid: null as string | null,
    symbol: "BTC",
    side: "buy" as const,
    price: 70_000,
    triggerPrice: null as number | null,
    size: 0.1,
    reduceOnly: false,
    timestamp: 1_700_000_055_000,
  };

  test("user-initiated cancel → OrderCanceledEvent reason='user'", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [{ ...baseOrder, status: "canceled" }],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const ev = result.events.find((e) => e.type === "order_canceled");
    expect(ev).toBeDefined();
    if (ev?.type !== "order_canceled") throw new Error("expected order_canceled");
    expect(ev.reason).toBe("user");
    expect(ev.orderId).toBe("100");
  });

  test("marginCanceled → reason='margin'", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [{ ...baseOrder, oid: "101", status: "marginCanceled" }],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const ev = result.events.find((e) => e.type === "order_canceled");
    if (ev?.type !== "order_canceled") throw new Error("expected order_canceled");
    expect(ev.reason).toBe("margin");
  });

  test("liquidatedCanceled → reason='liquidation'", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [{ ...baseOrder, oid: "102", status: "liquidatedCanceled" }],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const ev = result.events.find((e) => e.type === "order_canceled");
    if (ev?.type !== "order_canceled") throw new Error("expected order_canceled");
    expect(ev.reason).toBe("liquidation");
  });

  test("filled / open / triggered statuses do NOT emit order_canceled", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [
        { ...baseOrder, oid: "200", status: "filled" },
        { ...baseOrder, oid: "201", status: "open" },
        { ...baseOrder, oid: "202", status: "triggered" },
      ],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.find((e) => e.type === "order_canceled")).toBeUndefined();
  });

  test("scheduledCancel (HL housekeeping) is filtered out", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [{ ...baseOrder, oid: "300", status: "scheduledCancel" }],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.find((e) => e.type === "order_canceled")).toBeUndefined();
  });

  test("cancel oid is reported in emittedCancelOids and dedups across ticks", () => {
    // Tick 1: the cancel surfaces fresh.
    const t1 = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [{ ...baseOrder, oid: "DEDUP-1", status: "canceled" }],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(t1.events.filter((e) => e.type === "order_canceled").length).toBe(1);
    expect(t1.emittedCancelOids).toEqual(["DEDUP-1"]);

    // Tick 2: HL still returns the same canceled row (lastFillTimestamp didn't
    // advance because no new fill arrived). Without dedup, this would re-emit
    // every sync and re-hammer the judge LLM.
    const t2 = diffSnapshot({
      prior: { ...emptySnapshot(), recentCancelOids: ["DEDUP-1"] },
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [{ ...baseOrder, oid: "DEDUP-1", status: "canceled" }],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_120_000,
    });
    expect(t2.events.find((e) => e.type === "order_canceled")).toBeUndefined();
    expect(t2.emittedCancelOids).toEqual([]);
  });

  test("duplicate oid within the same tick is emitted only once", () => {
    // HL pagination occasionally returns the same row twice; protect the
    // detector from that without relying on server-side uniqueness.
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [
        { ...baseOrder, oid: "DUP-1", status: "canceled" },
        { ...baseOrder, oid: "DUP-1", status: "canceled" },
      ],
      alertRules: [],
      prices: new Map(),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.filter((e) => e.type === "order_canceled").length).toBe(1);
    expect(result.emittedCancelOids).toEqual(["DUP-1"]);
  });
});

describe("diffSnapshot — price_alert (crossing detection)", () => {
  test("emits PriceAlertEvent + firedAlertIds when an active above-rule crosses", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [
        {
          id: "a1",
          symbol: "BTC",
          condition: "above",
          price: 70_000,
          createdAt: new Date().toISOString(),
        },
      ],
      prices: new Map([["BTC", 70_500]]),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    const ev = result.events.find((e) => e.type === "price_alert");
    expect(ev).toBeDefined();
    if (ev?.type !== "price_alert") throw new Error("expected price_alert");
    expect(ev.alertId).toBe("a1");
    expect(ev.condition).toBe("above");
    expect(ev.currentPrice).toBe(70_500);
    expect(result.firedAlertIds).toEqual(["a1"]);
  });

  test("active rule that has NOT crossed emits no event", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [
        {
          id: "a1",
          symbol: "BTC",
          condition: "above",
          price: 70_000,
          createdAt: new Date().toISOString(),
        },
      ],
      prices: new Map([["BTC", 69_000]]),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.find((e) => e.type === "price_alert")).toBeUndefined();
    expect(result.firedAlertIds).toEqual([]);
  });

  test("already-fired rule is ignored", () => {
    const result = diffSnapshot({
      prior: emptySnapshot(),
      positions: [],
      openOrders: [],
      newFills: [],
      newHistoricalOrders: [],
      alertRules: [
        {
          id: "a1",
          symbol: "BTC",
          condition: "above",
          price: 70_000,
          createdAt: new Date().toISOString(),
          firedAt: new Date().toISOString(),
        },
      ],
      prices: new Map([["BTC", 80_000]]),
      liqProgressThreshold: 0.8,
      nowMs: 1_700_000_060_000,
    });
    expect(result.events.find((e) => e.type === "price_alert")).toBeUndefined();
    expect(result.firedAlertIds).toEqual([]);
  });
});

describe("filterPnlSnapshots — per-position pnl rate-limit", () => {
  // The detector emits pnl_snapshot every tick. This filter sits between
  // diff and judge to drop near-identical PnL updates on the same
  // position. Test the four threshold branches: pass-through (no prior
  // fire), drop (all-below), pass (any-above), and per-axis pass.

  const NOW = 1_700_000_000_000;

  function pnlEvent(overrides: Partial<{ symbol: string; side: "long" | "short"; unrealizedPnl: number; unrealizedPnlPct: number; markPrice: number }> = {}): ObserverEvent {
    return {
      type: "pnl_snapshot",
      detectedAt: NOW,
      symbol: overrides.symbol ?? "BTC",
      side: overrides.side ?? "long",
      size: 0.1,
      entryPrice: 70_000,
      markPrice: overrides.markPrice ?? 70_500,
      priceMovePct: 0,
      unrealizedPnl: overrides.unrealizedPnl ?? 50,
      unrealizedPnlPct: overrides.unrealizedPnlPct ?? 7,
      margin: 700,
      leverage: 10,
      holdDurationMs: 0,
      peakPnl: 100,
      troughPnl: -10,
    };
  }

  test("no prior fired (lastFired* all null) → pnl_snapshot passes through unfiltered", () => {
    const positions: Record<string, PositionSnapshot> = {
      "BTC|long": priorPos({ lastFiredPnl: null, lastFiredPnlPct: null, lastFiredMarkPrice: null, lastFiredAtMs: null }),
    };
    const events: ObserverEvent[] = [pnlEvent()];
    expect(filterPnlSnapshots(events, positions, NOW).length).toBe(1);
  });

  test("position not in priorPositions at all → passes through (first-ever fire path)", () => {
    expect(filterPnlSnapshots([pnlEvent()], {}, NOW).length).toBe(1);
  });

  test("all three deltas under thresholds → pnl_snapshot dropped", () => {
    const positions: Record<string, PositionSnapshot> = {
      "BTC|long": priorPos({
        lastFiredPnl: 50,
        lastFiredPnlPct: 7,
        lastFiredMarkPrice: 70_500,
        // Last fired 10 min ago (< 30 min cooldown).
        lastFiredAtMs: NOW - 10 * 60 * 1000,
      }),
    };
    // Current PnL very close: +0.5pct delta, mark moved 0.07%.
    const ev = pnlEvent({ unrealizedPnl: 53, unrealizedPnlPct: 7.5, markPrice: 70_550 });
    expect(filterPnlSnapshots([ev], positions, NOW)).toEqual([]);
  });

  test("Δpnl% exceeds threshold (price + cooldown under) → passes through", () => {
    const positions: Record<string, PositionSnapshot> = {
      "BTC|long": priorPos({
        lastFiredPnl: 50,
        lastFiredPnlPct: 7,
        lastFiredMarkPrice: 70_500,
        lastFiredAtMs: NOW - 10 * 60 * 1000,
      }),
    };
    // Δpnl% = 6 > MIN_PNL_PCT_DELTA(5); Δprice% tiny; cooldown not elapsed.
    const ev = pnlEvent({ unrealizedPnl: 90, unrealizedPnlPct: 13, markPrice: 70_550 });
    expect(filterPnlSnapshots([ev], positions, NOW).length).toBe(1);
  });

  test("Δprice% exceeds threshold (pnl + cooldown under) → passes through", () => {
    const positions: Record<string, PositionSnapshot> = {
      "BTC|long": priorPos({
        lastFiredPnl: 50,
        lastFiredPnlPct: 7,
        lastFiredMarkPrice: 70_500,
        lastFiredAtMs: NOW - 10 * 60 * 1000,
      }),
    };
    // Δprice% = ~1% > MIN_PRICE_PCT_DELTA(0.5); Δpnl% small; cooldown not elapsed.
    const ev = pnlEvent({ unrealizedPnl: 53, unrealizedPnlPct: 7.5, markPrice: 71_300 });
    expect(filterPnlSnapshots([ev], positions, NOW).length).toBe(1);
  });

  test("cooldown elapsed (pnl + price under) → passes through", () => {
    const positions: Record<string, PositionSnapshot> = {
      "BTC|long": priorPos({
        lastFiredPnl: 50,
        lastFiredPnlPct: 7,
        lastFiredMarkPrice: 70_500,
        // 61 min ago — over the 60-min floor.
        lastFiredAtMs: NOW - 61 * 60 * 1000,
      }),
    };
    const ev = pnlEvent({ unrealizedPnl: 53, unrealizedPnlPct: 7.5, markPrice: 70_550 });
    expect(filterPnlSnapshots([ev], positions, NOW).length).toBe(1);
  });

  test("non-pnl_snapshot events are untouched regardless of position state", () => {
    const positions: Record<string, PositionSnapshot> = {
      "BTC|long": priorPos({
        lastFiredPnl: 50,
        lastFiredPnlPct: 7,
        lastFiredMarkPrice: 70_500,
        lastFiredAtMs: NOW - 1000,
      }),
    };
    const events: ObserverEvent[] = [
      pnlEvent(), // should be dropped (all-below)
      {
        type: "liquidation_risk",
        detectedAt: NOW,
        symbol: "BTC",
        side: "long",
        entryPrice: 70_000,
        markPrice: 62_000,
        liquidationPrice: 60_000,
        progress: 0.8,
        leverage: 10,
        margin: 700,
        unrealizedPnl: -300,
      },
    ];
    const out = filterPnlSnapshots(events, positions, NOW);
    expect(out.length).toBe(1);
    expect(out[0]?.type).toBe("liquidation_risk");
  });

  test("constants match spec defaults", () => {
    expect(MIN_PNL_PCT_DELTA).toBe(5);
    expect(MIN_PRICE_PCT_DELTA).toBe(0.5);
    expect(MIN_COOLDOWN_MS).toBe(60 * 60 * 1000);
  });
});
