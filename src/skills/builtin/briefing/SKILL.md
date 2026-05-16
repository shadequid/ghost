---
name: briefing
description: "On-demand or after-absence briefing. Catch-up summary of portfolio, news, market signals, and notable events. Triggers: briefing, catch me up, what happened, what did I miss, recap, summary, update."
always: false
---

# Contextual Briefing

Provide a concise catch-up covering everything the trader needs to know — portfolio, news, market signals, and notable events.

## When to Trigger

- Trader asks: "briefing", "catch me up", "what happened", "what did I miss", "recap", "summary", "update"
- After detecting absence via ghost_session_info (>24h since last active)

## Step 1: Check Session

First call `ghost_session_info()`. This returns hours since user's last message and message count.

- If the trader has been away **>24h** (`hoursSinceLastActive > 24`), proactively offer a briefing.
- If **<24h**, only respond to explicit briefing requests.
- If `hoursSinceLastActive` is `null`, the user has never messaged — skip the auto-offer.

## Step 2: Gather Data (parallel)

```
ghost_session_info()                     → hoursSinceLastActive (user messages only), messageCount
ghost_get_positions()                    → current positions + PnL
ghost_get_balance()                      → portfolio value
ghost_get_watchlist()                    → watchlist assets
ghost_news_search()                      → local crawled articles
ghost_tweets_search()                    → tweets from followed X accounts
web_search("crypto market news today")   → broader / breaking coverage (for query angles when results are thin, see market-intel "Search query strategy")
ghost_get_whale_activity()               → whale overview + cluster signal
ghost_market_overview()                  → fear & greed, market cap, trending
```

## Output Structure

Keep it under 15 sentences total. Structure:

1. **Portfolio snapshot** — positions changed? PnL update? New liquidation risk?
2. **News** — only if something happened that affects their held assets or watchlist
3. **Market signals** — fear & greed shift, unusual funding, whale cluster signal
4. **Notable events** — big movers, extreme funding, upcoming macro events

## Formatting

- Lead with the most important item (biggest PnL change, urgent news, or major market shift)
- Use bullet points for multiple items
- Skip sections with nothing noteworthy — don't pad with "nothing happened"
- End with ONE actionable suggestion (not an open question)

## Example

> Your BTC long is up +$420 since yesterday (+2.1%). ETH position flat.
>
> Market: Fear & Greed shifted from 45 to 62 (Greed). BTC dominance up 0.5%.
> Whale signal: 8/10 top OI assets have positive funding — market is crowded long.
>
> News: Ethereum Pectra upgrade activated — ETH saw brief pump then retraced.
>
> Want me to check if your BTC long needs a tighter stop given the crowded funding?

## After-Absence Briefing

When ghost_session_info shows `hoursSinceLastActive > 24`, offer a briefing:
- Don't force it — offer gently: "You've been away a bit. Want a quick catch-up?"
- If they say yes, run the full briefing above
- If they ignore or decline, drop it

## Key Principles

- **Concise** — under 15 sentences. Trader wants a catch-up, not a report.
- **Prioritize** — lead with what matters most to THEIR positions.
- **Actionable** — end with a specific next step, not "let me know if you need anything."
- **Skip empty sections** — don't mention what DIDN'T happen.
