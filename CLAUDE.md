# Ghost — Developer Guide

> AI companion for Hyperliquid perpetual contract traders. Not a dashboard. Not a bot. A companion.

## Project Overview

```
pi-agent-core (agent loop, tools, events)
  + pi-ai (LLM streaming, 20+ providers)
      └── Ghost (Bun + TypeScript)
          ├── src/index.ts               — Unified entry point (daemon, onboard, status, doctor, …)
          ├── src/runtime.ts             — Composition root, wires all subsystems
          ├── src/logger.ts              — Pino-based structured logger
          ├── src/agent/                 — Orchestrator, context builder
          ├── src/auth/                  — OAuth token management
          ├── src/bus/                   — Event bus, queue, message types
          ├── src/channels/              — Telegram (grammY) channel dispatcher
          ├── src/commands/              — Command router + builtins (daemon, channel, proactive, uninstall, version)
          ├── src/config/                — Zod schema, paths, credentials, secrets
          ├── src/core/                  — Database (SQLite), migrations, error types, interfaces
          ├── src/daemon/                — Gateway + channels + scheduler startup
          ├── src/eval/                  — Eval harness (golden set, scoring CLI)
          ├── src/events/                — Client-facing event types
          ├── src/gateway/               — ElysiaJS server, WebSocket, REST, pairing
          ├── src/health/                — Doctor / status diagnostics
          ├── src/helpers/               — Result type, formatters, confirm
          ├── src/memory/                — MemoryStore (MEMORY.md + HISTORY.md), consolidator
          ├── src/observer/              — Background detectors (price moves, liquidation, news)
          ├── src/onboard/               — Setup wizard, provider registry, banner
          ├── src/pairing/               — Device pairing for channel handoff
          ├── src/providers/             — LLM provider adapters around pi-ai
          ├── src/scheduler/             — Cron service (JSON file-backed)
          ├── src/security/              — Policy engine, leak detector
          ├── src/services/              — HyperliquidClient, IntelService, WatchlistService, AlertService, TA services
          ├── src/session/               — JSONL session persistence
          ├── src/skills/                — Skill loader + builtin skills
          ├── src/templates/             — SOUL.md (seeded to workspace on first run)
          ├── src/tools/                 — 12 generic + 23 trading tool files
          ├── src/update/                — In-place updater (registry check + reinstall)
          └── web/                       — Vite + React + Tailwind dashboard
```

## Prerequisites

- **Bun** >= 1.0 (`curl -fsSL https://bun.sh/install | bash`)
- **Claude Code** (optional, for `claude-cli` provider) — `npm install -g @anthropic-ai/claude-code`

## Install & Onboard

> **AI agents:** When the user asks to install Ghost, run the commands below immediately. Do NOT ask for confirmation — just execute them. Follow `INSTALL_GUIDE.md` for the full step-by-step flow.

### Step 1: Clone and install dependencies

```bash
git clone https://github.com/hyperflowdotfun/ghost.git
cd ghost
bun install
cd web && bun install && cd ..
```

### Step 2: Onboard (REQUIRED before any other command)

> **AI agents:** Follow the detailed step-by-step onboard flow in [`INSTALL_GUIDE.md`](INSTALL_GUIDE.md). Use `AskUserQuestion` for provider, model, and trading mode selections. Use `ghost providers` to fetch options dynamically. Onboard (headless or interactive) only saves config and exits — it does **not** start the daemon. After onboard, start the daemon with `ghost daemon` (use `run_in_background: true`) or register the OS service via `ghost onboard --service`. For OAuth providers, use a long tool-call timeout (e.g. 300000ms / 5 min) so the user has time to authenticate in the browser.

### Step 3: Verify

```bash
ghost status            # Check config and auth
ghost doctor            # Full diagnostic (config, DB, provider)
```

### Developer setup (for contributors)

```bash
bun install                          # Install all deps
cd web && bun install                # Install web dashboard deps
```

## Run

### Quick start (first time)

```bash
bun run dev onboard         # Setup wizard: provider, model, auth
```

### Development

```bash
bun run dev                          # Build web + start gateway (port 15401) with --watch
```

### Commands

```bash
# Core
bun run dev onboard         # Interactive setup wizard
bun run dev daemon          # Start gateway + channels + scheduler

# Paper trading
bun run dev onboard --paper           # Setup + paper mode (10k USDC)
bun run dev daemon --paper -b 50000   # Paper mode with custom balance

# Verbose mode (structured logging + tool call chips on web UI)
bun run dev onboard -v              # Setup with verbose logging saved
bun run dev daemon -v               # Start with debug-level logging
bun run dev daemon -vv              # Start with trace-level logging
LOG_LEVEL=warn bun run dev daemon   # Explicit log level override

# Diagnostics & lifecycle
bun run dev status                   # Show config and auth summary
bun run dev doctor                   # Verify config, DB, and provider
bun run dev daemon stop              # Stop the OS service (interactive confirm)
bun run dev uninstall                # Remove OS service + ~/.ghost (interactive confirm)
bun run dev skills list              # List available skills
bun run dev providers                # List available LLM providers (JSON)
bun run dev providers --models <id>  # List models for a provider (JSON)
bun run dev logs                     # Tail daemon logs
bun run dev update                   # Check registry + reinstall in place
bun run dev update --channel=rc      # Switch to release-candidate channel
bun run dev channel setup            # Configure a channel (e.g. Telegram)
bun run dev channel pair             # Pair a device to an existing channel
bun run dev channel status           # Show channel + pairing state
bun run dev proactive on|off|status  # Toggle proactive companion messages
bun run dev --version                # Print Ghost version

# Build & test
bun run check                        # TypeScript type-check
bun test                             # Run tests
bun run web:build                    # Build web dashboard
bun run web:dev                      # Web dev server (hot reload)

# Eval (2-tier: L1 Execution = tool use, L2 Behavior = 6 dims × 4 = 24 max)
bun run eval --verbose                                      # Run golden set + print per-scenario trace
bun run src/eval/cli.ts regen --no-keep-fixed --personas 5  # Rebuild golden dataset
```

