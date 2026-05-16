import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { runDbMigrations } from "../../../src/core/migrations/db.js";
import type { Migration } from "../../../src/core/migrations/registry.js";

function readUserVersion(db: Database): number {
  const row = db.query("PRAGMA user_version").get() as
    | { user_version: number }
    | null;
  return Number(row?.user_version ?? 0);
}

describe("runDbMigrations", () => {
  test("empty migrations list is a no-op on fresh db", async () => {
    const db = new Database(":memory:");
    await runDbMigrations(db, []);
    expect(readUserVersion(db)).toBe(0);
  });

  test("applies single pending migration and bumps user_version", async () => {
    const db = new Database(":memory:");
    let called = 0;
    const migrations: Migration<Database>[] = [
      {
        version: 1,
        label: "baseline",
        up: (d) => {
          called++;
          d.run("CREATE TABLE foo (id INTEGER)");
        },
      },
    ];
    await runDbMigrations(db, migrations);
    expect(called).toBe(1);
    expect(readUserVersion(db)).toBe(1);
    // Re-running does not re-apply
    await runDbMigrations(db, migrations);
    expect(called).toBe(1);
    expect(readUserVersion(db)).toBe(1);
  });

  test("applies multiple pending migrations in ascending order", async () => {
    const db = new Database(":memory:");
    const order: number[] = [];
    const migrations: Migration<Database>[] = [
      { version: 3, label: "c", up: () => { order.push(3); } },
      { version: 1, label: "a", up: () => { order.push(1); } },
      { version: 2, label: "b", up: () => { order.push(2); } },
    ];
    await runDbMigrations(db, migrations);
    expect(order).toEqual([1, 2, 3]);
    expect(readUserVersion(db)).toBe(3);
  });

  test("skips migrations already applied", async () => {
    const db = new Database(":memory:");
    db.run("PRAGMA user_version = 2");
    const applied: number[] = [];
    const migrations: Migration<Database>[] = [
      { version: 1, label: "a", up: () => { applied.push(1); } },
      { version: 2, label: "b", up: () => { applied.push(2); } },
      { version: 3, label: "c", up: () => { applied.push(3); } },
    ];
    await runDbMigrations(db, migrations);
    expect(applied).toEqual([3]);
    expect(readUserVersion(db)).toBe(3);
  });

  test("rethrows with wrapped message and leaves user_version unchanged", async () => {
    const db = new Database(":memory:");
    const migrations: Migration<Database>[] = [
      {
        version: 1,
        label: "broken",
        up: () => {
          throw new Error("boom");
        },
      },
    ];
    await expect(runDbMigrations(db, migrations)).rejects.toThrow(
      /\[migration db v0→v1 broken\] boom/,
    );
    expect(readUserVersion(db)).toBe(0);
  });

  test("rejects duplicate version numbers", async () => {
    const db = new Database(":memory:");
    const migrations: Migration<Database>[] = [
      { version: 1, label: "a", up: () => {} },
      { version: 1, label: "b", up: () => {} },
    ];
    await expect(runDbMigrations(db, migrations)).rejects.toThrow(
      /Duplicate migration version: 1/,
    );
  });

  test("retry after fixing failing migration applies the step", async () => {
    const db = new Database(":memory:");
    let attempts = 0;
    const failing: Migration<Database>[] = [
      {
        version: 1,
        label: "flaky",
        up: () => {
          attempts++;
          throw new Error("first attempt broken");
        },
      },
    ];
    await expect(runDbMigrations(db, failing)).rejects.toThrow();
    expect(readUserVersion(db)).toBe(0);

    const fixed: Migration<Database>[] = [
      {
        version: 1,
        label: "flaky",
        up: (d) => {
          attempts++;
          d.run("CREATE TABLE fixed (id INTEGER)");
        },
      },
    ];
    await runDbMigrations(db, fixed);
    expect(attempts).toBe(2);
    expect(readUserVersion(db)).toBe(1);
    // Verify the fixed migration actually ran
    expect(db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='fixed'").get()).not.toBeNull();
  });

  test("mid-list failure preserves earlier steps' user_version", async () => {
    const db = new Database(":memory:");
    const applied: number[] = [];
    const migrations: Migration<Database>[] = [
      { version: 1, label: "a", up: () => { applied.push(1); } },
      { version: 2, label: "b", up: () => { applied.push(2); } },
      {
        version: 3,
        label: "broken",
        up: () => { throw new Error("step 3 failed"); },
      },
    ];
    await expect(runDbMigrations(db, migrations)).rejects.toThrow(
      /\[migration db v2→v3 broken\] step 3 failed/,
    );
    expect(applied).toEqual([1, 2]);
    // v1 and v2 succeeded — user_version reflects the last successful step.
    expect(readUserVersion(db)).toBe(2);
  });

  test("awaits async migration bodies", async () => {
    const db = new Database(":memory:");
    let finished = false;
    const migrations: Migration<Database>[] = [
      {
        version: 1,
        label: "async-body",
        up: async (d) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 5));
          d.run("CREATE TABLE async_ok (id INTEGER)");
          finished = true;
        },
      },
    ];
    await runDbMigrations(db, migrations);
    expect(finished).toBe(true);
    expect(readUserVersion(db)).toBe(1);
  });
});
