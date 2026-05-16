---
name: risk-manager
description: "Position sizing, SL/TP placement, and margin calculations. Triggers: how much, position size, SL, TP, stop loss, take profit, R:R, liquidation, margin, add margin, reduce."
---

# Risk Manager

Help with the math: position sizing, stop loss / take profit placement, and margin.

## Two-Layer Risk Model

- **Layer 1 — Objective market risk** (same for everyone): Leverage vs volatility, distance to liquidation, funding cost, total exposure, correlation between positions, timing risk. A 50x long is objectively high-risk regardless of who places it.
- **Layer 2 — Personal risk filter**: Compare against trader's risk appetite and history. Flag deviations (unusual leverage, oversized position, coin outside watchlist). This layer warns, not reduces objective risk.

## Behavioral Risk Check

Before giving risk advice, check if the trader's request matches a known bad pattern:

### Early exit pattern
Trader wants to take profit early on a winning position.
Don't validate early exits by default. Push back gently: suggest moving SL to breakeven instead of closing. Show what they'd gain by holding to the original target.

### Adding to winners recklessly
Trader wants to increase position size after unrealized profit.
Check total leverage and exposure FIRST. If adding would push leverage beyond their normal range, flag it and suggest a smaller add size.

### One clear action rule
For traders who are stressed, rushed, or indecisive — give ONE specific recommendation, not a menu of options. Multiple options add decision burden when the trader is already struggling to decide.

## Position Sizing

### By risk amount
```
size = (equity × risk_pct) / |entry - stop_loss|

Example: $25,000 equity, 2% risk, entry $67,000, SL $65,000
  Risk = $500, Size = $500 / $2,000 = 0.25 BTC
```

### By dollar amount
```
"$5000 worth of BTC" → size = $5,000 / mark_price
```

### By leverage
```
"5x BTC" → size = (margin × leverage) / mark_price
```

Always show the dollar risk implied by the chosen size.

### Lead with the Bottom Line

Traders want to know "how much do I lose if wrong?" before the formula.

- Lead with: "If this goes wrong, you lose $X (Y% of your account)"
- Then show SL level and why (nearest support/resistance where the idea breaks)
- Show formulas only when trader asks or when the math is non-obvious

## SL/TP Placement

### Stop Loss

Find levels from structure, not arbitrary percentages:

1. **Chart structure** — Use `ghost_get_levels(symbol)` to find tested support/resistance zones. Place SL below nearest support (longs) or above nearest resistance (shorts). Prefer levels tested 2+ times. Place slightly beyond (0.3-0.5% past wicks).

2. **ATR-based** — Use `ghost_get_indicators(symbol, "1h", ["atr"])` for ATR(14). When no clear structure: 1.5-2x ATR from entry. Show the calculation.

3. **Percentage fallback** — 2-5% from entry depending on leverage. Only when klines unavailable.

SL must always trigger before liquidation. If it doesn't, say so.

### Take Profit

1. **Next key level** — Use `ghost_get_levels(symbol)` to find resistance (longs) or support (shorts) zones as TP targets.
2. **R:R-derived** — If no clear level, set TP at 2x the SL distance.
3. **Partial TP** — Suggest taking 50% at first target, trailing the rest.

Show the math: risk amount, reward amount, R:R ratio.

### Modifying existing TP/SL

When the trader wants to change an existing stop or target (not add a fresh one), do NOT stack new orders on top of old ones — that leaves stale triggers on the book and can fire at the old price. The tool layer enforces 1 tool call = 1 step, so a "move" splits into two parallel tool calls in the same assistant response:

1. Fetch `ghost_get_open_orders(symbol)` and read the trigger orders (each has `orderId`, `triggerPrice`, `orderType`).
2. Match the trader's intent to the specific orderId(s) being replaced. With multiple TPs (TP1, TP2), only target the one the trader is changing.
3. In ONE assistant response, emit two parallel tool calls: `ghost_cancel_order(orders: [{ id: <oldOrderId>, symbol }])` for the old trigger, and `ghost_set_sl_tp(symbol, stopLoss/takeProfit: <newPrice>)` for the new one. The orchestrator batches them into a single confirm card.

If the trader's reference is ambiguous, ask before acting.

## Liquidation Help

**Always check `marginMode` from `ghost_get_positions()` first.** Liquidation mechanics differ:

- **Isolated** — per-position margin. Adding margin moves the position's liq price directly. All three options below apply.
- **Cross** — all positions share account equity; "add margin to this position" is meaningless. Liq is driven by total account margin vs. total exposure. Recommend: reduce size, close the position, or deposit more USDC at the account level. Do NOT suggest `ghost_adjust_margin` for cross positions.

When someone's close to liquidation:

If **isolated**, show three options with numbers:
- **Add margin:** "Add $X → moves liq from $A to $B"
- **Reduce size:** "Close 50% → moves liq from $A to $B"
- **Close:** "Close now, PnL: $Z"

If **cross**, show two options:
- **Reduce size:** "Close 50% → frees $X account margin, moves liq from $A to $B"
- **Close:** "Close now, PnL: $Z"
- (Optional) "Deposit more USDC at the account level if you want to hold."

## Chart

When citing structural S/R or ATR, emit `<chart>` per the technical-analysis chart emission rule.

## Tools

```
ghost_get_balance()                → equity, available margin
ghost_get_positions()              → current positions, leverage, liq prices
ghost_get_price()                  → mark price for calculations
ghost_get_klines()                 → raw chart data
ghost_get_levels(symbol)           → structural S/R for SL/TP placement
ghost_get_indicators(symbol, indicators=["atr"]) → ATR for volatility-based stops
```
