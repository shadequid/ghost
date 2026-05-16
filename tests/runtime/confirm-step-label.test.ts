/**
 * Multi-step batched confirm: verify each numbered step label inlines its
 * describer's bullets as `" — bullet1, bullet2"`. Critical safety data
 * (SL/TP levels, side/leverage, etc.) must survive into the step label —
 * the numbered-step UI has no separate bullet area.
 *
 * The full path lives in `src/runtime.ts` (`runBatchedConfirm`). The
 * step-label builder there is pure (it just stitches `describeConfirm`
 * output), so we replicate that small pipeline here and assert against the
 * resulting `steps[]` shape. This avoids spinning up a runtime + confirm
 * service for what is effectively a string-formatting unit test.
 *
 * If the runtime builder ever drifts from `head + " — " + bullets.join(", ")`,
 * update both this test AND runtime.ts to keep them aligned.
 */

import { describe, test, expect } from "bun:test";
import { describeConfirm } from "../../src/services/confirm-policy.js";

interface Call {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Mirror of the step-label builder in runtime.ts → runBatchedConfirm.
 * Kept intentionally small + pure for direct unit-testing.
 */
function buildSteps(calls: Call[]): string[] {
  return calls.map((c) => {
    const desc = describeConfirm(c.name, c.args);
    const head = desc.title.replace(/[?？]\s*$/, "");
    const tail = desc.bullets.length > 0 ? ` — ${desc.bullets.join(", ")}` : "";
    return `${head}${tail}`;
  });
}

describe("multi-step confirm — bullets inlined into step label", () => {
  test("cancel_order + set_sl_tp(takeProfit: 85000) — TP price visible in step label (regression for Major #1)", () => {
    const steps = buildSteps([
      { name: "ghost_cancel_order", args: { orders: [{ id: "1", symbol: "BTC" }] } },
      { name: "ghost_set_sl_tp", args: { symbol: "BTC", takeProfit: 85000 } },
    ]);
    expect(steps).toHaveLength(2);
    expect(steps[0]).toBe("Cancel order on BTC");
    expect(steps[1]).toMatch(/Set take profit for BTC.*TP: \$85,000/);
    // Exact form: head + " — " + bullets joined by ", ".
    expect(steps[1]).toBe("Set take profit for BTC — TP: $85,000");
  });

  test("bracket multi-step — Entry/SL/TP all inline", () => {
    const steps = buildSteps([
      {
        name: "ghost_bracket_order",
        args: {
          symbol: "ETH",
          side: "buy",
          size: 0.86,
          leverage: 10,
          stopLoss: 2301.73,
          takeProfit: 2346.77,
        },
      },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toBe(
      "Place bracket: Long 0.86 ETH 10x — Entry: market, SL: $2,301.73, TP: $2,346.77",
    );
  });

  test("step with no bullets — no trailing em-dash", () => {
    const steps = buildSteps([
      { name: "ghost_cancel_all_orders", args: { symbol: "BTC" } },
    ]);
    expect(steps[0]).toBe("Cancel all open orders on BTC");
    expect(steps[0]).not.toContain("—");
  });

  test("trailing question mark stripped before suffix", () => {
    const steps = buildSteps([
      { name: "ghost_set_sl_tp", args: { symbol: "BTC", stopLoss: 65000 } },
    ]);
    // Title was "Set stop loss for BTC?" — "?" stripped, " — SL: $65,000" appended.
    expect(steps[0]).toBe("Set stop loss for BTC — SL: $65,000");
    expect(steps[0]).not.toContain("?");
  });
});
