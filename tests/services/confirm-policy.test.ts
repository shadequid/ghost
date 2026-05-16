/**
 * Unit tests for the confirm describer table — the single source of truth
 * for confirm card content (title + bullets). Each describer is pure,
 * synchronous, deterministic, and English-only.
 *
 * Trip-wire: describers must NEVER make network calls or hit services.
 * Tests pass plain param objects directly; if a describer ever needs a
 * service, this file would need restructuring.
 */

import { describe, test, expect } from "bun:test";
import {
  describeConfirm,
  CONFIRMABLE_TOOLS,
  isConfirmable,
  CONFIRM_DESCRIBERS,
} from "../../src/services/confirm-policy.js";

// ---------------------------------------------------------------------------
// CONFIRMABLE_TOOLS / isConfirmable
// ---------------------------------------------------------------------------

describe("CONFIRMABLE_TOOLS", () => {
  test("contains every trading-write tool name", () => {
    expect(isConfirmable("ghost_place_order")).toBe(true);
    expect(isConfirmable("ghost_cancel_order")).toBe(true);
    expect(isConfirmable("ghost_cancel_all_orders")).toBe(true);
    expect(isConfirmable("ghost_emergency_close")).toBe(true);
    expect(isConfirmable("ghost_set_sl_tp")).toBe(true);
    expect(isConfirmable("ghost_bracket_order")).toBe(true);
    expect(isConfirmable("ghost_partial_close")).toBe(true);
    expect(isConfirmable("ghost_adjust_margin")).toBe(true);
  });

  test("excludes ghost_set_leverage and other read tools", () => {
    expect(isConfirmable("ghost_set_leverage")).toBe(false);
    expect(isConfirmable("ghost_get_positions")).toBe(false);
    expect(isConfirmable("read_file")).toBe(false);
  });

  test("set size matches the eight known confirmable tools", () => {
    expect(CONFIRMABLE_TOOLS.size).toBe(8);
  });

  test("liquidation tools are NOT confirmable (notification config, not money)", () => {
    expect(isConfirmable("ghost_liquidation_thresholds_set")).toBe(false);
    expect(isConfirmable("ghost_liquidation_alert_disable")).toBe(false);
    expect(isConfirmable("ghost_liquidation_alert_enable")).toBe(false);
  });

  test("every confirmable tool has a registered describer", () => {
    for (const name of CONFIRMABLE_TOOLS) {
      expect(typeof CONFIRM_DESCRIBERS[name]).toBe("function");
    }
  });
});

// ---------------------------------------------------------------------------
// ghost_place_order
// ---------------------------------------------------------------------------

