# Database Schema Reference

SQLite database (WAL mode) at `~/.ghost/workspace/brain.db`. Created idempotently by `initDatabase()` in `src/core/database.ts`, evolved via migrations in `src/core/migrations/registry.ts`.

**Key rule:** Never edit `src/core/database.ts` to change schema. Use migrations instead. See [migrations.md](./migrations.md).

## Schema Overview

18 tables organized by category:

| Category | Purpose |
|----------|---------|
| Watchlist/alerts/notifications | User prefs, price targets, event log |
| News/tweets | Aggregated feeds |
| Sessions/devices/pairing | Auth state |
| Cost telemetry | Request caching, token billing |
| Observer state | Scanner baseline |
| Settings KV | Generic key-value prefs |

## Backup

```bash
sqlite3 ~/.ghost/workspace/brain.db "VACUUM INTO '/tmp/ghost-backup.db'"
sqlite3 ~/.ghost/workspace/brain.db "PRAGMA integrity_check"
```

WAL mode allows concurrent reads during writes. Temp files (`.wal`, `.shm`) auto-clean on next write after daemon stops.

## Source of Truth

Schema baseline: `src/core/database.ts` (frozen; never edit).
Schema changes: `src/core/migrations/registry.ts` (monotonic version, idempotent, one-way).

For details on adding a migration, see [migrations.md](./migrations.md).
