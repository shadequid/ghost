# Ghost

> Trade better WITH AI beside you.

AI companion for Hyperliquid perpetual contract traders. Not a dashboard. Not a bot. A companion that helps you manage risk, maintain discipline, and trade with emotional awareness.

## What Ghost Does

- **Trading Access** — View portfolio, place orders, manage positions, set SL/TP — all through chat
- **Pre-Trade Advisory** — Market context, risk assessment, and behavioral pattern detection before every trade
- **Market Intelligence** — News aggregation, whale tracking, cross-exchange analysis — filtered to what matters to you
- **Technical Analysis** — Chart patterns, indicators, and multi-timeframe analysis on demand

## Quick Start

Ghost is in early access — install by cloning the repository:

```bash
git clone https://github.com/hyperflowdotfun/ghost.git
cd ghost
bun install
cd web && bun install && cd ..
bun run dev onboard            # Setup wizard (one-time)
bun run dev                    # Build web + start gateway (port 15401)
```

### Commands

```bash
bun run dev daemon                   # Start Ghost
bun run dev daemon --paper           # Paper trading (simulated, 10k USDC)
bun run dev daemon --paper -b 50000  # Paper mode with custom balance
bun run dev status                   # Config summary
bun run dev doctor                   # Full diagnostic
```

### LLM Providers

OpenRouter, Anthropic (API), Claude Code, OpenAI, Google Gemini, or any custom OpenAI-compatible endpoint.

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

## Tech Stack

Bun + TypeScript, pi-agent-core + pi-ai, ElysiaJS, @nktkas/hyperliquid, grammY, React + Vite + Tailwind.

## Data Storage

All data stored in `~/.ghost/` (config, credentials, database, memory, sessions).

## Uninstall

Delete the repository and optionally your data:

```bash
# macOS / Linux
rm -rf ghost          # Delete the clone
rm -rf ~/.ghost          # Delete all Ghost data (optional)

# Windows (PowerShell)
Remove-Item -Recurse -Force ghost          # Delete the clone
Remove-Item -Recurse -Force ~/.ghost          # Delete all Ghost data (optional)
```

See [User Guide](USER_GUIDE.md#uninstall) for details.

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
