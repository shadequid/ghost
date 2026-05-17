# Ghost

> Trade better WITH AI beside you.

AI companion for Hyperliquid perpetual contract traders. Not a dashboard. Not a bot. A companion that helps you manage risk, maintain discipline, and trade with emotional awareness.

## What Ghost Does

- **Trading Access** — View portfolio, place orders, manage positions, set SL/TP — all through chat
- **Pre-Trade Advisory** — Market context, risk assessment, and behavioral pattern detection before every trade
- **Market Intelligence** — News aggregation, whale tracking, cross-exchange analysis — filtered to what matters to you
- **Technical Analysis** — Chart patterns, indicators, and multi-timeframe analysis on demand

## Quick Start

Requires **[Bun](https://bun.sh) >= 1.1**:

```bash
# Install Bun (if you don't have it)
curl -fsSL https://bun.sh/install | bash             # macOS / Linux
powershell -c "irm bun.sh/install.ps1 | iex"         # Windows
```

**1. Install Ghost**

```bash
npm install -g @hyperflow.fun/ghost
```

**2. Onboard**

```bash
ghost onboard
```

You'll be asked to pick:

- **Trading Mode** — Paper (virtual funds, no wallet) or Live (real trades on Hyperliquid)
- **LLM Model** — Claude Code, Anthropic, OpenAI, Gemini, OpenRouter, or a custom endpoint
- **Install Ghost service** — Select **Yes** to keep Ghost running in the background

**3. Open the dashboard**

Visit **http://localhost:15401** and start trading.

## Commands

```bash
ghost daemon          # Start Ghost in the foreground
ghost status          # Show config and auth summary
ghost doctor          # Full diagnostic
ghost update          # Check for a new version and reinstall in place
ghost uninstall       # Remove service + ~/.ghost
```

See the [User Guide](USER_GUIDE.md) for the full reference.

## Documentation

| Document | Purpose |
|----------|---------|
| [User Guide](USER_GUIDE.md) | Install, setup, daily commands, update, uninstall, troubleshooting |
| [Install & Onboard Guide](INSTALL_GUIDE.md) | Step-by-step onboard flow for AI agents |
| [Developer Guide](CLAUDE.md) | Architecture, tech stack, conventions, development pipeline |
| [Product Vision](PRODUCT_VISION.md) | Market research, product vision, roadmap |
| [Features](FEATURES.md) | 22 features across 4 pillars |
| [Personas](PERSONAS.md) | Trader personas and emotion-response framework |
| [Journeys](JOURNEYS.md) | Journey narratives — Ghost in action for each persona |

## Data Storage

All data stored in `~/.ghost/` (config, credentials, database, memory, sessions). Nothing leaves your machine.

## Notes

- Ghost does not yet support switching between Paper and Live mode. To switch, uninstall and reinstall.
- If you installed an earlier version, uninstall first — this release contains breaking changes:
  ```bash
  ghost uninstall
  npm uninstall -g @hyperflow.fun/ghost
  ```

## Security

The Ghost gateway has no built-in authentication layer. By default it binds to
`0.0.0.0:15401`, which is convenient for local use but requires external
hardening before exposing the port to the internet. Options include Cloudflare
Tunnel + Access, Tailscale Serve, or ngrok OAuth. Alternatively, set
`gateway.host=127.0.0.1` in `~/.ghost/config.json` to restrict access to
localhost only.

See [docs/security/network-exposure.md](docs/security/network-exposure.md) for
detailed recipes and what to avoid.

## License

Open source.
