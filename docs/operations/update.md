# Update

Ghost ships as the [`@hyperflow.fun/ghost`](https://www.npmjs.com/package/@hyperflow.fun/ghost) package on npm. Updates are in-place and preserve your config, wallets, chat history, memory, and skills under `~/.ghost/`.

## Update Procedure

```bash
ghost update
```

This checks the npm registry for a newer version on your current channel (default `latest`) and reinstalls in place.

Switch channels with the `--channel` flag:

```bash
ghost update --channel=rc      # Release candidates
ghost update --channel=latest  # Back to stable
```

If `ghost update` fails (e.g. the binary is broken), reinstall manually:

```bash
npm install -g @hyperflow.fun/ghost@latest
```

## Version Check Service

The in-process `VersionCheckService` (`src/update/version-check.ts`) polls the npm registry on a 1-hour TTL and surfaces an update hint in the CLI. It honors:

- `GHOST_REGISTRY` — override the registry URL (useful for an internal mirror or test fixtures)
- `GHOST_UPDATE_CHECK_TTL_MS` — TTL in ms (default 3,600,000)
- `GHOST_UPDATE_CHECK_NULL_RETRY_MS` — short retry window after a failed fetch (default 60,000), so offline boots recover quickly once the network returns

Failures (network down, non-200, malformed body) cache `null` for the short retry window and never throw.

## What Update Touches

| Path | Action |
|------|--------|
| `~/.bun/install/global/node_modules/@hyperflow.fun/ghost` | Replaced |
| `~/.ghost/` | **Untouched** — your data is safe |
| OS service definition | Refreshed if it points at a now-stale binary path |

If you ran `ghost onboard --service` (or selected "Yes" at the install prompt), the OS service stays registered across updates. Restart it explicitly only if a release notes that change is required.
