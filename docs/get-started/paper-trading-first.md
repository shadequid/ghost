# Paper Trading First

Kick the tires risk-free. Paper mode simulates real market fills without risking real money.

## Start paper trading

```bash
ghost daemon --paper              # $10,000 USDC default
ghost daemon --paper -b 50000     # $50,000 USDC custom balance
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

Paper balance is stored in your session file. To reset:

```bash
ghost daemon stop                      # Stop the service
rm -f ~/.ghost/session-paper.jsonl     # Remove the session file
ghost daemon --paper                   # Restart
```

## Move to live

Ghost does not currently support switching modes in place. To move from paper to live, uninstall and reinstall:

```bash
ghost uninstall                            # Remove service + data
bun install -g @hyperflow.fun/ghost        # Reinstall
ghost onboard                              # Pick "Live trading" this time
```

On first live trade, Ghost will ask you to connect your Hyperliquid wallet. After that, all trades hit the real exchange.

**Paper → Live checklist:**
- [ ] 20+ paper trades completed, broke even or better
- [ ] Comfortable with Ghost's chat commands
- [ ] Tested Telegram alerts (if using)
- [ ] Wallet funded with amount you're willing to risk
- [ ] Dust test: place and cancel a $1 order on live to confirm wallet connection works

---

Next: [CLI Commands](./cli-commands.md)
