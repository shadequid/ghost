import { describe, test, expect } from "bun:test";
import {
  decidePnlDrift,
  PNL_DRIFT_THRESHOLD_PCT,
  PNL_DRIFT_IDLE_GATE_MS,
  PNL_DRIFT_COOLDOWN_MS,
  PNL_DRIFT_MIN_BASE,
  type PnlDriftState,
} from "../../src/observer/pnl-drift.js";

const NOW = 1_700_000_000_000;
const TWO_HOURS = 2 * 60 * 60 * 1000;
const SIX_HOURS = 6 * 60 * 60 * 1000;

function seed(): PnlDriftState {
  return { lastSnapshotPnl: null, lastSentAtMs: null };
}

describe("decidePnlDrift", () => {
  test("first call seeds baseline and does not fire", () => {
    const out = decidePnlDrift({
      state: seed(),
      currentPnl: 100,
      lastUserActivityMs: NOW - TWO_HOURS,
      nowMs: NOW,
    });
    expect(out.fire).toBe(false);
    expect(out.nextSnapshotPnl).toBe(100);
    if (!out.fire) expect(out.reason).toBe("seed_baseline");
  });

  test("delta below threshold does not fire", () => {
    const out = decidePnlDrift({
      state: { lastSnapshotPnl: 100, lastSentAtMs: null },
      // 10% drop — below 15% threshold
      currentPnl: 90,
      lastUserActivityMs: NOW - TWO_HOURS - 1,
      nowMs: NOW,
    });
    expect(out.fire).toBe(false);
    if (!out.fire) expect(out.reason).toBe("below_threshold");
    // Baseline preserved so accumulated drift can still trip the gate later.
    expect(out.nextSnapshotPnl).toBe(100);
  });

  test("delta above threshold but user is active does not fire", () => {
    const out = decidePnlDrift({
      state: { lastSnapshotPnl: 100, lastSentAtMs: null },
      currentPnl: 70,
      lastUserActivityMs: NOW - 30 * 60 * 1000, // 30 min idle
      nowMs: NOW,
    });
    expect(out.fire).toBe(false);
    if (!out.fire) expect(out.reason).toBe("user_active");
  });

  test("delta above threshold AND idle ≥ 2h AND no prior send → fires", () => {
    const out = decidePnlDrift({
      state: { lastSnapshotPnl: 100, lastSentAtMs: null },
      currentPnl: 80,
      lastUserActivityMs: NOW - TWO_HOURS - 1,
      nowMs: NOW,
    });
    expect(out.fire).toBe(true);
    if (out.fire) {
      expect(out.event.type).toBe("portfolio_pnl_drift");
      expect(out.event.fromPnl).toBe(100);
      expect(out.event.toPnl).toBe(80);
      expect(out.event.deltaPct).toBeCloseTo(-0.2, 3);
      expect(out.event.idleMs).toBeGreaterThanOrEqual(TWO_HOURS);
      expect(out.nextSnapshotPnl).toBe(80);
    }
  });

  test("subsequent fire within cooldown is suppressed", () => {
    const lastSent = NOW - 1 * 60 * 60 * 1000; // 1h ago — under 6h cooldown
    const out = decidePnlDrift({
      state: { lastSnapshotPnl: 100, lastSentAtMs: lastSent },
      currentPnl: 60,
      lastUserActivityMs: NOW - TWO_HOURS - 1,
      nowMs: NOW,
    });
    expect(out.fire).toBe(false);
    if (!out.fire) expect(out.reason).toBe("cooldown");
  });

  test("after cooldown expires another fire is allowed", () => {
    const lastSent = NOW - SIX_HOURS - 1;
    const out = decidePnlDrift({
      state: { lastSnapshotPnl: 100, lastSentAtMs: lastSent },
      currentPnl: 60,
      lastUserActivityMs: NOW - TWO_HOURS - 1,
      nowMs: NOW,
    });
    expect(out.fire).toBe(true);
  });

  test("near-zero baseline uses MIN_BASE so small absolute moves don't fire", () => {
    // baseline 1 USDC, currentPnl 2 USDC — would be 100% delta if naive
    const out = decidePnlDrift({
      state: { lastSnapshotPnl: 1, lastSentAtMs: null },
      currentPnl: 2,
      lastUserActivityMs: NOW - TWO_HOURS - 1,
      nowMs: NOW,
    });
    // With MIN_BASE=10, delta = (2-1)/10 = 10% → below 15% threshold
    expect(out.fire).toBe(false);
    if (!out.fire) expect(out.reason).toBe("below_threshold");
  });

  test("never-active user (null lastUserActivityMs) treated as fully idle with finite sentinel", () => {
    const out = decidePnlDrift({
      state: { lastSnapshotPnl: 100, lastSentAtMs: null },
      currentPnl: 80,
      lastUserActivityMs: null,
      nowMs: NOW,
    });
    expect(out.fire).toBe(true);
    if (out.fire) {
      // idleMs must be a large finite number — large enough that the judge
      // unambiguously reads "maximally idle", not zero (which historically
      // would have been misread as "user just chatted").
      expect(Number.isFinite(out.event.idleMs)).toBe(true);
      expect(out.event.idleMs).toBeGreaterThanOrEqual(PNL_DRIFT_IDLE_GATE_MS);
    }
  });

  test("positive drift also fires (gains, not just losses)", () => {
    const out = decidePnlDrift({
      state: { lastSnapshotPnl: 100, lastSentAtMs: null },
      currentPnl: 130,
      lastUserActivityMs: NOW - TWO_HOURS - 1,
      nowMs: NOW,
    });
    expect(out.fire).toBe(true);
    if (out.fire) expect(out.event.deltaPct).toBeCloseTo(0.3, 3);
  });

  test("threshold/idle/cooldown constants are within product-stated bounds", () => {
    expect(PNL_DRIFT_THRESHOLD_PCT).toBe(0.15);
    expect(PNL_DRIFT_IDLE_GATE_MS).toBe(2 * 60 * 60 * 1000);
    expect(PNL_DRIFT_COOLDOWN_MS).toBe(6 * 60 * 60 * 1000);
    expect(PNL_DRIFT_MIN_BASE).toBe(10);
  });
});
