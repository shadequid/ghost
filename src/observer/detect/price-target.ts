/**
 * Price-target crossing detector — pure predicate.
 *
 * Replaces the legacy AlertService.checkAlerts() + AlertWatcher path. The
 * observer calls this once per eval tick (5s cadence), passing the current
 * active rule set and the latest price snapshot from PriceCache.
 *
 * `firedIds` is what the caller passes to AlertRulesService.markFired() to
 * transition each crossed rule out of the active set — this module is pure
 * and does NOT touch storage itself.
 */

import type { AlertRule } from "../../services/alert-rules.js";
import type { PriceAlertEvent } from "../events.js";

export interface PriceTargetInput {
  /** Active rules from `AlertRulesService.list()`. */
  rules: ReadonlyArray<AlertRule>;
  /** Latest per-symbol mark from PriceCache. */
  prices: ReadonlyMap<string, number>;
  nowMs: number;
}

export interface PriceTargetResult {
  events: PriceAlertEvent[];
  /** Rule ids that crossed this eval — caller transitions them to fired. */
  firedIds: string[];
}

function crosses(condition: "above" | "below", price: number, target: number): boolean {
  return condition === "above" ? price >= target : price <= target;
}

export function detectPriceTargetCrossings(input: PriceTargetInput): PriceTargetResult {
  const events: PriceAlertEvent[] = [];
  const firedIds: string[] = [];

  for (const rule of input.rules) {
    if (rule.firedAt !== undefined) continue;
    const current = input.prices.get(rule.symbol);
    if (current === undefined) continue;
    if (!crosses(rule.condition, current, rule.price)) continue;

    events.push({
      type: "price_alert",
      detectedAt: input.nowMs,
      alertId: rule.id,
      symbol: rule.symbol,
      condition: rule.condition,
      targetPrice: rule.price,
      currentPrice: current,
      note: rule.note,
    });
    firedIds.push(rule.id);
  }

  return { events, firedIds };
}
