# Database Migrations

Migrations evolve schema without editing `src/core/database.ts` (frozen baseline). Migration runner applies pending migrations on every `createRuntime()` call on startup. All up() functions must be idempotent.

Source: `src/core/migrations/registry.ts`

**Current:** 8 migrations (v1-v8). Next version: 9.

## How to Add a Migration

### Step 1: Define in registry.ts

```typescript
const exampleMigration: Migration<Database> = {
  version: 9,  // Monotonic increment
  label: "add_example_column",
  up: (db) => {
    db.run(`ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active' IF NOT EXISTS`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)`);
  },
};
```

### Step 2: Append to DB_MIGRATIONS array (in order)

```typescript
export const DB_MIGRATIONS: ReadonlyArray<Migration<Database>> = [
  baselineDbMigration,
  // ... existing migrations ...
  exampleMigration,  // NEW
];
```

Array order MUST match version numbers (ascending). Registry validates on startup.

### Step 3: Test

```bash
rm ~/.ghost/workspace/brain.db
bun run dev daemon  # Runs baseline + all migrations
sqlite3 ~/.ghost/workspace/brain.db ".schema users"
```

## Rules

- **Idempotency:** Always use `IF NOT EXISTS`, `IF NOT ADDED` (SQLite 3.35.0+).
- **One-way:** Migrations never roll back. Restore from backup to undo.
- **Parametrize:** Use `db.prepare()` for INSERT/UPDATE/DELETE to avoid SQL injection.
- **Sync or async:** `up()` can be either; runners `await` the result.

## Common Patterns

**Add column:**
```typescript
db.run(`ALTER TABLE table_name ADD COLUMN col_name TEXT DEFAULT '' IF NOT EXISTS`);
```

**Create table:**
```typescript
db.run(`CREATE TABLE IF NOT EXISTS table_name (id TEXT PRIMARY KEY, created_at INTEGER)`);
```

**Rename column (SQLite):**
```typescript
// Create new schema, copy data, drop old, rename
```

See `src/core/migrations/registry.ts` for examples.
