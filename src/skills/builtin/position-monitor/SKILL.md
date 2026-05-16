---
name: position-monitor
description: "Show open positions, portfolio balance, pending orders, and trade history. Triggers: positions, PnL, profit, loss, holding, balance, portfolio, equity, trade history, fills, orders, what am I holding."
---

# Position Monitor

Display positions, portfolio state, and trade history. Fetch fresh data every time.

## What They're Asking For

| User says | What to fetch |
|-----------|---------------|
| "my positions" / "what am I holding?" | ghost_get_positions |
| "BTC position" | ghost_get_positions → filter |
| "PnL" / "how am I doing?" | ghost_get_positions |
| "balance" / "portfolio" | ghost_get_balance + ghost_get_positions + ghost_get_orders |
| "margin" / "how much margin left?" | ghost_get_balance |
| "orders" / "pending" | ghost_get_orders |
| "history" / "recent trades" | ghost_get_trade_history |
| "what happened today?" | ghost_get_trade_history + ghost_get_positions |

## Output Template — COPY THIS STRUCTURE EXACTLY

Your response MUST follow this template. Use `####` headings for each section. Use SOUL.md HTML tags for all trading data. Skip sections with no data.

```
#### Portfolio

| | |
|---|---|
| Equity | <price>$942.24</price> |
| Available | <price>$0.00</price> |
| Margin Used | <price>$986.29</price> |
| Unrealized PnL | <pnl dir="down">-$53.32</pnl> |

#### Positions

| Asset | Side | Size | Entry | Mark | PnL | Liq |
|---|---|---|---|---|---|---|
| BTC | <side dir="long">Long</side> <lev>10x</lev> | 0.144 | <price>$68,492</price> | <price>$68,122</price> | <pnl dir="down">-$53.32</pnl> | <price>$61,985</price> |

#### Orders

| Asset | Type | Side | Price | Size |
|---|---|---|---|---|
| BTC | Stop Market | Sell | <price>$67,373</price> | 0.144 |
| BTC | Take Profit | Sell | <price>$69,265</price> | 0.144 |

<verdict>Down $53 on the BTC long. SL and TP both in place. No margin left for new trades.</verdict>
```

## Rules

- `####` heading before EVERY section per SOUL.md. Not bold, not plain text — markdown heading.
- ALL data in tables. No exceptions. Positions, orders, balance, history — all tables.
- Use SOUL.md HTML tags for all trading data: `<price>`, `<pnl dir="up|down">`, `<side dir="long|short">`, `<lev>`, `<pct dir="up|down">`.
- Orders shown as a table, NOT as bullet points or prose.
- Skip sections that have no data (e.g. no orders → skip Orders section).
- After all tables: 1-2 sentences companion commentary wrapped in `<verdict>` tag. Never bare tables, never prose numbers.
- Keep it concise — key fields only.

### `<chart>` on TA over a held position

When evaluating a held position with TA content, emit `<chart symbol={held_asset} ... />` per the technical-analysis chart emission rule. Anchor on what the trader actually holds, not a ticker mentioned in passing.

## If You Notice Something

Mention it naturally in the commentary — don't create a separate warnings section.

- "Your BTC liq is only 5% away, by the way."
- "Funding on that ETH long is costing you ~$8/day."
- "Almost all your exposure is long right now."

Only mention things that actually matter right now.

## Tools

```
ghost_get_positions(wallet?)
ghost_get_balance(wallet?)
ghost_get_orders(wallet?)
ghost_get_trade_history(symbol?, limit?)
```
