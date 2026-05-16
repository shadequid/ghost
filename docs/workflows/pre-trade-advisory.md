# Pre-Trade Advisory

Before you click buy, ask Ghost.

## A Trade Proposal

You've been watching BTC for 3 hours. Support at $71,200, and price just bounced. You want to enter a long with 8x leverage, 1 BTC, TP at $73,500, SL at $71,000. But before hitting the button, you ask Ghost.

```
You: "Check BTC long 8x, 1 BTC, entry $71,300, SL $71,000, TP $73,500"

Ghost: Pre-Trade Check: LONG BTC
Risk Level: MODERATE (3/6)
────────────────────────────────────────
✓ Funding 0.0087% — neutral.
⚠ Volume up 18% vs 24h avg — good momentum.
✓ Orderbook balanced (52% bids).
  OI: $412M | 24h: +3.2%
  Sentiment: Neutral (48/100)
  Note: Already LONG BTC (size: 0.5 BTC, 5x)

Before adding, consider: 1) existing 5x position increases your total to 13x blended; 
2) OI growing into entry (crowding signal); 3) CPI release in 4 hours (volatility spike risk).
Position still valid, but watch those factors closely.
```

Ghost ran:
- **ghost_pre_trade_check** — timing risk, funding, OI, orderbook, sentiment
- **ghost_cross_exchange_funding** — is this coin crowded across exchanges?
- **ghost_get_indicators** — how's RSI, MACD behaving on 4h?
- **ghost_timing_risk** — what's happening economically in the next 6 hours?

The response combines all signals into a single risk assessment. You see the trade is technically reasonable but operationally risky because you already hold 0.5 BTC long. You decide to skip adding and wait for the next setup.

## What Ghost Looks At

- **Funding Rate** — Are longs or shorts crowded? You entering at peak crowding?
- **24h Volume** — Spike or drought? Low volume means slippage risk.
- **Orderbook Imbalance** — Is there enough liquidity on your side?
- **Open Interest** — Is OI rising or falling? Growing OI = crowding into your entry.
- **Market Sentiment** — Fear & Greed index. Extreme values = reversal risk.
- **Existing Positions** — You already long this coin? Adding increases correlation and blended leverage.
- **Scheduled Events** — CPI, Fed, earnings? Next 6 hours volatility forecast.
- **Whale Movement** — Are big players moving? In which direction?
- **News (Last 2h)** — Breaking news that changes the outlook?

Reference: [Channels &gt; Telegram](../channels/telegram.md) | [Concepts &gt; Technical Analysis](../get-started/asking-ghost.md)
