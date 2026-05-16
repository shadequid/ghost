# Installation

Ghost is in early access. There is no published package or installer script — install by cloning the repository.

## Prerequisites

- **Bun** >= 1.0 — Install at https://bun.sh (run `curl -fsSL https://bun.sh/install | bash`)
- **Claude Code CLI** (optional) — Only needed if using the `claude-cli` provider; install via `npm install -g @anthropic-ai/claude-code`

## Install

```bash
git clone https://github.com/hyperflowdotfun/ghost.git
cd ghost
bun install
cd web && bun install && cd ..
```

## Onboard (Setup Wizard)

Run the onboard wizard to configure your LLM provider, model, and trading mode:

```bash
bun run dev onboard
```

You'll be asked to pick:
1. **LLM Provider** — Claude Code (recommended, no API key), Anthropic, OpenAI, Google Gemini, or OpenRouter
2. **Model** — The specific model to use
3. **Trading Mode** — Paper (simulated, $10k USDC) or Live (real money on Hyperliquid)

### Paper Trading

To start with paper trading instead of live:

```bash
bun run dev onboard --paper              # $10,000 USDC simulated
bun run dev onboard --paper -b 50000     # Custom balance
```

### Headless Setup (For Scripts/CI)

Supply provider and model upfront to skip interactive prompts:

```bash
GHOST_API_KEY=<key> bun run dev onboard --provider openai --model gpt-4o --paper
```

## Start Ghost

After onboarding, start the daemon:

```bash
bun run dev                # Build web + start gateway (port 15401)
```

**Access the dashboard:** http://localhost:15401

Press `Ctrl+C` to stop.

### Paper Trading Mode

```bash
bun run dev daemon --paper              # Paper trading, $10k default
bun run dev daemon --paper -b 100000    # Paper with custom balance
```

## Verify Setup

```bash
bun run dev status    # Show provider, model, gateway URL
bun run dev doctor    # Full diagnostic (config, DB, provider)
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

Update by pulling the latest code:

```bash
git pull
bun install
```

Since Ghost is in early access, there are no published packages. The VersionCheckService is dormant until a registry exists.

## Uninstall

Delete the repository and your data:

```bash
# Delete the clone
rm -rf ghost

# Delete all Ghost data (optional)
rm -rf ~/.ghost
```

On Windows (PowerShell):
```powershell
# Delete the clone
Remove-Item -Recurse -Force ghost

# Delete all Ghost data (optional)
Remove-Item -Recurse -Force ~\.ghost
```

---

Next: [Your First Conversation](./first-conversation.md)