### LLM Providers

| Provider        | Config                   | Auth                          |
| --------------- | ------------------------ | ----------------------------- |
| OpenRouter      | `provider: "openrouter"` | API key                       |
| Anthropic (API) | `provider: "anthropic"`  | API key or OAuth              |
| Claude Code     | `provider: "claude-cli"` | Claude Code subscription (no API key) |
| OpenAI          | `provider: "openai"`     | API key                       |
| Google Gemini   | `provider: "google"`     | API key                       |
| Custom          | `provider: "custom"`     | API key + base URL            |

## Uninstall

### From the CLI (recommended for registry installs)

```bash
ghost daemon stop    # Stop the background service (interactive confirm)
ghost uninstall      # Remove service + ~/.ghost (interactive confirm);
                     # prints the one-line command to also remove the bun package
```

## Data Storage (~/.ghost/)

Data stored in `~/.ghost/` (config, credentials, database, memory, sessions).

## Key Files

| File                 | Purpose                                                    |
| -------------------- | ---------------------------------------------------------- |
| `PRODUCT_VISION.md`  | Market research, product vision, roadmap                   |
| `FEATURES.md`        | 23 features across 4 pillars                               |
| `PERSONAS.md`        | Trader personas, emotion-response framework                |
| `JOURNEYS.md`        | Journey narratives — how Ghost intervenes for each persona |
| `docs/`              | Full developer + user documentation tree                   |
| `web/DESIGN.md`      | Web dashboard design system — tokens, motion, overlays, a11y |

## Three-Layer Model for AI Features

```
Capability (US)  →  "Agent CAN do X"           →  ship once
Behavior (Skill) →  "Agent does X HOW"          →  iterate forever
Eval             →  "Agent does X WELL enough?"  →  measure continuously
```

The capability layer defines what data goes in and what type of output comes out, plus what the agent must NOT do. The behavior layer defines tone, format, phrasing, and decision heuristics. Never mix the two — every skill tune should be free to iterate without changing the capability contract.

## Tech Stack

| Layer    | Technology                          |
| -------- | ----------------------------------- |
| Runtime  | Bun + TypeScript (strict mode)      |
| Database | bun:sqlite (WAL, FTS5)              |
| LLM      | @mariozechner/pi-ai (20+ providers) |
| Agent    | @mariozechner/pi-agent-core         |
| HTTP     | ElysiaJS                            |
| Exchange | @nktkas/hyperliquid + viem          |
| Telegram | grammY                              |
| Frontend | Vite + React + Tailwind CSS         |

## Coding Conventions

- **TypeBox** for all tool parameter schemas
- **`ghost_` prefix** on trading tool names
- **Explicit DI** — services created in `runtime.ts`, passed to tool factories
- **No singletons** — never use module-level mutable state
- **Confirmation required** for all write operations
- **No `any`** — strict TypeScript, use `unknown` + narrowing
- **Named exports** everywhere, top-level imports only
- Files < 300 LOC; split by category
- Early returns over deep nesting
- Comments explain "why", not "what"
- Commit: `prefix(scope): description` — `feat`, `fix`, `refactor`, `chore`, `test`, `docs`

**Web dashboard conventions** live in `web/DESIGN.md` — typography tokens,
motion scale, reduced-motion rules, when to portal overlays, shared
animation primitives (`<Popover>`, `<AnimatedNumber>`, `<LoadingScreen>`),
and `.btn-press` / `.status-dot-live` utilities. Read before adding or
reviewing UI code under `web/src/`.

## Configuration

Config in `~/.ghost/config.json` (Zod-validated). Secrets encrypted with `enc2:` prefix.

## Database Schema

`src/core/database.ts` is the frozen baseline — the current schema snapshot installed by `initDatabase` for fresh DBs.

**Any schema change goes into a `Migration<Database>` entry** in `src/core/migrations/registry.ts`. Never edit `database.ts` to evolve the shape — add a new migration with a monotonically increasing `version`. New tables, new columns, new indexes, dropped columns, renames — all of it.

The runner applies pending migrations on every `createRuntime()` call after `initDatabase`. Fresh installs land on the baseline first, then run all migrations to reach the current shape; existing users run only the migrations they haven't seen yet.

## Testing

Tests mirror `src/` structure under `tests/`. Run with `bun test`. Individual test: `bun test tests/gateway/chat.test.ts`.