describe("describeConfirm — ghost_place_order", () => {
  test("market order, no leverage — concise title + Side bullet", () => {
    const out = describeConfirm("ghost_place_order", {
      symbol: "btc",
      side: "buy",
      size: 0.5,
      orderType: "market",
    });
    expect(out.title).toBe("Place market order: Long 0.5 BTC?");
    expect(out.bullets).toEqual(["Side: Long"]);
  });

  test("market order with leverage — leverage in Side bullet", () => {
    const out = describeConfirm("ghost_place_order", {
      symbol: "BTC",
      side: "buy",
      size: 0.5,
      leverage: 10,
    });
    expect(out.title).toBe("Place market order: Long 0.5 BTC?");
    expect(out.bullets).toEqual(["Side: Long 10x"]);
  });

  test("limit order with price + leverage — price in title, leverage in Side bullet", () => {
    const out = describeConfirm("ghost_place_order", {
      symbol: "ETH",
      side: "sell",
      size: 2,
      orderType: "limit",
      price: 3400,
      leverage: 5,
    });
    expect(out.title).toBe("Place limit order: Short 2 ETH @ $3,400.00?");
    expect(out.bullets).toEqual(["Side: Short 5x"]);
  });

  test("default orderType is market when omitted", () => {
    const out = describeConfirm("ghost_place_order", {
      symbol: "SOL",
      side: "buy",
      size: 10,
    });
    expect(out.title).toBe("Place market order: Long 10 SOL?");
    expect(out.bullets).toEqual(["Side: Long"]);
  });

  test("limit order without price falls back to market title", () => {
    // Defensive — execute() will reject this, but the describer should not throw.
    const out = describeConfirm("ghost_place_order", {
      symbol: "BTC",
      side: "buy",
      size: 0.5,
      orderType: "limit",
    });
    expect(out.title).toBe("Place market order: Long 0.5 BTC?");
  });

  test("title ends with ?", () => {
    const out = describeConfirm("ghost_place_order", {
      symbol: "BTC",
      side: "buy",
      size: 1,
    });
    expect(out.title.endsWith("?")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ghost_bracket_order
// ---------------------------------------------------------------------------

describe("describeConfirm — ghost_bracket_order", () => {
  test("market entry + SL + TP + leverage — concise title, Entry/SL/TP bullets", () => {
    const out = describeConfirm("ghost_bracket_order", {
      symbol: "BTC",
      side: "buy",
      size: 0.5,
      stopLoss: 62000,
      takeProfit: 70000,
      leverage: 10,
    });
    expect(out.title).toBe("Place bracket: Long 0.5 BTC 10x?");
    expect(out.bullets).toEqual([
      "Entry: market",
      "SL: $62,000",
      "TP: $70,000",
    ]);
  });

  test("compact USD keeps 2dp for fractional levels in bullets", () => {
    const out = describeConfirm("ghost_bracket_order", {
      symbol: "BTC",
      side: "buy",
      size: 0.1,
      stopLoss: 80346.5,
      takeProfit: 80909.5,
    });
    expect(out.title).toBe("Place bracket: Long 0.1 BTC?");
    expect(out.bullets).toEqual([
      "Entry: market",
      "SL: $80,346.50",
      "TP: $80,909.50",
    ]);
  });

  test("limit entry — orderType drives Entry bullet (regression for Major #2)", () => {
    const out = describeConfirm("ghost_bracket_order", {
      symbol: "ETH",
      side: "buy",
      size: 1,
      orderType: "limit",
      price: 3500,
      stopLoss: 3300,
      takeProfit: 3700,
    });
    expect(out.title).toBe("Place bracket: Long 1 ETH?");
    expect(out.bullets).toEqual([
      "Entry: limit @ $3,500.00",
      "SL: $3,300",
      "TP: $3,700",
    ]);
  });

  test("limit entry via legacy entryPrice param", () => {
    const out = describeConfirm("ghost_bracket_order", {
      symbol: "BTC",
      side: "sell",
      size: 0.1,
      orderType: "limit",
      entryPrice: 80909,
      stopLoss: 80346,
      takeProfit: 81508,
    });
    expect(out.title).toBe("Place bracket: Short 0.1 BTC?");
    expect(out.bullets).toEqual([
      "Entry: limit @ $80,909.00",
      "SL: $80,346",
      "TP: $81,508",
    ]);
  });

  test("market orderType ignores any stray entryPrice", () => {
    // Defensive: even if the caller leaks an entryPrice while orderType is
    // market, the Entry bullet still says "market" (the bug we just fixed
    // would have inverted this).
    const out = describeConfirm("ghost_bracket_order", {
      symbol: "BTC",
      side: "buy",
      size: 0.5,
      orderType: "market",
      stopLoss: 62000,
      takeProfit: 70000,
    });
    expect(out.bullets[0]).toBe("Entry: market");
  });
});

// ---------------------------------------------------------------------------
// ghost_set_sl_tp
// ---------------------------------------------------------------------------

describe("describeConfirm — ghost_set_sl_tp", () => {
  test("both SL and TP — concise title, prices in bullets", () => {
    const out = describeConfirm("ghost_set_sl_tp", {
      symbol: "btc",
      stopLoss: 62000,
      takeProfit: 70000,
    });
    expect(out.title).toBe("Set SL and TP for BTC?");
    expect(out.bullets).toEqual(["SL: $62,000", "TP: $70,000"]);
  });

  test("SL only — concise title, price in bullet", () => {
    const out = describeConfirm("ghost_set_sl_tp", {
      symbol: "BTC",
      stopLoss: 65000,
    });
    expect(out.title).toBe("Set stop loss for BTC?");
    expect(out.bullets).toEqual(["SL: $65,000"]);
  });

  test("TP only — concise title, price in bullet", () => {
    const out = describeConfirm("ghost_set_sl_tp", {
      symbol: "BTC",
      takeProfit: 85000,
    });
    expect(out.title).toBe("Set take profit for BTC?");
    expect(out.bullets).toEqual(["TP: $85,000"]);
  });

  test("compact format keeps 2dp for fractional levels in bullet", () => {
    const out = describeConfirm("ghost_set_sl_tp", {
      symbol: "BTC",
      takeProfit: 80909.5,
    });
    expect(out.title).toBe("Set take profit for BTC?");
    expect(out.bullets).toEqual(["TP: $80,909.50"]);
  });

  test("neither SL nor TP — defensive boring fallback", () => {
    const out = describeConfirm("ghost_set_sl_tp", { symbol: "BTC" });
    expect(out.title).toBe("Set SL/TP for BTC?");
    expect(out.bullets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ghost_cancel_order
// ---------------------------------------------------------------------------

describe("describeConfirm — ghost_cancel_order", () => {
  test("single order — title carries that symbol", () => {
    const out = describeConfirm("ghost_cancel_order", {
      orders: [{ id: "101", symbol: "BTC" }],
    });
    expect(out.title).toBe("Cancel order on BTC?");
    expect(out.bullets).toEqual([]);
  });

  test("multiple orders, same symbol — count + symbol", () => {
    const out = describeConfirm("ghost_cancel_order", {
      orders: [
        { id: "101", symbol: "BTC" },
        { id: "202", symbol: "BTC" },
      ],
    });
    expect(out.title).toBe("Cancel 2 orders on BTC?");
    expect(out.bullets).toEqual([]);
  });

  test("multiple orders, mixed symbols — count only", () => {
    const out = describeConfirm("ghost_cancel_order", {
      orders: [
        { id: "101", symbol: "BTC" },
        { id: "202", symbol: "ETH" },
        { id: "303", symbol: "SOL" },
      ],
    });
    expect(out.title).toBe("Cancel 3 orders?");
    expect(out.bullets).toEqual([]);
  });

  test("orders missing/empty — bare title", () => {
    expect(describeConfirm("ghost_cancel_order", {}).title).toBe(
      "Cancel order?",
    );
    expect(describeConfirm("ghost_cancel_order", { orders: [] }).title).toBe(
      "Cancel order?",
    );
  });

  test("single order with no symbol field — bare title", () => {
    const out = describeConfirm("ghost_cancel_order", {
      orders: [{ id: "101" }],
    });
    expect(out.title).toBe("Cancel order?");
  });
});

// ---------------------------------------------------------------------------
// ghost_cancel_all_orders
// ---------------------------------------------------------------------------

describe("describeConfirm — ghost_cancel_all_orders", () => {
  test("with symbol — scoped title", () => {
    const out = describeConfirm("ghost_cancel_all_orders", { symbol: "btc" });
    expect(out.title).toBe("Cancel all open orders on BTC?");
    expect(out.bullets).toEqual([]);
  });

  test("without symbol — sweep title", () => {
    const out = describeConfirm("ghost_cancel_all_orders", {});
    expect(out.title).toBe("Cancel all open orders?");
    expect(out.bullets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ghost_emergency_close
// ---------------------------------------------------------------------------

describe("describeConfirm — ghost_emergency_close", () => {
  test("with symbol — scoped close", () => {
    const out = describeConfirm("ghost_emergency_close", { symbol: "ETH" });
    expect(out.title).toBe("Close ETH position at market?");
    expect(out.bullets).toEqual([]);
  });

  test("without symbol — close-all sweep", () => {
    const out = describeConfirm("ghost_emergency_close", {});
    expect(out.title).toBe("Close all positions at market?");
    expect(out.bullets).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ghost_partial_close
// ---------------------------------------------------------------------------

describe("describeConfirm — ghost_partial_close", () => {
  test("percentage — title carries pct", () => {
    const out = describeConfirm("ghost_partial_close", {
      symbol: "BTC",
      percentage: 50,
    });
    expect(out.title).toBe("Close 50% of BTC position?");
    expect(out.bullets).toEqual([]);
  });

  test("non-integer percentage — rounds to nearest int", () => {
    const out = describeConfirm("ghost_partial_close", {
      symbol: "BTC",
      percentage: 33.333,
    });
    expect(out.title).toBe("Close 33% of BTC position?");
  });

  test("size only — title carries size with symbol unit", () => {
    const out = describeConfirm("ghost_partial_close", {
      symbol: "ETH",
      size: 2.5,
    });
    expect(out.title).toBe("Close 2.5 ETH position?");
  });

  test("size only — sub-1 size renders raw (matches chat-table convention)", () => {
    const out = describeConfirm("ghost_partial_close", {
      symbol: "BTC",
      size: 0.0145,
    });
    expect(out.title).toBe("Close 0.0145 BTC position?");
  });

  test("neither — defensive title", () => {
    const out = describeConfirm("ghost_partial_close", { symbol: "BTC" });
    expect(out.title).toBe("Close part of BTC position?");
  });
});

// ---------------------------------------------------------------------------
// ghost_adjust_margin
// ---------------------------------------------------------------------------

describe("describeConfirm — ghost_adjust_margin", () => {
  test("positive amount — Add", () => {
    const out = describeConfirm("ghost_adjust_margin", {
      symbol: "BTC",
      amount: 100,
    });
    expect(out.title).toBe("Add $100.00 margin to BTC?");
    expect(out.bullets).toEqual([]);
  });

  test("negative amount — Reduce, abs value in title", () => {
    const out = describeConfirm("ghost_adjust_margin", {
      symbol: "BTC",
      amount: -250,
    });
    expect(out.title).toBe("Reduce $250.00 margin on BTC?");
    expect(out.bullets).toEqual([]);
  });

  test("missing amount — defensive title", () => {
    const out = describeConfirm("ghost_adjust_margin", { symbol: "BTC" });
    expect(out.title).toBe("Adjust margin on BTC?");
  });
});

// ---------------------------------------------------------------------------
// describeConfirm — defensive paths
// ---------------------------------------------------------------------------

describe("describeConfirm — defensive paths", () => {
  test("unknown tool name — generic fallback title", () => {
    const out = describeConfirm("ghost_some_new_tool", { symbol: "BTC" });
    expect(out.title).toBe("Confirm ghost_some_new_tool?");
    expect(out.bullets).toEqual([]);
  });

  test("null params — empty params object treated as defaults", () => {
    const out = describeConfirm("ghost_cancel_all_orders", null);
    expect(out.title).toBe("Cancel all open orders?");
  });

  test("undefined params — empty params object treated as defaults", () => {
    const out = describeConfirm("ghost_emergency_close", undefined);
    expect(out.title).toBe("Close all positions at market?");
  });

  test("every describer returns a title that ends with '?'", () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["ghost_place_order", { symbol: "BTC", side: "buy", size: 1 }],
      ["ghost_bracket_order", { symbol: "BTC", side: "buy", size: 1, stopLoss: 60000, takeProfit: 70000 }],
      ["ghost_set_sl_tp", { symbol: "BTC", stopLoss: 60000, takeProfit: 70000 }],
      ["ghost_cancel_order", { orders: [{ id: "1", symbol: "BTC" }] }],
      ["ghost_cancel_all_orders", { symbol: "BTC" }],
      ["ghost_emergency_close", { symbol: "BTC" }],
      ["ghost_partial_close", { symbol: "BTC", percentage: 50 }],
      ["ghost_adjust_margin", { symbol: "BTC", amount: 100 }],
    ];
    for (const [name, params] of cases) {
      const out = describeConfirm(name, params);
      expect(out.title.endsWith("?")).toBe(true);
    }
  });
});
