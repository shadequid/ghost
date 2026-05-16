import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { CliHandoffStore } from "../../../src/providers/claude-cli/handoff-store.js";
import type { CliSessionState } from "../../../src/providers/claude-cli/handoff-store.js";
import { NOOP_LOGGER } from "../../../src/logger.js";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("CliHandoffStore", () => {
  let dir: string;
  let filePath: string;
  let store: CliHandoffStore;

  beforeEach(() => {
    dir = join(tmpdir(), `ghost-handoff-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, "cli-handoff.json");
    store = new CliHandoffStore(filePath, NOOP_LOGGER);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("load returns null when file missing", () => {
    expect(store.load()).toBeNull();
  });

  test("load returns null when file contains invalid JSON", () => {
    writeFileSync(filePath, "not json{{{");
    expect(store.load()).toBeNull();
  });

  test("load returns null when file has wrong version", () => {
    // Version 1 files (old format without sessionId) are silently discarded
    writeFileSync(filePath, JSON.stringify({ version: 1, systemPromptHash: "a", syncedCount: 1 }));
    expect(store.load()).toBeNull();
  });

  test("load returns null when file has unknown version", () => {
    writeFileSync(filePath, JSON.stringify({ version: 999, systemPromptHash: "a", syncedCount: 1 }));
    expect(store.load()).toBeNull();
  });

  test("save then load round-trip with sessionId", () => {
    const state: CliSessionState = { sessionId: "sid-abc-123", systemPromptHash: "abc123", syncedCount: 42 };
    store.save(state);
    const loaded = store.load();
    expect(loaded).toEqual(state);
  });

  test("save then load round-trip with null sessionId", () => {
    const state: CliSessionState = { sessionId: null, systemPromptHash: "hash456", syncedCount: 0 };
    store.save(state);
    const loaded = store.load();
    expect(loaded).toEqual(state);
  });

  test("save creates parent directory if missing", () => {
    const nested = join(dir, "sub", "deep", "cli-handoff.json");
    const nestedStore = new CliHandoffStore(nested, NOOP_LOGGER);
    const state: CliSessionState = { sessionId: "sid-xyz", systemPromptHash: "x", syncedCount: 1 };
    nestedStore.save(state);
    expect(existsSync(nested)).toBe(true);
    expect(nestedStore.load()).toEqual(state);
  });

  test("clear removes file", () => {
    const state: CliSessionState = { sessionId: "sid-abc", systemPromptHash: "abc", syncedCount: 5 };
    store.save(state);
    expect(existsSync(filePath)).toBe(true);
    store.clear();
    expect(existsSync(filePath)).toBe(false);
    expect(store.load()).toBeNull();
  });

  test("clear succeeds when file already missing", () => {
    expect(() => store.clear()).not.toThrow();
  });

  test("sessionId is persisted and survives round-trip", () => {
    const state: CliSessionState = {
      sessionId: "session-resume-token-deadbeef",
      systemPromptHash: "prompt-hash",
      syncedCount: 10,
    };
    store.save(state);
    const loaded = store.load();
    expect(loaded?.sessionId).toBe("session-resume-token-deadbeef");
    expect(loaded?.syncedCount).toBe(10);
    expect(loaded?.systemPromptHash).toBe("prompt-hash");
  });
});
