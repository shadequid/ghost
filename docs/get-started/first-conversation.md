# Your First Conversation

Here's what a real Ghost session looks like. You're using paper trading with $10,000 USDC.

## The Session

**You:** Show me my portfolio

**Ghost:**
| Wallet | Equity | Balance | PnL | Open Positions |
|--------|--------|---------|-----|-----------------|
| Default | $10,000 | $8,950 | +$145 (1.4%) | 2 |

You're holding **BTC long 3x** (entry $62,500, current $63,800, +$2,850) and **ETH short 2x** (entry $2,400, current $2,380, -$400). Funded BTC once, paid $12. Nothing critical.

---

**You:** Should I take profit on my BTC long?

**Ghost:**
BTC is up strong. Your entry is solid, but <lev>3x</lev> means you're near resistance at <lvl price="65000">$65,000</lvl> — profit-taking zone.

I'd lock half here. <pnl dir="up">+$1,425</pnl> on the table. Worst case: BTC corrects 3% below, you keep $700. Best case: keeps running, you've banked profit and still have <lev>1.5x</lev> exposure upside.

SL on remaining to breakeven at <price>62,500</price>. Risk: $0.

**Your verdict:** Close 50% now?
- <verdict type="bullish">YES — lock profit, keep upside</verdict>

---

**You:** Yes, market close half

**Ghost:**
Closing 0.5 BTC at market.

| Parameter | Value |
|-----------|-------|
| Size | 0.5 BTC (~$31,900 value) |
| Estimated fill | <price>$63,850</price> |
| Slippage (est.) | +$14 |
| PnL locked | <pnl dir="up">+$1,425</pnl> |
| Remaining | 0.5 BTC <lev>3x</lev>, SL @ <price>$62,500</price> |

Ready?

---

**You:** Confirm

**Ghost:**
✓ Order executed. Locked <pnl dir="up">+$1,425</pnl>. Half position running. You're still long BTC but now protected — any dip below breakeven closes automatically.

---

## What just happened

1. **Portfolio Check** — Ghost called `ghost_get_balance` and `ghost_get_positions` to show your real balances, positions, and PnL.

2. **Advisory with Data** — You asked for an opinion. Ghost called `ghost_pre_trade_check` (checks market context, funding, whale moves), `ghost_get_indicators` (pulls technical levels), and `ghost_get_liquidations` (checks liquidation distance). Then it gave you a specific verdict: close half, not all or nothing.

3. **Confirmation Gate** — Before execution, Ghost built a confirm card showing size, estimated fill, slippage, remaining exposure, and SL. You saw exactly what would happen. You approved. Only then did Ghost call `ghost_close_position`.

---

## Why this matters

- **No guessing** — Ghost shows you the data and its reasoning before you decide.
- **One chat** — No jumping between Hyperliquid app, CoinGlass, TradingView. Everything in one message.
- **Real formatting** — Tags like `<pnl>`, `<lev>`, `<verdict>` highlight the key decision points so you scan the important bits fast.

You just managed a trade using words, not clicks. No slippage surprises. No forgotten SL.

---

Next: [Paper Trading First](./paper-trading-first.md)
