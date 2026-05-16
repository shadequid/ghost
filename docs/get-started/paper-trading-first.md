# Paper Trading First

Kick the tires risk-free. Paper mode simulates real market fills without risking real money.

## Start paper trading

```bash
bun run dev daemon --paper              # $10,000 USDC default
bun run dev daemon --paper -b 50000     # $50,000 USDC custom balance
```

Stop with `Ctrl+C`.

## What paper mode is

| Aspect | Behavior |
|--------|----------|
| **Prices** | Real Hyperliquid live prices |
| **Fills** | Simulated at current price, includes slippage estimates |
| **Liquidations** | Calculated and enforced like real (you can get liquidated in paper) |
| **Margin tiers** | Same as live |
| **Funding** | Real funding rates from Hyperliquid, accrues during your hold |
| **Wallets** | Simulated; no connection to real Hyperliquid account |

You're trading with real market data but zeroed-risk capital.

## Why paper before live

- **Test Ghost's workflow** — Chat interface, confirm gates, risk warnings. Is Ghost helping or getting in the way?
- **Find Ghost's opinion blind spots** — If Ghost keeps missing a pattern in your style, paper is the place to identify it.
- **Calibrate settings** — Change verbosity, customize Telegram alerts, test skill recommendations.
- **Prove your edge** — If you can't be profitable in paper over 100 trades, live capital won't fix it.

## Reset paper balance

Paper balance is stored in memory. To reset:

```bash
# Stop the daemon
bun run dev daemon stop

# Remove the session file
rm -f ~/.ghost/session-paper.jsonl

# Restart
bun run dev daemon --paper
```

## Move to live

When you're confident:

```bash
# Stop paper daemon
bun run dev daemon stop

# Onboard with live trading
bun run dev onboard

# Start with real money
bun run dev daemon
```

On first live trade, Ghost will ask you to connect your Hyperliquid wallet (via read-only address + trading key, or wallet integration). After that, all trades hit real exchange.

**Paper → Live checklist:**
- [ ] 20+ paper trades completed, broke even or better
- [ ] Comfortable with Ghost's chat commands
- [ ] Tested Telegram alerts (if using)
- [ ] Wallet funded with amount you're willing to risk
- [ ] Dust test: place and cancel a $1 order on live to confirm wallet connection works

---

Next: [CLI Commands](./cli-commands.md)
