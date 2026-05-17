# Ghost — User Guide

AI trading companion for Hyperliquid perpetual contract traders.

## Prerequisites

**[Bun](https://bun.sh) >= 1.1** — installs in one line:

```bash
curl -fsSL https://bun.sh/install | bash             # macOS / Linux
powershell -c "irm bun.sh/install.ps1 | iex"         # Windows
```

## Install

```bash
bun install -g @hyperflow.fun/ghost
```

This installs the `ghost` command globally. If the command isn't found, restart your terminal or add `~/.bun/bin` to your PATH (the Bun installer prints the exact line for your shell).

## Setup

Run the onboarding wizard:

```bash
ghost onboard
```

You'll be asked to choose:

1. **Trading Mode**
   - **Paper Trading** — No wallet needed. Trade with virtual funds (10,000 USDC by default).
   - **Live Trading** — Connect your wallet, trade real money on Hyperliquid.
2. **LLM Model** — Claude Code (recommended, no API key), Anthropic, OpenAI, Gemini, OpenRouter, or a custom endpoint.
3. **Install Ghost service** — Select **Yes** so Ghost stays running in the background after reboot.

## Open the Dashboard

Visit **http://localhost:15401** and start chatting.

> Ghost does **not** support switching between Paper and Live mode after onboarding. To switch, uninstall and reinstall.

## Common Commands

```bash
ghost daemon                 # Start Ghost in the foreground (Ctrl+C to stop)
ghost status                 # Config and auth summary
ghost doctor                 # Full diagnostic (config, DB, provider)
ghost logs                   # Tail the daemon log
ghost daemon stop            # Stop the background service
ghost update                 # Check for new version and reinstall
ghost --version              # Print Ghost version
```

### Channels (Telegram)

```bash
ghost channel setup telegram     # Connect a Telegram bot
ghost channel status             # Show channel state
ghost channel pair               # Approve pairing requests
```

### Proactive Companion

```bash
ghost proactive status           # Show current setting
ghost proactive on               # Enable proactive messages
ghost proactive off              # Disable
```

## Update

```bash
ghost update                     # Check registry + reinstall in place
ghost update --channel=rc        # Switch to release-candidate channel
```

Your config, wallets, chat history, memory, and skills under `~/.ghost/` are preserved across updates.

If `ghost update` fails, you can always reinstall manually:

```bash
bun install -g @hyperflow.fun/ghost@latest
```

## Change Provider / Model

Re-run the wizard at any time:

```bash
ghost onboard
```

### Custom / Self-Hosted Endpoints

To use Ollama, vLLM, LM Studio, or any OpenAI-compatible endpoint, run `ghost onboard`, pick **Custom**, and Ghost will write your provider to `~/.ghost/models.json`. See [`docs/CUSTOM_MODELS.md`](docs/CUSTOM_MODELS.md) for the schema.

## Uninstall

```bash
ghost uninstall                       # Stop service + remove ~/.ghost (interactive)
bun remove -g @hyperflow.fun/ghost    # Remove the binary
```

`ghost uninstall` prints the second command at the end so you don't need to remember it.

## Troubleshooting

See [docs/troubleshooting.md](docs/troubleshooting.md) for common issues and fixes.
