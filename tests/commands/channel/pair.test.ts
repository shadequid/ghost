import { describe, test, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { initDatabase } from "../../../src/core/database.js";
import { PairingStore } from "../../../src/pairing/store.js";
import { runChannelCli } from "../../../src/commands/channel/index.js";
import { runChannelPairListAll, runChannelPairApprove } from "../../../src/commands/channel/pair.js";
import { getDbPath } from "../../../src/config/paths.js";
import { CHANNEL_PLUGINS } from "../../../src/channels/index.js";
import type { CommandIO } from "../../../src/commands/shared.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIO(): { io: CommandIO; logs: string[]; errs: string[] } {
  const logs: string[] = [];
  const errs: string[] = [];
  const io: CommandIO = {
    log: (m) => logs.push(m),
    err: (m) => errs.push(m),
    exit: (code) => { throw new Error(`__EXIT__${code}`); },
  };
  return { io, logs, errs };
}

/** Spy console + process.exit so dispatcher (which uses STDIO -> console + process.exit)
 *  can be tested without poisoning the test runner. */
function trapConsole(): {
  logs: string[];
  errs: string[];
  restore: () => void;
} {
  const logs: string[] = [];
  const errs: string[] = [];
  const logSpy = spyOn(console, "log").mockImplementation((m: unknown) => { logs.push(String(m)); });
  const errSpy = spyOn(console, "error").mockImplementation((m: unknown) => { errs.push(String(m)); });
  const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`__EXIT__${code ?? 0}`);
  }) as never);
  return {
    logs, errs,
    restore: () => { logSpy.mockRestore(); errSpy.mockRestore(); exitSpy.mockRestore(); },
  };
}

/** Point GHOST_HOME at a fresh tmpdir so `getDbPath()` resolves to an
 *  isolated SQLite file per test. */
