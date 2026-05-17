# Ghost Documentation

## The Manifesto

**Ghost is an AI companion for Hyperliquid perpetual contract traders. Not a dashboard. Not a bot. A companion.**

Traders know they're FOMOing. They know they're revenge trading. The problem isn't awareness — it's the lack of an intervention mechanism at the right moment. No one reminds them, no one warns them, no one asks the hard question before they press the button.

Ghost walks beside you. It sees your positions, understands your emotions, and intervenes before you blow up the account.

## Why Ghost Is Different

- **Pre-trade Advisory** — Before every trade: market context, risk assessment, behavior pattern detection
- **Emotion Awareness** — Detects FOMO, revenge trading, overconfidence; nudges discipline at the moment it matters
- **Proactive Observer** — Watches for whale moves, funding rate shifts, liquidation risks while you sleep
- **Paper-Trading-First** — Learn the companion with simulated money; trade live only when ready

## 5-Minute Quickstart

Requires [Bun](https://bun.sh) >= 1.1.

```bash
npm install -g @hyperflow.fun/ghost     # Install
ghost onboard                           # One-time setup: pick mode, LLM, install service
# → say "Yes" to install the service; Ghost starts in the background
```

Open the dashboard at **http://localhost:15401**.

In Telegram or web UI, ask Ghost: "What are my current positions? Any risks?"

Ghost starts watching, analyzing, and nudging.

## Find Your Way

| I want to... | Start at |
|---|---|
| Understand what Ghost is | [get-started/what-is-ghost.md](./get-started/what-is-ghost.md) |
| Install and run | [get-started/installation.md](./get-started/installation.md) → [get-started/cli-commands.md](./get-started/cli-commands.md) |
| See Ghost in action | [get-started/first-conversation.md](./get-started/first-conversation.md) |
| Try without real money | [get-started/paper-trading-first.md](./get-started/paper-trading-first.md) |
| Learn what to ask | [get-started/asking-ghost.md](./get-started/asking-ghost.md) |
| Set up Telegram | [channels/telegram.md](./channels/telegram.md) |
| Pick an LLM | [providers/overview.md](./providers/overview.md) |
| See real-world workflows | [workflows/](./workflows/) |
| Understand how it thinks | [concepts/](./concepts/) |
| Tune the observer / scheduler / paper engine | [operations/](./operations/) |
| Self-host securely | [security/network-exposure.md](./security/network-exposure.md) |
| Contribute code | [contributing.md](./contributing.md) |
| Look up a term | [glossary.md](./glossary.md) |
| Diagnose an issue | [troubleshooting.md](./troubleshooting.md) |
| Read internal architecture | [reference/](./reference/) |

## Documentation Map

Ghost docs are organized by reader journey. Start with **get-started** for onboarding; move to **concepts** and **operations** for self-hosting; dive into **reference** if you're building clients or extending Ghost.

```
docs/
├── get-started/         — What is Ghost, install, first chat, CLI commands
├── workflows/           — Pre-trade advisory, emotion-aware, alerts, briefings, charts
├── channels/            — Telegram + web dashboard (user-facing)
├── providers/           — LLM picker + custom models
├── concepts/            — Companion vs dashboard, three-layer model, memory, safety
├── operations/          — Observer, scheduler, paper, eval, update
├── reference/           — Architecture, tools, services, gateway, database (for contributors)
├── security/            — Network exposure, hardening recipes
├── contributing.md      — Dev setup, conventions, pipeline
├── glossary.md
└── troubleshooting.md
```

## Where Ghost Lives

Ghost is self-hosted on your machine. All data — config, credentials, chat history, positions, memory — stays in `~/.ghost/` as encrypted JSON and SQLite. No cloud sync. No third-party logs. Local WebSocket gateway (port 15401) binds to localhost by default; optional Telegram bot for remote access via your secure bot token.

## Status

Ghost is in active development. Recent: paper-trading parity with live engine, unified observer loop (alert + proactive merged), custom-models layering for multi-provider stacks.
