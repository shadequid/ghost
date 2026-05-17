# Troubleshooting Guide

Quick reference for common Ghost issues, diagnostics, and solutions.

## Symptom → Cause → Fix Matrix

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| Daemon won't start | Config missing or invalid | Run `ghost onboard` to generate config |
| Daemon won't start | Port 15401 already in use | Kill the process or change `gateway.host:port` in config |
| Daemon starts but exits | Provider unreachable | Check API key / network; run `ghost doctor` |
| "Wallet not connected" | Hyperliquid client not ready | Wait 10s; if persists, check Hyperliquid API is live |
| OAuth callback fails | Browser won't open or wrong URL | Check `gateway.host` matches your network; ensure loopback or external auth enabled |
| Paper balance resets on restart | Paper state not persisted | DB file deleted; restart with `ghost daemon --paper -b <amount>` to reinit |
| Observer silent (no alerts) | Observer disabled or REST lag | Check `observer.enabled: true`; verify `syncIntervalMs` is ≤ 60s |
| Observer too noisy | Liquidation threshold too low | Increase `liquidationProgressThreshold` to 0.9; increase `tickMs` to 10000 |
| Skill not loaded | Skill file missing or disabled | Check `ghost skills list`; enable via web |
| Memory consolidation never fires | Session token budget not exceeded | Normal behavior for light users; consolidation only runs when budget fills |
| Telegram pairing stuck | Challenge code expired (60 min) | User requests a new challenge via `/start` |
| "Wrong code" on pairing | Code doesn't match pending request | Verify 8-char code is exactly right; try `/start` again |
| Custom model not appearing | Model file missing or invalid JSON | Check `~/.ghost/models.json` exists and is valid; see `docs/providers/CUSTOM_MODELS.md` |
| "Permission denied" on Linux/macOS | Insufficient write perms to home dir | Verify ownership: `ls -la ~/.ghost/`; fix with `chown -R $USER ~/.ghost` |
| WebSocket events out of order | High concurrency (maxConcurrentRequests > 1) | Increase `dispatcher.maxConcurrentRequests` or ensure stream markers are respected |
| `bun install` fails on Linux | Missing build tools | Install build tools: `sudo apt-get install build-essential` (Debian/Ubuntu) |
| Web dashboard won't load | Web deps not installed | Run `cd web && bun install && cd ..` |
| Daemon won't start after clone | Missing dependencies | Run `bun install` from repo root |

## Diagnostics

### `ghost status`

Displays config snapshot without sensitive data:

```
Provider:        anthropic
Model:           claude-3-5-sonnet-20241022
Gateway:         http://127.0.0.1:15401
Autonomy:        observer
```

Shows: provider, selected model, gateway URL, autonomy level.

### `ghost doctor`

Full health check (runs automatically on daemon start):

```
Config:          OK
Database:        OK (schema v3)
Provider:        OK (key present)
Wallet:          OK (connected to Hyperliquid)
```

Checks: config validity, DB integrity, provider auth, live wallet connection.

### Verbose Logging

| Flag | Behavior |
|------|----------|
| `ghost daemon -v` | Debug level; tool calls, context builder steps logged |
| `ghost daemon -vv` | Trace level; detailed state transitions, all internal ops |
| `LOG_LEVEL=warn ghost daemon` | Override to warn+ only (suppress debug/trace) |

**Log Location:** `~/.ghost/logs/` (pino JSON format)

### ~/.ghost/ Directory Layout

```
~/.ghost/
├── config.json                    # Config (Zod-validated, secrets encrypted)
├── SECRET                         # Master encryption key (0o600)
├── db                            # SQLite maindb (skill_states, channel_allowlist, alert_rules)
├── workspace/
│   ├── SOUL.md                   # System prompt (user-editable)
│   ├── memory/
│   │   ├── MEMORY.md            # Long-term facts
│   │   └── HISTORY.md           # Consolidated chunks log
│   ├── skills/                   # User-created or uploaded skills
│   ├── paper-trading.db         # Paper engine state (if enabled)
│   └── sessions/                # JSONL chat histories
├── logs/                         # Pino structured logs (rotate daily)
└── credentials.json              # OAuth tokens, API keys (encrypted)
```

### Network & Port Diagnostics

Verify gateway is listening:

```bash
curl -s http://localhost:15401/health
# Expected: {"status": "ok"} or similar
```

For public binding, see [Security: Network Exposure](./security/network-exposure.md) for Cloudflare Tunnel, Tailscale, ngrok recipes.

## Provider-Specific Gotchas

### Claude Code (claude-cli)

- **Requires:** Claude Code subscription (no API key).
- **Issue:** "Provider not available" → Ensure `claude-cli` binary is in PATH: `which claude-cli`.
- **Workaround:** Use API-based Anthropic provider instead.

### Anthropic (API)

- **Auth:** API key OR OAuth (both supported).
- **Issue:** "Invalid API key" → Regenerate at https://console.anthropic.com/account/keys.
- **Rate limit:** Check your account tier; free trial has strict limits.

### OpenRouter

- **Auth:** API key required.
- **Issue:** "Rate limited" → OpenRouter enforces per-model and global RPM limits. Reduce request volume or upgrade tier.
- **Model selection:** OpenRouter supports 100+ models; use `ghost providers --models openrouter` to list.

### Google Gemini

- **Auth:** API key only (OAuth not supported).
- **Issue:** "API key invalid" → Generate at https://aistudio.google.com/apikey.
- **Quota:** Free tier has strict daily limits; pay-as-you-go available.

### OpenAI

- **Auth:** API key required.
- **Issue:** "Invalid API key" → Check expiration and organization assignment at https://platform.openai.com/account/api-keys.
- **Model:** Default is gpt-4o; supports gpt-4, gpt-4-turbo, gpt-3.5-turbo.

### Custom Models (Ollama / vLLM / LM Studio)

- **Setup:** Run Ollama, vLLM, or LM Studio locally and note the base URL.
- **Config:** Run `ghost onboard`, select Custom, enter base URL.
- **File:** Settings written to `~/.ghost/models.json`.
- **Authoritative source:** See [docs/providers/CUSTOM_MODELS.md](./providers/CUSTOM_MODELS.md) for full schema and examples.
- **Issue:** "Connection refused" → Verify endpoint is running and accessible at the URL you configured.

## Recovery Workflows

### Reset All State

```bash
# Stop any running daemon (Ctrl+C if running in foreground)
rm -rf ~/.ghost/
ghost onboard    # Start fresh
```

### Preserve Config, Reset Data

```bash
# Stop any running daemon (Ctrl+C if running in foreground)
rm -rf ~/.ghost/db ~/.ghost/workspace/
ghost daemon --paper    # Restarts with new DB and empty memory
```

### Export Chat History

Sessions are stored as JSONL in `~/.ghost/workspace/sessions/`. Export directly:

```bash
cat ~/.ghost/workspace/sessions/main.jsonl | jq -r '.content'
```

### Collect Logs for Support

```bash
tar -czf ghost-logs.tar.gz ~/.ghost/logs/
# Send to support with detailed description of issue
```
