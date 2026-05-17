# Installation

Install Ghost as a global Bun package, run the setup wizard, open the dashboard.

## Prerequisites

- **[Node.js](https://nodejs.org) + npm** — for installing the package
- **[Bun](https://bun.sh) >= 1.1** — Ghost runs as a Bun script at runtime
  ```bash
  # macOS / Linux
  curl -fsSL https://bun.sh/install | bash
  # Windows (PowerShell)
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
- **Claude Code CLI** (optional) — only if using the `claude-cli` provider: `npm install -g @anthropic-ai/claude-code`

## Install

```bash
npm install -g @hyperflow.fun/ghost
```

Verify:

```bash
ghost --version
```

If `ghost` isn't found, restart your terminal so npm's global `bin` directory is picked up on PATH.

## Onboard (Setup Wizard)

Run the wizard to configure your LLM provider, model, and trading mode:

```bash
ghost onboard
```

You'll pick:

1. **Trading Mode** — Paper (simulated, $10k USDC) or Live (real money on Hyperliquid)
2. **LLM Provider** — Claude Code (recommended, no API key), Anthropic, OpenAI, Google Gemini, or OpenRouter
3. **Model** — The specific model to use
4. **Install Ghost service** — Select **Yes** to run Ghost in the background after reboot

### Paper Trading

To start with paper trading directly:

```bash
ghost onboard --paper              # $10,000 USDC simulated
ghost onboard --paper -b 50000     # Custom balance
```

### Headless Setup (For Scripts / CI)

Supply provider and model upfront to skip interactive prompts:

```bash
GHOST_API_KEY=<key> ghost onboard --provider openai --model gpt-4o --paper
```

## Open the Dashboard

If you said "Yes" to installing the service during onboard, Ghost is already running. Visit:

**http://localhost:15401**

If you didn't install the service, start the daemon manually:

```bash
ghost daemon            # Foreground (Ctrl+C to stop)
ghost daemon --paper    # Paper mode
```

## Verify Setup

```bash
ghost status     # Provider, model, gateway URL
ghost doctor     # Full diagnostic (config, DB, provider)
```

## Data Storage

Ghost stores everything locally in `~/.ghost/`:

| Item | Location |
|------|----------|
| Config | `config.json` |
| Database | `db` |
| Memory & history | `workspace/memory/MEMORY.md`, `HISTORY.md` |
| Logs | `logs/` |
| Credentials (encrypted) | `credentials.json` |

Your data never leaves your machine.

## Update

```bash
ghost update                  # Check registry + reinstall in place
ghost update --channel=rc     # Switch to release-candidate channel
```

Or reinstall manually:

```bash
npm install -g @hyperflow.fun/ghost@latest
```

Your `~/.ghost/` data is preserved across updates.

## Uninstall

```bash
ghost uninstall                       # Stop service + remove ~/.ghost (interactive)
npm uninstall -g @hyperflow.fun/ghost    # Remove the binary
```

`ghost uninstall` prints the second command at the end so you don't need to remember it.

---

Next: [Your First Conversation](./first-conversation.md)
