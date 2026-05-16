# CLI Commands Reference

All commands run via `bun run dev <subcommand>` from the repository root. There is no `ghost` binary on PATH in early access.

## Core Commands

### bun run dev daemon

Start the Ghost gateway, Telegram channel, and scheduler.

```bash
bun run dev daemon                    # Start on port 15401
bun run dev daemon --paper            # Paper trading ($10,000 USDC)
bun run dev daemon --paper -b 50000   # Paper trading with custom balance
```

Access the dashboard at `http://localhost:15401`. Press `Ctrl+C` to stop.

### bun run dev onboard

Setup wizard to configure provider, model, and trading mode.

```bash
bun run dev onboard                           # Interactive wizard
bun run dev onboard --paper                   # Wizard + paper mode
bun run dev onboard --paper -b 50000          # Wizard + paper, custom balance
GHOST_API_KEY=<key> bun run dev onboard --provider openai --model gpt-4o
                                              # Non-interactive
```

Re-run anytime to change provider/model.

### bun run dev status

Show current config and auth status.

```bash
bun run dev status
```

Output: provider/model, auth method, gateway URL, Telegram status.

### bun run dev doctor

Full diagnostic of config, database, and provider connectivity.

```bash
bun run dev doctor
```

Verifies: config loads, DB opens, provider responds, custom models parse correctly.

## Provider & Models

### bun run dev providers

List all available LLM providers.

```bash
bun run dev providers
```

Returns JSON with provider IDs, names, and models.

### bun run dev providers --models <id>

List models available for a specific provider.

```bash
bun run dev providers --models anthropic     # Show Claude models
bun run dev providers --models openai        # Show GPT models
```

Returns JSON with model IDs and metadata.

## Skills

### bun run dev skills list

List available skills and their status.

```bash
bun run dev skills list
```

Shows built-in and workspace skills, status (ok/missing deps), descriptions.

## Channels

### bun run dev channel setup <id>

Configure a channel bot token (Telegram, etc).

```bash
bun run dev channel setup telegram                    # Interactive prompt
bun run dev channel setup telegram --token=<token>    # Non-interactive
```

### bun run dev channel status

Show all active channel connections.

```bash
bun run dev channel status
```

Lists connected channels (Telegram, web, etc) with summary.

### bun run dev channel pair

List and approve device pairing requests.

```bash
bun run dev channel pair                              # All pending across channels
bun run dev channel pair telegram                     # Telegram-only
bun run dev channel pair telegram approve             # Interactive picker
bun run dev channel pair telegram approve <code>      # Approve specific code
```

Pairing allows web dashboard or mobile to connect securely.

## Version & Logs

### bun run dev logs

Stream service logs in real-time.

```bash
bun run dev logs    # Ctrl+C to stop
```

Useful for debugging connection issues or tracing tool calls.

## Proactive Advisor

### bun run dev proactive on|off|status

Enable/disable proactive advisor (requires daemon restart).

```bash
bun run dev proactive status     # Show current setting
bun run dev proactive on         # Enable
bun run dev proactive off        # Disable
```

Proactive advisor watches your positions and alerts you to risk even when you're not asking.

---

All commands support `-c <path>` or `--config=<path>` to use a custom config file. Environment variables: `GHOST_API_KEY` (API key for providers), `LOG_LEVEL` (override log level: trace/debug/info/warn/error).

For detailed workflow guides, see [Asking Ghost](./asking-ghost.md).
