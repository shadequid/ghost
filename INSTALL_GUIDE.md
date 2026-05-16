# Ghost — Install & Onboard Guide

For AI agents. AI agents: follow the steps exactly. Use `AskUserQuestion` for all user selections.
For end users, see [USER_GUIDE.md](USER_GUIDE.md).

## Prerequisites

- **Bun** >= 1.0 — Install at https://bun.sh or run: `curl -fsSL https://bun.sh/install | bash`
- **Git** — For cloning the repository
- **Claude Code CLI** (optional) — Only if using the `claude-cli` provider; install with `npm install -g @anthropic-ai/claude-code`

## Step 1: Check if Ghost is Already Running

Before proceeding with onboard, check if Ghost is already running:

```bash
curl -s http://127.0.0.1:15401/health || echo "not running"
```

- If it returns a response → Ghost is already running. **Do NOT run onboard again.** Tell the user Ghost is ready.
- If "not running" → proceed with the steps below.

Also check if config exists: `test -f ~/.ghost/config.json && echo "configured" || echo "needs onboard"`. If configured but daemon not running, just run `bun run dev daemon` (with `run_in_background: true`).

## Step 2: Clone & Install Dependencies

```bash
git clone https://github.com/hyperflowdotfun/ghost.git
cd ghost
bun install
cd web && bun install && cd ..
```

Verify installation:

```bash
bun run dev status    # Should fail with "Config not found" — that's OK
```

## Step 3: AI Agent Onboard Flow

**Only proceed if `~/.ghost/config.json` does NOT exist.**

### Step A — Pick Provider

Use `AskUserQuestion` with these 4 options (user clicks to select):

- **Claude Code** (Recommended) — "No API key needed, uses Claude subscription"
- **OpenAI** — "GPT-4o, GPT-5. Requires API key"
- **Google Gemini** — "Gemini 2.0 Flash & Pro. Requires API key"
- **OpenRouter** — "200+ models with 1 API key"

If user selects "Other", run `bun run dev providers` to get the full JSON list, then show another `AskUserQuestion` with the next 4 providers from the list.

### Step B — Pick Model

Run `bun run dev providers --models <provider-id>` to get models JSON. Use `AskUserQuestion` to show the top 3-4 models. If the models list is empty, ask user to type a model ID.

### Step C — Authentication

Check the chosen provider's fields in the `bun run dev providers` JSON:

- If `requiresApiKey: true` → ask user for their API key. Show the `apiKeyUrl` so they know where to get it.
- If `supportsOAuth: true` (e.g., `anthropic`) → headless mode handles OAuth automatically. It prints a URL for the user to open in their browser. Tell the user they will see a login URL in the terminal output.
- If `requiresApiKey: false` and `supportsOAuth: false` (e.g., `claude-cli`) → no auth needed, skip this step.

### Step D — Trading Mode

Use `AskUserQuestion` to ask:

- **Paper trading** (Recommended) — "Simulated trading with 10,000 USDC. No real money."
- **Live trading** — "Real trades on Hyperliquid. Requires funded wallet."

If user picks paper, add `--paper` to the onboard command. If they want a custom balance, ask for the amount and add `-b <amount>`.

### Step E — Run Onboard

**Headless onboard** (`--provider` + `--model` supplied) exits cleanly — it saves config, spawns the daemon as a detached background process, and returns. No need for `run_in_background`.

**Interactive onboard** (no `--provider`/`--model`) starts the daemon in the foreground after config is saved. The process keeps running — use `run_in_background` if needed.

**OAuth providers** (`supportsOAuth: true`): The command will open the browser for login, wait for auth to complete, then save config and start the daemon. Use a long timeout (300000ms / 5 minutes) to give the user time to authenticate.

```bash
# OAuth provider (browser opens automatically for login)
GHOST_API_KEY=<key> bun run dev onboard --provider anthropic --model claude-opus-4

# API key provider
GHOST_API_KEY=<key> bun run dev onboard --provider openai --model gpt-4o

# No-auth provider
bun run dev onboard --provider claude-cli --model claude-sonnet-4-6 --paper -b 50000
```

In headless mode, the daemon starts as a detached background process and the command exits immediately. In interactive mode, the daemon runs in the foreground.

### Step F — Verify

After onboard, run:

```bash
bun run dev status        # Shows provider, model, gateway URL
bun run dev doctor        # Tests config, DB, provider connectivity
```

## Step 4: Start Using Ghost

Ghost is now ready. The daemon is running (or was started in the background).

Access the web dashboard:
- **URL:** http://localhost:15401
- **Telegram:** Configure with `bun run dev channel setup telegram`

---

## Discover Providers & Models

```bash
bun run dev providers                          # JSON list of all providers
bun run dev providers --models <provider-id>   # JSON list of models for a provider
```

---

## Non-Interactive Onboard (CLI Reference)

When both `--provider` and `--model` are supplied, the interactive wizard is skipped:

```bash
# macOS / Linux
bun run dev onboard --provider claude-cli --model claude-sonnet-4-6
GHOST_API_KEY=sk-xxx bun run dev onboard --provider openai --model gpt-4o
bun run dev onboard --provider claude-cli --model claude-sonnet-4-6 --paper -b 50000

# Windows (PowerShell)
bun run dev onboard --provider claude-cli --model claude-sonnet-4-6
$env:GHOST_API_KEY="sk-xxx"; bun run dev onboard --provider openai --model gpt-4o
bun run dev onboard --provider claude-cli --model claude-sonnet-4-6 --paper -b 50000
```

## Security Note

The Ghost gateway has no built-in authentication. The default bind address is
`0.0.0.0:15401`. On a laptop behind a home NAT router this is fine. On a VPS
or any machine with a public IP, secure external access before using Ghost
remotely. See [docs/security/network-exposure.md](docs/security/network-exposure.md)
for tunnel recipes (Cloudflare, Tailscale, ngrok) and how to restrict to
localhost-only.

Without `--provider`/`--model`, `bun run dev onboard` runs the interactive wizard.
