# Safety and Confirmations: How Ghost Protects You

Ghost has multiple layers of protection between the LLM deciding to do something and your account actually being affected.

## Confirm Cards: Eight Trade-Affecting Operations

Any tool that affects your positions requires an explicit approval card before Ghost executes it.

| Tool | What It Does |
|------|--------------|
| `ghost_place_order` | Open a new position |
| `ghost_cancel_order` | Cancel an open order |
| `ghost_cancel_all_orders` | Close all pending orders |
| `ghost_emergency_close` | Force-close a position immediately |
| `ghost_set_sl_tp` | Update stop loss or take profit |
| `ghost_bracket_order` | Open a position with SL and TP attached |
| `ghost_partial_close` | Close part of a position |
| `ghost_adjust_margin` | Add or remove margin from a position |

**The flow**:
1. Ghost analyzes a trade and suggests an action
2. A confirmation card appears in the chat with the exact parameters
3. You review (entry, size, leverage, SL, TP, liquidation price, risk)
4. You approve or reject
5. Only then does Ghost execute

**Example confirmation card**:
```
Place Long Order?
├─ Symbol: ETH/USD
├─ Entry: $3,500
├─ Size: 1.0 ETH (~$3,500)
├─ Leverage: 5x
├─ SL: $3,350 (-$750 loss if hit)
├─ TP: $3,700 (+$1,000 profit if hit)
├─ Liq Price: $2,800 (20% below entry)
└─ Risk/Reward: 1:1.3
```

You reject any card that looks wrong. There's no penalty, no shame — rejection is the safe path.

## Autonomy Levels

Ghost has four autonomy settings that control what it's allowed to do without your approval.

| Level | Read Data | Suggest Trades | Require Confirmation | Execution |
|-------|-----------|----------------|-----------------------|-----------|
| **Read-Only** | ✓ | ✗ | N/A | No |
| **Interactive** (default) | ✓ | ✓ | Yes, for all trades | Manual only |
| **Supervised** | ✓ | ✓ | Yes, but fast-track | Auto on approval |
| **Full** | ✓ | ✓ | Pre-approved limits | Auto within limits |

**Read-Only**: Ghost can see your portfolio and market data, but never touches anything.

**Interactive** (default): Ghost suggests trades and actions. Every trade needs your approval via a confirmation card.

**Supervised**: Like interactive, but confirmation cards only show critical items (liquidation distance, leverage). Ghost auto-confirms safe changes (e.g., adjusting TP by $10 when position is profitable).

**Full**: Ghost operates within pre-set limits you define ("max 5x leverage, max $500 loss per trade"). Trades within limits execute automatically. Trades outside limits ask permission.

Most traders run **Interactive** mode — full control with Ghost's advice.

## Network Exposure: Loopback by Default

Ghost's gateway (the web dashboard and API) listens on your local machine only (`127.0.0.1:15401`). Only you, on the same machine, can access the dashboard and API.

To reach the dashboard from another device, use an authenticated tunnel (Tailscale Serve, ngrok OAuth, mTLS) — never expose the gateway directly. See [Network Exposure](../security/network-exposure.md) for recipes.

## Credentials at Rest: Encrypted

All sensitive data in `~/.ghost/` is encrypted:

- API keys and auth tokens use `enc2:` encryption
- The encryption key is stored in `~/.ghost/SECRET`
- If someone copies your `~/.ghost/` folder, they can't use your API keys without the SECRET file

**Keep `~/.ghost/SECRET` safe**: Back it up somewhere secure. If you lose it, you lose access to your encrypted credentials and must re-authenticate.

## Leak Detector: Scrubbing Secrets from Logs

When tools return data, Ghost scans for accidentally leaked secrets:

- API keys (private key patterns, JWT tokens)
- Private keys (Ethereum wallet private keys)
- Passwords or sensitive bearer tokens

If Ghost detects a leak, it scrubs the secret before it enters the chat log and alerts you: "Potential leak detected in tool output — secret scrubbed."

This protects your logs from being reviewed by human eyes or logged to disk with sensitive data exposed.

## Summary

- **Confirm cards**: Explicit approval for every trade-affecting action
- **Autonomy levels**: You choose how much Ghost can do
- **Loopback default**: Ghost only listens on your machine
- **Encryption**: Credentials encrypted at rest
- **Leak detector**: Secrets scrubbed from logs automatically
