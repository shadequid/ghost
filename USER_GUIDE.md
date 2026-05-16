# Ghost — User Guide

AI trading companion for Hyperliquid perpetual contract traders.

## Install

Ghost is in early access — install by cloning the repository:

```bash
git clone https://github.com/hyperflowdotfun/ghost.git
cd ghost
bun install
cd web && bun install && cd ..
```

## Setup

Run the setup wizard on first install:

```bash
bun run dev onboard
```

You'll pick a provider, a model, and a trading mode (paper or live).

## Start Ghost

```bash
bun run dev
```

Dashboard: **http://localhost:15401**

Press `Ctrl+C` to stop.

### Paper Trading

```bash
bun run dev daemon --paper               # 10,000 USDC simulated
bun run dev daemon --paper -b 50000      # Custom balance
```

## Common Commands

```bash
bun run dev                         # Start Ghost
bun run dev daemon --paper          # Paper trading (simulated, 10k USDC)
bun run dev daemon --paper -b 50000 # Paper with custom balance
bun run dev status                  # Config summary
bun run dev doctor                  # Full diagnostic
```

## Update

Update by pulling the latest code:

```bash
git pull
bun install
```

Your config, wallets, chat history, memory, and skills under `~/.ghost/` are not touched.

## Change Provider / Model

```bash
bun run dev onboard
```

### Custom / Self-Hosted Endpoints

To use Ollama, vLLM, LM Studio, or any OpenAI-compatible endpoint, run
`bun run dev onboard`, pick **Custom**, and Ghost will write your provider to
`~/.ghost/models.json`. For the full schema and examples see
[`docs/CUSTOM_MODELS.md`](docs/CUSTOM_MODELS.md).

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

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md) for common issues and fixes.
