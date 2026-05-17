# CLI Commands Reference

All commands run via the `ghost` binary, available after `bun install -g @hyperflow.fun/ghost`.

## Core Commands

### ghost daemon

Start the Ghost gateway, Telegram channel, and scheduler in the foreground.

```bash
ghost daemon                    # Start on port 15401
ghost daemon --paper            # Paper trading ($10,000 USDC)
ghost daemon --paper -b 50000   # Paper trading with custom balance
ghost daemon stop               # Stop the background service (interactive confirm)
```

Access the dashboard at `http://localhost:15401`. Press `Ctrl+C` to stop a foreground daemon.

### ghost onboard

Setup wizard to configure provider, model, and trading mode.

```bash
ghost onboard                           # Interactive wizard
ghost onboard --paper                   # Wizard + paper mode
ghost onboard --paper -b 50000          # Wizard + paper, custom balance
ghost onboard --service                 # Register the OS service
GHOST_API_KEY=<key> ghost onboard --provider openai --model gpt-4o
                                        # Non-interactive
```

Re-run anytime to change provider / model.

### ghost status

Show current config and auth status.

```bash
ghost status
```

Output: provider/model, auth method, gateway URL, Telegram status.

### ghost doctor

Full diagnostic of config, database, and provider connectivity.

```bash
ghost doctor
```

Verifies: config loads, DB opens, provider responds, custom models parse correctly.

## Provider & Models

### ghost providers

List all available LLM providers.

```bash
ghost providers
```

Returns JSON with provider IDs, names, and models.

### ghost providers --models <id>

List models available for a specific provider.

```bash
ghost providers --models anthropic     # Show Claude models
ghost providers --models openai        # Show GPT models
```

Returns JSON with model IDs and metadata.

## Skills

### ghost skills list

List available skills and their status.

```bash
ghost skills list
```

Shows built-in and workspace skills, status (ok / missing deps), and descriptions.

## Channels

### ghost channel setup <id>

Configure a channel bot token (Telegram, etc).

```bash
ghost channel setup telegram                    # Interactive prompt
ghost channel setup telegram --token=<token>    # Non-interactive
```

### ghost channel status

Show all active channel connections.

```bash
ghost channel status
```

### ghost channel pair

List and approve device pairing requests.

```bash
ghost channel pair                              # All pending across channels
ghost channel pair telegram                     # Telegram-only
ghost channel pair telegram approve             # Interactive picker
ghost channel pair telegram approve <code>      # Approve a specific code
```

Pairing allows web dashboard or mobile to connect securely.

## Update & Lifecycle

### ghost update

Check the npm registry for a newer version and reinstall in place.

```bash
ghost update                  # Stable channel
ghost update --channel=rc     # Release candidates
```

### ghost logs

Stream service logs in real-time.

```bash
ghost logs    # Ctrl+C to stop
```

### ghost uninstall

Remove the OS service and all data in `~/.ghost/`.

```bash
ghost uninstall
```

Prints the one-line command to also remove the bun package at the end.

### ghost --version

```bash
ghost --version
```

## Proactive Advisor

### ghost proactive on|off|status

Enable / disable the proactive advisor (requires daemon restart).

```bash
ghost proactive status     # Show current setting
ghost proactive on         # Enable
ghost proactive off        # Disable
```

Proactive advisor watches your positions and alerts you to risk even when you're not asking.

---

All commands support `-c <path>` or `--config=<path>` to use a custom config file. Environment variables: `GHOST_API_KEY` (API key for providers), `LOG_LEVEL` (override log level: trace / debug / info / warn / error).

For detailed workflow guides, see [Asking Ghost](./asking-ghost.md).
