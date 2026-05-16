/**
 * Tests for classifyOrderKind — live Hyperliquid uses capitalised strings
 * ("Stop Market", "Take Profit Market"); paper engine uses snake_case
 * ("stop_market", "take_profit"). Classifier must handle both.
 */

import { describe, test, expect } from "bun:test";
import { classifyOrderKind } from "../../../src/tools/trading/account.js";

describe("classifyOrderKind", () => {
  const cases: Array<{ name: string; orderType: string; reduceOnly: boolean; expected: "sl" | "tp" | "entry_limit" | "pending_limit" }> = [
    { name: "live HL Stop Market reduceOnly → sl", orderType: "Stop Market", reduceOnly: true, expected: "sl" },
    { name: "live HL Stop Limit reduceOnly → sl", orderType: "Stop Limit", reduceOnly: true, expected: "sl" },
    { name: "live HL Take Profit Market reduceOnly → tp", orderType: "Take Profit Market", reduceOnly: true, expected: "tp" },
    { name: "live HL Take Profit Limit reduceOnly → tp", orderType: "Take Profit Limit", reduceOnly: true, expected: "tp" },
    { name: "paper stop_market reduceOnly → sl", orderType: "stop_market", reduceOnly: true, expected: "sl" },
    { name: "paper stop_limit reduceOnly → sl", orderType: "stop_limit", reduceOnly: true, expected: "sl" },
    { name: "paper take_profit reduceOnly → tp", orderType: "take_profit", reduceOnly: true, expected: "tp" },
    { name: "paper take_profit_limit reduceOnly → tp", orderType: "take_profit_limit", reduceOnly: true, expected: "tp" },
    { name: "plain limit non-reduceOnly → entry_limit", orderType: "limit", reduceOnly: false, expected: "entry_limit" },
    { name: "Limit (capitalised) non-reduceOnly → entry_limit", orderType: "Limit", reduceOnly: false, expected: "entry_limit" },
    { name: "limit reduceOnly (close leg, not trigger) → pending_limit", orderType: "limit", reduceOnly: true, expected: "pending_limit" },
    { name: "stop without reduceOnly (rare) → pending_limit", orderType: "stop_market", reduceOnly: false, expected: "pending_limit" },
    { name: "unknown type → pending_limit", orderType: "Weird Type", reduceOnly: false, expected: "pending_limit" },
  ];

  for (const c of cases) {
    test(c.name, () => {
      expect(classifyOrderKind({ orderType: c.orderType, reduceOnly: c.reduceOnly })).toBe(c.expected);
    });
  }
});