function withTmpGhostHome(): { home: string; restore: () => void } {
  const saved = process.env["GHOST_HOME"];
  const home = join(tmpdir(), `ghost-cli-pair-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(home, { recursive: true });
  process.env["GHOST_HOME"] = home;
  return {
    home,
    restore: () => {
      if (saved === undefined) delete process.env["GHOST_HOME"];
      else process.env["GHOST_HOME"] = saved;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function openStore(): { db: Database; store: PairingStore } {
  const db = initDatabase(getDbPath());
  const store = new PairingStore(db, { warn: () => {}, debug: () => {} } as never);
  return { db, store };
}

// ---------------------------------------------------------------------------
// Dispatcher: pair approve (no channel) → must fail with usage error
// ---------------------------------------------------------------------------

describe("runChannelCli pair — approve requires explicit channel", () => {
  let consoleTrap: ReturnType<typeof trapConsole>;
  let tmp: ReturnType<typeof withTmpGhostHome>;

  beforeEach(() => {
    consoleTrap = trapConsole();
    tmp = withTmpGhostHome();
  });
  afterEach(() => { consoleTrap.restore(); tmp.restore(); });

  test("pair approve (no channel) → stderr contains usage message, exits 1", async () => {
    await expect(runChannelCli("pair", ["approve"], {})).rejects.toThrow("__EXIT__1");
    expect(consoleTrap.errs[0]).toContain("Usage: ghost channel pair <channel> approve");
    expect(consoleTrap.errs[0]).toContain("telegram");
  });

  test("pair approve <something> where something is not a known channel → same error", async () => {
    // Dispatcher checks first === "approve" before channel resolution, so the
    // guard fires regardless of what follows.
    await expect(runChannelCli("pair", ["approve", "ABC123"], {})).rejects.toThrow("__EXIT__1");
    expect(consoleTrap.errs[0]).toContain("Usage: ghost channel pair <channel> approve");
  });

  test("pair <unknown-channel> → stderr Unknown channel, exits 1", async () => {
    await expect(runChannelCli("pair", ["discord"], {})).rejects.toThrow("__EXIT__1");
    expect(consoleTrap.errs[0]).toContain("Unknown channel: discord");
    expect(consoleTrap.errs[0]).toContain("telegram");
  });
});

// ---------------------------------------------------------------------------
// runChannelPairListAll — empty + with pending
// ---------------------------------------------------------------------------

describe("runChannelPairListAll", () => {
  let tmp: ReturnType<typeof withTmpGhostHome>;
  beforeEach(() => { tmp = withTmpGhostHome(); });
  afterEach(() => { tmp.restore(); });

  test("no pending requests → logs 'No pending pairing requests on any channel.'", async () => {
    const { io, logs } = makeIO();
    await runChannelPairListAll({ io });
    expect(logs[0]).toBe("No pending pairing requests on any channel.");
  });

  test("json: true with no pending → logs valid JSON with empty pending array", async () => {
    const { io, logs } = makeIO();
    await runChannelPairListAll({ io, json: true });
    const parsed = JSON.parse(logs[0]) as { pending: unknown[] };
    expect(Array.isArray(parsed.pending)).toBe(true);
    expect(parsed.pending).toHaveLength(0);
  });

  test("one telegram request → header contains 'Telegram (telegram)' + code + @alice + approve hint", async () => {
    const { db, store } = openStore();
    const result = store.upsertRequest({ channel: "telegram", senderId: "123456", username: "alice" });
    if (result.kind !== "created") throw new Error("expected created");
    const code = result.code;
    db.close();

    const { io, logs } = makeIO();
    await runChannelPairListAll({ io });

    expect(logs.some((l) => l.includes("Telegram (telegram)"))).toBe(true);
    const codeLine = logs.find((l) => l.includes(code));
    expect(codeLine).toBeDefined();
    expect(codeLine).toContain("@alice");
    expect(logs.some((l) => l.includes("ghost channel pair <channel> approve <code>"))).toBe(true);
  });

  test("json: true with telegram pending → valid JSON with pending entry", async () => {
    const { db, store } = openStore();
    const result = store.upsertRequest({ channel: "telegram", senderId: "777" });
    if (result.kind !== "created") throw new Error("expected created");
    db.close();

    const { io, logs } = makeIO();
    await runChannelPairListAll({ io, json: true });
    const parsed = JSON.parse(logs[0]) as { pending: Array<{ channel: string; requests: unknown[] }> };
    expect(parsed.pending).toHaveLength(1);
    expect(parsed.pending[0].channel).toBe("telegram");
    expect(parsed.pending[0].requests).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Lock single-use approve: real in-memory PairingStore
// Verifies approveRequest is idempotent in the DELETE-row sense — the second
// call returns null because the row is already gone from pairing_requests.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// runChannelPairApprove — notifies the user in-channel on success
// ---------------------------------------------------------------------------

describe("runChannelPairApprove — in-channel notification (mirrors web flow)", () => {
  let tmp: ReturnType<typeof withTmpGhostHome>;
  let notifySpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tmp = withTmpGhostHome();
    const telegramPlugin = CHANNEL_PLUGINS.find((p) => p.id === "telegram")!;
    notifySpy = spyOn(telegramPlugin, "notifyApproval");
  });
  afterEach(() => { notifySpy.mockRestore(); tmp.restore(); });

  test("on successful approve, plugin.notifyApproval is called with the user's id", async () => {
    notifySpy.mockImplementation(async () => undefined);
    const { db, store } = openStore();
    const r = store.upsertRequest({ channel: "telegram", senderId: "555", username: "carol" });
    if (r.kind !== "created") throw new Error("expected created");
    db.close();

    const { io } = makeIO();
    await runChannelPairApprove({ channel: "telegram", codeArg: r.code, isTTY: false, io });

    expect(notifySpy).toHaveBeenCalledTimes(1);
    const arg = notifySpy.mock.calls[0]![0] as { id: string };
    expect(arg.id).toBe("555");
  });

  test("notify failure does NOT roll back the approve — emits a warning instead", async () => {
    notifySpy.mockImplementation(async () => { throw new Error("network down"); });
    const { db, store } = openStore();
    const r = store.upsertRequest({ channel: "telegram", senderId: "666" });
    if (r.kind !== "created") throw new Error("expected created");
    db.close();

    const { io, logs, errs } = makeIO();
    await runChannelPairApprove({ channel: "telegram", codeArg: r.code, isTTY: false, io });

    // Approve still logged success line
    expect(logs.some((l) => l.startsWith("✓ Approved telegram pairing"))).toBe(true);
    // But the notify error surfaced on stderr
    expect(errs.some((e) => e.includes("notification failed: network down"))).toBe(true);
  });
});

describe("PairingStore.approveRequest — single-use guarantee", () => {
  let store: PairingStore;
  let db: Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
    store = new PairingStore(db, { warn: () => {}, debug: () => {} } as never);
  });
  afterEach(() => { db.close(); });

  test("first approve returns the row; second approve returns null", () => {
    const result = store.upsertRequest({ channel: "telegram", senderId: "999", username: "bob" });
    if (result.kind !== "created") throw new Error("expected created");
    const { code } = result;

    const first = store.approveRequest("telegram", code);
    expect(first).not.toBeNull();
    expect(first!.id).toBe("999");

    const second = store.approveRequest("telegram", code);
    expect(second).toBeNull();
  });

  test("row is absent from listRequests after first approve", () => {
    const result = store.upsertRequest({ channel: "telegram", senderId: "777" });
    if (result.kind !== "created") throw new Error("expected created");
    const { code } = result;

    store.approveRequest("telegram", code);

    const remaining = store.listRequests("telegram");
    expect(remaining.find((r) => r.code === code)).toBeUndefined();
  });
});
