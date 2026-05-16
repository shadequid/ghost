# Contributing to Ghost

## Dev Setup

### Prerequisites

- **Bun** >= 1.1.0 (`curl -fsSL https://bun.sh/install | bash`)
- **Claude Code** (optional, for `claude-cli` provider)

### Installation

```bash
bun install
cd web && bun install && cd ..
```

### Environment

No required env vars for local dev (optional: set API keys for providers like Anthropic, OpenAI, or Google Gemini).

### Common Commands

```bash
bun run dev onboard      # Setup wizard (dev mode)
bun run dev              # Build web + start gateway with --watch
bun run check            # TypeScript type-check
bun test                 # Run unit + integration tests
bun run eval --verbose   # Run eval harness (L1/L2 metrics)
bun run web:dev          # Web dev server (hot reload)
```

## Code Conventions

- **TypeBox** for all tool parameter schemas (src/tools/types.ts)
- **`ghost_` prefix** on trading tool names (src/tools/trading/*.ts)
- **Explicit DI** — services created in `src/runtime.ts`, passed to tool factories
- **No singletons** — never module-level mutable state
- **No `any`** — strict TypeScript; use `unknown` + narrowing
- **Kebab-case filenames** (src/helpers/confirm-policy.ts)
- **Files < 300 LOC** — split by category (src/services/interfaces/)
- **Early returns** over deep nesting
- **Comments explain "why"**, not "what"

## Contributing

1. Fork the repo and create a feature branch off `master`.
2. Make your change with focused, well-tested commits.
3. Run `bun run check` and `bun test` before opening a PR.
4. Open a pull request against `master` with a clear description and any relevant screenshots/logs.

For development conventions (architecture, tech stack, database migrations, coding rules), see `CLAUDE.md`.

## How to Add...

| Target | See | Key Notes |
|--------|-----|-----------|
| Generic tool | [docs/reference/tools.md](./reference/tools.md) | TypeBox + Result wrapper + register in index.ts |
| Trading tool | [docs/reference/tools.md](./reference/tools.md) | Use `ghost_` prefix; confirmable if write op |
| Service | [docs/reference/services.md](./reference/services.md) | DI from runtime.ts; interface in services/interfaces/ |
| Channel | [docs/reference/channels.md](./reference/channels.md) | Extend BaseChannel; implement start/stop/send |
| Skill | [docs/contributing/skills-authoring.md](./contributing/skills-authoring.md) | Builtin in src/skills/builtin/; workspace in ~/.ghost/workspace/skills/ |
| RPC method | [docs/reference/gateway-protocol.md](./reference/gateway-protocol.md) | Register in method-registry.ts; wire in gateway/index.ts |
| DB migration | [docs/reference/migrations.md](./reference/migrations.md) | Never edit database.ts; add Migration to registry.ts; monotonic version |

## Testing

- **Unit & Integration:** `bun test` (tests/ mirrors src/)
- **Eval Harness:** `bun run eval --verbose` (L1: tool execution, L2: 6-dim behavior)
- **Per-file:** `bun test tests/gateway/chat.test.ts`

See [docs/operations/eval.md](./operations/eval.md) for eval model (24 max score: 4 dims × 6 levels).

## Commits & Release

### Commit Format

Conventional commits: `prefix(scope): description`

Prefixes: `feat`, `fix`, `refactor`, `chore`, `test`, `docs`. Subject < 70 chars; use HEREDOC for multiline. NO AI references.

```bash
git commit -m "$(cat <<'EOF'
feat(tools): add ghost_liquidate_position

Closes issues when margin drops below critical level.
Requires explicit user confirmation; fires alert on execution.
EOF
)"
```

### Release Model

Releases are not published while Ghost is in early access. Contributors run from the development clone. See [docs/operations/update.md](./operations/update.md).

## Principles

- **KISS** — Keep It Simple, Stupid
- **YAGNI** — You Aren't Gonna Need It
- **DRY** — Don't Repeat Yourself
