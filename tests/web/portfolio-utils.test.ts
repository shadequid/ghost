/**
 * Tests for `estimatePnl` — the per-position PnL/PnL% derivation used by
 * the web dashboard. BUG-0155 fix: PnL% must come from the API-supplied
 * `unrealizedPnlPct` (Hyperliquid's `returnOnEquity`) rather than a
 * client-side recomputation, so Ghost's number matches HL's own UI.
 */

import { describe, test, expect } from "bun:test";
import { estimatePnl, type PositionLike } from "../../web/src/components/layout/portfolio-utils.js";

const BASE: PositionLike = {
  side: "long",
  entryPrice: 100,
  size: 1,
  margin: 20,
  unrealizedPnl: 0,
  unrealizedPnlPct: 0,
};

describe("estimatePnl", () => {
  test("no livePrice → returns API pnl and pct as-is", () => {
    const p: PositionLike = { ...BASE, unrealizedPnl: 5, unrealizedPnlPct: 12.5 };
    const out = estimatePnl(p, undefined);
    expect(out.pnl).toBe(5);
    expect(out.pct).toBe(12.5);
  });

  test("livePrice present (long) → pnl recomputed, pct comes from API field (BUG-0155)", () => {
    // API said: pnl = $5, pct = 12.5% (HL returnOnEquity * 100)
    // livePrice = 110, entry = 100, size = 1 → client-side pnl = 10
    const p: PositionLike = { ...BASE, unrealizedPnl: 5, unrealizedPnlPct: 12.5 };
    const out = estimatePnl(p, 110);
    expect(out.pnl).toBe(10);
    // pct is NOT (10 / 20) * 100 = 50; it stays at 12.5 from API.
    expect(out.pct).toBe(12.5);
  });

  test("livePrice present (short) → pnl recomputed with short direction", () => {
    const p: PositionLike = { ...BASE, side: "short", unrealizedPnl: 0, unrealizedPnlPct: 3 };
    const out = estimatePnl(p, 90);
    // short: (entry - live) * size = (100 - 90) * 1 = 10
    expect(out.pnl).toBe(10);
    expect(out.pct).toBe(3);
  });

  test("zero margin position with no livePrice → returns API values, no division", () => {
    const p: PositionLike = { ...BASE, margin: 0, unrealizedPnl: -2, unrealizedPnlPct: -10 };
    const out = estimatePnl(p, undefined);
    expect(out.pnl).toBe(-2);
    expect(out.pct).toBe(-10);
  });
});
