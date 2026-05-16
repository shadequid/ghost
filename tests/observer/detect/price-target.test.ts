import { describe, expect, test } from "bun:test";
import { detectPriceTargetCrossings } from "../../../src/observer/detect/price-target.js";
import type { AlertRule } from "../../../src/services/alert-rules.js";

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "r1",
    symbol: "BTC",
    condition: "above",
    price: 70_000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("detectPriceTargetCrossings", () => {
  test("above-rule crosses when mark ≥ target", () => {
    const r = detectPriceTargetCrossings({
      rules: [rule()],
      prices: new Map([["BTC", 70_000]]),
      nowMs: 1,
    });
    expect(r.events).toHaveLength(1);
    expect(r.firedIds).toEqual(["r1"]);
  });

  test("above-rule does not cross when mark < target", () => {
    const r = detectPriceTargetCrossings({
      rules: [rule()],
      prices: new Map([["BTC", 69_999]]),
      nowMs: 1,
    });
    expect(r.events).toHaveLength(0);
    expect(r.firedIds).toEqual([]);
  });

  test("below-rule crosses when mark ≤ target", () => {
    const r = detectPriceTargetCrossings({
      rules: [rule({ condition: "below", price: 60_000 })],
      prices: new Map([["BTC", 60_000]]),
      nowMs: 1,
    });
    expect(r.events).toHaveLength(1);
  });

  test("missing price → skip rule, not crash", () => {
    const r = detectPriceTargetCrossings({
      rules: [rule()],
      prices: new Map(),
      nowMs: 1,
    });
    expect(r.events).toHaveLength(0);
    expect(r.firedIds).toEqual([]);
  });

  test("already-fired rule is ignored even when price re-crosses", () => {
    const r = detectPriceTargetCrossings({
      rules: [rule({ firedAt: new Date().toISOString() })],
      prices: new Map([["BTC", 80_000]]),
      nowMs: 1,
    });
    expect(r.events).toHaveLength(0);
    expect(r.firedIds).toEqual([]);
  });

  test("multiple rules — only crossings fire", () => {
    const r = detectPriceTargetCrossings({
      rules: [
        rule({ id: "r1", symbol: "BTC", condition: "above", price: 70_000 }),
        rule({ id: "r2", symbol: "BTC", condition: "above", price: 80_000 }),
        rule({ id: "r3", symbol: "ETH", condition: "below", price: 3_000 }),
      ],
      prices: new Map([
        ["BTC", 70_500],
        ["ETH", 2_900],
      ]),
      nowMs: 1,
    });
    expect(r.firedIds.sort()).toEqual(["r1", "r3"]);
  });

  test("event carries current mark + target + condition for the judge prompt", () => {
    const r = detectPriceTargetCrossings({
      rules: [rule({ id: "r1", symbol: "BTC", condition: "above", price: 70_000, note: "tp1" })],
      prices: new Map([["BTC", 70_500]]),
      nowMs: 12345,
    });
    expect(r.events[0]).toEqual({
      type: "price_alert",
      detectedAt: 12345,
      alertId: "r1",
      symbol: "BTC",
      condition: "above",
      targetPrice: 70_000,
      currentPrice: 70_500,
      note: "tp1",
    });
  });
});
