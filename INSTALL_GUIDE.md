# Ghost — Install & Onboard Guide

For AI agents. Follow the steps exactly. Use `AskUserQuestion` for all user selections.
For end users, see [USER_GUIDE.md](USER_GUIDE.md).

## Step 1: Check if Ghost is Already Installed

```bash
ghost --version 2>/dev/null || echo "not installed"
```

If installed, also check the daemon:

```bash
curl -s http://127.0.0.1:15401/health || echo "daemon not running"
```

- Both succeed → Ghost is ready. **Do NOT re-onboard.** Tell the user Ghost is running at http://localhost:15401.
- Installed but daemon not running → run `ghost daemon` (with `run_in_background: true`) or `ghost onboard --service` to register the OS service.
- Not installed → proceed to Step 2.

Also check if config exists: `test -f ~/.ghost/config.json && echo "configured" || echo "needs onboard"`.

## Step 2: Install Bun & Ghost

Ghost requires **Bun >= 1.1**. Install Bun if missing:

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows (PowerShell)
powershell -c "irm bun.sh/install.ps1 | iex"
```

Then install Ghost globally:

```bash
bun install -g @hyperflow.fun/ghost
```

Verify:

```bash
ghost --version
```

If `ghost --version` fails immediately after install, instruct the user to restart their terminal so the new PATH entry from bun's global bin directory is picked up.

Note: Ghost requires Bun at runtime — the `ghost` binary is a Bun script (`#!/usr/bin/env bun`). Make sure Step 2 (Bun install) succeeded before running any `ghost` command.

## Step 3: AI Agent Onboard Flow

**Only proceed if `~/.ghost/config.json` does NOT exist.**

### Step A — Pick Provider

Use `AskUserQuestion` with these 4 options:

- **Claude Code** (Recommended) — "No API key needed, uses Claude subscription"
- **OpenAI** — "GPT-4o, GPT-5. Requires API key"
- **Google Gemini** — "Gemini 2.0 Flash & Pro. Requires API key"
- **OpenRouter** — "200+ models with 1 API key"

If the user selects "Other", run `ghost providers` to get the full JSON list, then show another `AskUserQuestion` with the next 4 providers from the list.

### Step B — Pick Model

Run `ghost providers --models <provider-id>` to get models JSON. Use `AskUserQuestion` to show the top 3-4 models. If the models list is empty, ask the user to type a model ID.

### Step C — Authentication

Check the chosen provider's fields in the `ghost providers` JSON:

- `requiresApiKey: true` → ask the user for their API key. Show the `apiKeyUrl` so they know where to get it.
- `supportsOAuth: true` (e.g., `anthropic`) → headless mode handles OAuth automatically. It prints a URL for the user to open in their browser. Tell the user they will see a login URL in the terminal output.
- `requiresApiKey: false` and `supportsOAuth: false` (e.g., `claude-cli`) → no auth needed; skip this step.

### Step D — Trading Mode

Use `AskUserQuestion`:

- **Paper trading** (Recommended) — "Simulated trading with 10,000 USDC. No wallet needed."
- **Live trading** — "Real trades on Hyperliquid. Requires a funded wallet."

If the user picks paper, add `--paper` to the onboard command. For a custom balance, ask for the amount and add `-b <amount>`.

### Step E — Run Onboard

**Headless onboard** (`--provider` + `--model` supplied) exits cleanly — it saves config, spawns the daemon as a detached background process, and returns. No need for `run_in_background`.

**Interactive onboard** (no `--provider`/`--model`) starts the daemon in the foreground after config is saved. Use `run_in_background` if needed.

**OAuth providers** (`supportsOAuth: true`): The command opens the browser for login, waits for auth, then saves config and starts the daemon. Use a long timeout (300000ms / 5 minutes) so the user has time to authenticate.

```bash
# OAuth provider (browser opens automatically)
ghost onboard --provider anthropic --model claude-opus-4

# API key provider
GHOST_API_KEY=<key> ghost onboard --provider openai --model gpt-4o

# No-auth provider, paper mode with custom balance
ghost onboard --provider claude-cli --model claude-sonnet-4-6 --paper -b 50000

# Install the OS service so Ghost survives reboots
ghost onboard --service
```

### Step F — Verify

```bash
ghost status        # Shows provider, model, gateway URL
ghost doctor        # Tests config, DB, provider connectivity
```

## Step 4: Start Using Ghost

Ghost is now ready. Tell the user:

- **Dashboard:** http://localhost:15401
- **Telegram:** Configure with `ghost channel setup telegram`

---

## Discover Providers & Models

```bash
ghost providers                          # JSON list of all providers
ghost providers --models <provider-id>   # JSON list of models for a provider
```

---

## Non-Interactive Onboard (CLI Reference)

When both `--provider` and `--model` are supplied, the interactive wizard is skipped:

```bash
# macOS / Linux
ghost onboard --provider claude-cli --model claude-sonnet-4-6
GHOST_API_KEY=sk-xxx ghost onboard --provider openai --model gpt-4o
ghost onboard --provider claude-cli --model claude-sonnet-4-6 --paper -b 50000

# Windows (PowerShell)
ghost onboard --provider claude-cli --model claude-sonnet-4-6
$env:GHOST_API_KEY="sk-xxx"; ghost onboard --provider openai --model gpt-4o
ghost onboard --provider claude-cli --model claude-sonnet-4-6 --paper -b 50000
```

## Security Note

The Ghost gateway has no built-in authentication. By default it binds to
loopback only (`127.0.0.1:15401`), reachable only from the same machine.
Exposing it over the network requires setting **both** `gateway.host=0.0.0.0`
and `gateway.allowPublicBind=true` in `~/.ghost/config.json`; without the
opt-in flag the daemon refuses to start. See
[docs/security/network-exposure.md](docs/security/network-exposure.md) for
tunnel recipes (Cloudflare, Tailscale, ngrok) before flipping the switch.

Without `--provider`/`--model`, `ghost onboard` runs the interactive wizard.
