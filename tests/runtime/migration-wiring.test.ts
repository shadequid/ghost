import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { DB_MIGRATIONS } from "../../src/core/migrations/registry.js";
import { createRuntime } from "../../src/runtime.js";
import { NOOP_LOGGER } from "../../src/logger.js";

/**
 * Integration-level coverage for the migration + runtime
 * composition path. Existing unit tests cover runDbMigrations and
 * runConfigMigrations in isolation, but don't verify the composition —
 * i.e., that createRuntime:
 *
 *   1. loads the raw config,
 *   2. runs config migrations,
 *   3. saves the config back when dirty,
 *   4. opens the DB,
 *   5. runs DB migrations,
 *   6. leaves user_version at the highest applied version.
 *
 * Each of the six steps is checked below against a runtime built from a
 * fresh GHOST_HOME-rooted temp dir.
 */

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "ghost-mig-wire-"));
}

describe("createRuntime() migration wiring", () => {
  const tempDirs: string[] = [];
  let savedGhostHome: string | undefined;

  afterEach(() => {
    if (savedGhostHome === undefined) delete process.env["GHOST_HOME"];
    else process.env["GHOST_HOME"] = savedGhostHome;
    savedGhostHome = undefined;
    for (const dir of tempDirs) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  test("bumps PRAGMA user_version via migration runner on fresh DB", async () => {
    const home = makeTempHome();
    tempDirs.push(home);
    savedGhostHome = process.env["GHOST_HOME"];
    process.env["GHOST_HOME"] = home;

    const configPath = join(home, "config.json");
    writeFileSync(configPath, "{}");

    const runtime = await createRuntime({ configPath, logger: NOOP_LOGGER });
    try {
      // Migration runner advances user_version to the latest registered
      // migration. Pin the assertion to whatever DB_MIGRATIONS exposes so
      // the test keeps working as new schema versions land.
      const row = runtime.db
        .query("PRAGMA user_version")
        .get() as { user_version: number } | null;
      const latest = DB_MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
      expect(row?.user_version).toBe(latest);
    } finally {
      runtime.db.close();
    }
  });

  test("config migrations apply and the config file is saved when dirty", async () => {
    const home = makeTempHome();
    tempDirs.push(home);
    savedGhostHome = process.env["GHOST_HOME"];
    process.env["GHOST_HOME"] = home;

    // Seed a legacy config with no schemaVersion — loadConfig defaults
    // schemaVersion to 1. All pending migrations run, bump schemaVersion to
    // the latest, and write the file back.
    const configPath = join(home, "config.json");
    writeFileSync(configPath, JSON.stringify({ provider: "openrouter" }));

    const runtime = await createRuntime({ configPath, logger: NOOP_LOGGER });
    try {
      // schemaVersion is set to the latest migration version after running
      expect(runtime.config.schemaVersion).toBeGreaterThanOrEqual(2);
      // File must be updated since migrations ran.
      const saved = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      expect(typeof saved["schemaVersion"]).toBe("number");
      expect((saved["schemaVersion"] as number)).toBeGreaterThanOrEqual(2);
    } finally {
      runtime.db.close();
    }
  });

  test("db migrations run in createRuntime — verified by re-opening the DB", async () => {
    const home = makeTempHome();
    tempDirs.push(home);
    savedGhostHome = process.env["GHOST_HOME"];
    process.env["GHOST_HOME"] = home;

    const configPath = join(home, "config.json");
    writeFileSync(configPath, "{}");

    const runtime = await createRuntime({ configPath, logger: NOOP_LOGGER });
    const dbPath = (runtime.db as unknown as { filename: string }).filename;
    runtime.db.close();

    // Re-open the DB independently and confirm the migration-applied
    // state survived (user_version set by our runner, not by legacy
    // ad-hoc code).
    const reopened = new Database(dbPath);
    try {
      const row = reopened
        .query("PRAGMA user_version")
        .get() as { user_version: number } | null;
      const latest = DB_MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
      expect(row?.user_version).toBe(latest);
    } finally {
      reopened.close();
    }
  });

  // ghost_session_info must be registered after createRuntime so the
  // proactive-advisor and briefing skills can call it at Step 1 of the idle gate.
  // This integration test prevents a repeat of the earlier omission where
  // createSessionInfoTool was exported but never wired into any tool registry.
  test("ghost_session_info tool is non-null in tools registry after runtime boot", async () => {
    const home = makeTempHome();
    tempDirs.push(home);
    savedGhostHome = process.env["GHOST_HOME"];
    process.env["GHOST_HOME"] = home;

    const configPath = join(home, "config.json");
    writeFileSync(configPath, "{}");

    const runtime = await createRuntime({ configPath, logger: NOOP_LOGGER });
    try {
      const tool = runtime.tools.get("ghost_session_info");
      expect(tool).not.toBeNull();
      expect(tool).not.toBeUndefined();
      expect((tool as { name: string } | null)?.name).toBe("ghost_session_info");
    } finally {
      runtime.db.close();
    }
  });

  // 5 intel tools that were previously unregistered must appear in the tool
  // registry after createRuntime. Each tool is backed by a new service
  // (whaleTracking, liquidationMap, timingRisk, crossExchange, cronService).
  test("intel tools are registered in tools registry after runtime boot", async () => {
    const home = makeTempHome();
    tempDirs.push(home);
    savedGhostHome = process.env["GHOST_HOME"];
    process.env["GHOST_HOME"] = home;

    const configPath = join(home, "config.json");
    writeFileSync(configPath, "{}");

    const runtime = await createRuntime({ configPath, logger: NOOP_LOGGER });
    try {
      const expectedTools = [
        "ghost_cross_exchange_funding",
        "ghost_liquidation_map",
        "ghost_timing_risk",
        "ghost_morning_briefing",
        "ghost_get_whale_activity",
        "ghost_chat_history",
      ];
      for (const toolName of expectedTools) {
        const tool = runtime.tools.get(toolName);
        expect(tool).not.toBeNull();
        expect(tool).not.toBeUndefined();
        expect((tool as { name: string } | null)?.name).toBe(toolName);
      }
    } finally {
      runtime.db.close();
    }
  });
});
