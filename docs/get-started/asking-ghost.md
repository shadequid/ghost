# How to Ask Ghost

Ask in plain English. Ghost understands intent, not rigid commands.

## Portfolio Check

```
"Show me my portfolio"
"What's my total PnL today?"
"Which positions am I underwater on?"
"How many BTC am I holding across all wallets?"
```

Ghost returns: total equity, balance, PnL, open positions, liquidation distance.

## Market Context

```
"Is BTC overbought right now?"
"Show me liquidation zones on ETH"
"What's the funding rate on BTC perps?"
"Who are the biggest holders of DOGE?"
```

Ghost scans market data (OI, funding, whale moves, liquidation map) and gives you actionable context.

## Pre-Trade

```
"Should I enter a long on BTC at 65k with 5x?"
"Is this a good time to close my ETH short?"
"What's my risk if I buy $5k size of SOL?"
"I want to scale into this pump — good or bad?"
```

Ghost checks: market context, your position history, behavioral patterns, funding rates, news. Then gives a verdict with reasoning.

## After Entry

```
"Where should I take profit on this trade?"
"Is my SL too tight?"
"Should I add to this position?"
"I'm up 15% — lock it or hold?"
```

Ghost evaluates your thesis, profit target zone, resistance levels, and risk/reward. Tells you the move.

## After Exit

```
"Why did I take profit there instead of holding?"
"Did I panic-sell that?"
"That was a good trade. What did I do right?"
```

Ghost reviews the closed trade: your entry, exit, PnL, compared to thesis, and patterns you exhibit (taking profit too early, holding winners, revenge trades).

## Risk & Alerts

```
"Am I over-leveraged right now?"
"How close am I to liquidation?"
"What happens if BTC drops 5%?"
"Alert me if BTC breaks below 60k"
```

Ghost shows margin ratio, liquidation distance, portfolio impact, and sets watchlist price levels.

## Watchlist & News

```
"Add BTC and ETH to my watchlist"
"Show me news about my positions"
"Is there any bad news on Solana right now?"
"Alert me when ETH hits 2500"
```

Ghost consolidates news relevant to coins you care about. Deliveries via Telegram if configured.

## What Ghost will NOT do unprompted

- **Won't execute without approval** — Always asks you to confirm before placing an order
- **Won't speculate without data** — Won't say "BTC going to moon" without backing data
- **Won't cheerlead losses** — Won't say "it'll bounce back" to comfort you. Will say "let's review what happened and adjust"
- **Won't trade your plan away** — If you stated a thesis and Ghost recommended a different move, Ghost will flag the deviation and ask if you want to override

## Multi-step requests

One prompt can trigger several tool calls:

```
"Show me my portfolio, is anything underwater, and what's the liquidation distance on the worst position?"
```

Ghost: calls balance → positions → liquidations → synthesizes into one answer with all context.

## Telegram vs Web

- **Web dashboard** (`http://localhost:15401`) — Browse history, view charts, detailed analysis
- **Telegram** — Quick checks (PnL, SL, close), alerts, on-the-go commands

Both use the same Ghost backend. Use Telegram when you're away from screen, web when you want full context.

---

See [First Conversation](./first-conversation.md) for a worked example, or [CLI Commands](./cli-commands.md) for the command reference.
