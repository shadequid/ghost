# Morning Briefing

Wake up to a market read.

Every morning at 8 AM local time, Ghost sends you a briefing. It's not a news dump — it's a synthesis of what changed overnight and what you should focus on today.

## Sample Morning Briefing

```
MORNING BRIEFING — Friday, May 16, 6:28 AM

Overnight Summary
─────────────────
Your Positions: +$1,240 (funding -$45, price +$1,285)
  • BTC LONG 0.5 (avg $71,300) → $73,100, PnL: +$900
  • ETH LONG 2.0 (avg $3,240) → $3,280, PnL: +$80
  • SOL SHORT 1.0 (avg $180) → $176, PnL: +$400 (but funding expensive: -$60)

Market Overnight
─────────────────
Funding shifted: BTC +0.005%, ETH +0.001%, SOL -0.008% (shorts paying).
BTC broke above $73k (hit resistance at $73.2k, pulled back $200).
Whale movement: 3 large wallets closed BTC longs overnight (15% distribution signal?).

News (Last 8h)
─────────────────
• Fed speaker: "rates may hold through Q3" — supportive
• CPI report: released 14:30 EST today (higher volatility expected)

What Changed on Your Watchlist
─────────────────────────────────
ETH/USDC: Now trading at $3,280 (+1.2% overnight). Your alert at $3,300 is close.
HYPE/USDC: Volume spike, up 8%, funding spiked to 0.032% (longs crowded).
BLAST/USDC: Still consolidating $0.08-$0.10 range.

Ghost Recommends Today
───────────────────────
1. Close SOL short before CPI (funding eaten too much profit already).
2. Watch for CPI dump — BTC support is now $72,500 (whale baseline).
3. If ETH breaks $3,300, consider taking half of BTC profit (de-risk before econ data).
4. HYPE: too crowded on funding, skip for now. Reverse setup if funding cools.
```

## Schedule

By default, Ghost sends two briefings:
- **Morning Briefing** — 8:00 AM local time
- **Evening Recap** — 9:00 PM local time

To change the time:

```
You: "briefing at 7am"
Ghost: Changed. Morning briefing now sends at 7:00 AM.

You: "evening recap off"
Ghost: Evening recap disabled. You'll get morning briefing only.
```

To get an on-demand briefing:

```
You: "briefing"
Ghost: [sends the briefing immediately, even if not scheduled]
```

---

## What's Included

**Overnight PnL Summary**
- Your positions: total delta, funding drag, price movement split
- Each open position: current price, entry, PnL, time in trade

**Market-Wide Changes**
- Funding rate shifts on coins you trade
- Large price moves overnight (any coin breaking 24h highs/lows)
- Whale wallet movements (open/close positions, size)

**News (Last 8h)**
- Economic calendar events approaching (CPI, Fed, earnings)
- Breaking crypto news (regulatory, exchange, token-specific)
- Twitter alpha that passed Ghost's importance filter

**Your Watchlist Updates**
- Coins you've set alerts on: price vs. alert, volume changes
- Coins you trade frequently: technical changes (support/resistance shifts)

**Ghost's Opinion for Today**
- Trades to consider closing (funding or thesis invalidated)
- Coins to avoid (crowded, thesis weak)
- Key times to watch (events, whale movements)
- Risk adjustments to think about

---

## Implementation

Morning briefing is a cron job (`src/scheduler/service.ts`) that triggers the `ghost_morning_briefing` tool. This tool:
1. Reads your session history (positions, trades, alerts)
2. Pulls market data (funding, whale movements, news, klines)
3. Constructs a natural-language briefing
4. Dispatches to Telegram

The cron time is stored in your config (`~/.ghost/config.json`).

Reference: [Channels &gt; Telegram](../channels/telegram.md) | [Services &gt; IntelService](../reference/services.md)
