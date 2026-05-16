/**
 * Tests for the SDK-based claude-cli-chat stream adapter.
 *
 * Module-level ES import mocking of @anthropic-ai/claude-agent-sdk query() is
 * not supported without a full mock framework. These tests cover:
 *   - ClaudeCliStreamDeps interface shape (required fields present)
 *   - Session store integration (sessionId round-trip, drift detection)
 *   - allowedTools construction (mcp__ghost__ prefix)
 *   - Stream factory function shape (returns AssistantMessageEventStream)
 *   - shouldHandoff logic (fresh/hash-change/count-regression cases)
 *
 * End-to-end streaming tests (text events, done event, abort) require a real
 * claude binary and are covered by integration / eval tests.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Api, Context, Model } from "@mariozechner/pi-ai";
import { NOOP_LOGGER } from "../../../src/logger.js";
import { CliHandoffStore, type CliSessionState } from "../../../src/providers/claude-cli/handoff-store.js";
import { createClaudeCliStream, type ClaudeCliStreamDeps } from "../../../src/providers/claude-cli/chat.js";
import {
  shouldHandoff,
  formatHandoffPrompt,
  extractUserPrompt,
} from "../../../src/providers/claude-cli/chat.js";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

const STUB_MCP_SERVER = {} as McpSdkServerConfigWithInstance;
const STUB_PRE_HOOK = async () => ({});
const STUB_POST_HOOK = async () => ({});

function makeModel(id = "claude-opus-4-5"): Model<Api> {
  return { id, api: "claude-cli" as Api, provider: "claude-cli" } as Model<Api>;
}

function makeContext(messages: Array<{ role: string; content: string }>): Context {
  return { messages } as unknown as Context;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

describe("ClaudeCliStreamDeps — interface completeness", () => {
  let dir: string;
  let store: CliHandoffStore;

  beforeEach(() => {
    dir = join(tmpdir(), `ghost-chat-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    store = new CliHandoffStore(join(dir, "session.json"), NOOP_LOGGER);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function makeDeps(overrides: Partial<ClaudeCliStreamDeps> = {}): ClaudeCliStreamDeps {
    return {
      workspacePath: dir,
      logger: NOOP_LOGGER,
      permissionMode: "bypassPermissions",
      buildCliSystemPrompt: () => "System prompt v1",
      setupWorkspace: () => undefined,
      handoffStore: store,
      mcpServer: STUB_MCP_SERVER,
      preToolUseHook: STUB_PRE_HOOK,
      postToolUseHook: STUB_POST_HOOK,
      ...overrides,
    };
  }

  test("all required fields are present and correctly typed", () => {
    const deps = makeDeps();
    expect(typeof deps.workspacePath).toBe("string");
    expect(typeof deps.permissionMode).toBe("string");
    expect(typeof deps.buildCliSystemPrompt).toBe("function");
    expect(typeof deps.setupWorkspace).toBe("function");
    expect(deps.handoffStore).toBeDefined();
    expect(deps.mcpServer).toBeDefined();
    expect(typeof deps.preToolUseHook).toBe("function");
    expect(typeof deps.postToolUseHook).toBe("function");
  });

  test("createClaudeCliStream returns a function", () => {
    const streamFn = createClaudeCliStream(makeDeps());
    expect(typeof streamFn).toBe("function");
  });

  test("returned stream function returns an async iterable (AssistantMessageEventStream)", () => {
    const streamFn = createClaudeCliStream(makeDeps());
    const model = makeModel();
    const ctx = makeContext([{ role: "user", content: "hello" }]);
    const piStream = streamFn(model, ctx);
    // AssistantMessageEventStream is async iterable
    expect(Symbol.asyncIterator in piStream).toBe(true);
  });

  test("setupWorkspace is called when stream is invoked", async () => {
    let setupCalled = false;
    const deps = makeDeps({ setupWorkspace: () => { setupCalled = true; } });
    const streamFn = createClaudeCliStream(deps);
    const piStream = streamFn(makeModel(), makeContext([{ role: "user", content: "hi" }]));
    // Drain the stream — setupWorkspace is called inside the async function
    // We can't await it synchronously, but we can drain it briefly
    const iter = piStream[Symbol.asyncIterator]();
    // Give the microtask queue one tick to start the async function
    await Promise.resolve();
    // setupCalled should be true after the first await inside runSdkQuery
    // (buildCliSystemPrompt → sha256 → setupWorkspace happen synchronously before query())
    // We verify it was set during the turn
    // Note: query() itself will throw because there's no claude binary in CI —
    // that's fine; setupWorkspace still fires before the query call.
    iter.return?.();
    expect(setupCalled).toBe(true);
  });

  test("task-call errors never clear the main session's handoff store", async () => {
    const { agentRunContext } = await import("../../../src/agent/run-context.js");
    const deps = makeDeps();
    // Seed a "main session" state so we can detect accidental clears.
    deps.handoffStore.save({
      sessionId: "main-session-id",
      systemPromptHash: "main-hash",
      syncedCount: 10,
    });
    const streamFn = createClaudeCliStream(deps);

    // Drive a task call. `query()` will throw because there's no claude binary
    // available in the test env — that's the error path we want to exercise.
    await agentRunContext.run({ kind: "task" }, async () => {
      const piStream = streamFn(makeModel(), makeContext([{ role: "user", content: "hi" }]));
      const events: unknown[] = [];
      for await (const ev of piStream) events.push(ev);
    });

    // Main session state must survive the task error path untouched.
    const after = deps.handoffStore.load();
    expect(after?.sessionId).toBe("main-session-id");
    expect(after?.syncedCount).toBe(10);
  });

});

// ---------------------------------------------------------------------------
// Session store integration
// ---------------------------------------------------------------------------

describe("session store integration", () => {
  let dir: string;
  let store: CliHandoffStore;

  beforeEach(() => {
    dir = join(tmpdir(), `ghost-store-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    store = new CliHandoffStore(join(dir, "session.json"), NOOP_LOGGER);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("initial state is null", () => {
    expect(store.load()).toBeNull();
  });

  test("save and load sessionId survives round-trip", () => {
    const state: CliSessionState = {
      sessionId: "sdk-resume-token-xyz",
      systemPromptHash: "abc123",
      syncedCount: 7,
    };
    store.save(state);
    const loaded = store.load();
    expect(loaded?.sessionId).toBe("sdk-resume-token-xyz");
    expect(loaded?.systemPromptHash).toBe("abc123");
    expect(loaded?.syncedCount).toBe(7);
  });

  test("clear resets session to null", () => {
    store.save({ sessionId: "sid", systemPromptHash: "h", syncedCount: 1 });
    store.clear();
    expect(store.load()).toBeNull();
  });

  test("save with null sessionId round-trips correctly", () => {
    store.save({ sessionId: null, systemPromptHash: "h2", syncedCount: 0 });
    expect(store.load()?.sessionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Drift detection (shouldHandoff)
// ---------------------------------------------------------------------------

describe("shouldHandoff — drift detection", () => {
  test("returns true when stored state is null (fresh session)", () => {
    expect(shouldHandoff(null, "hash", 5)).toBe(true);
  });

  test("returns true when system prompt hash changed", () => {
    const state: CliSessionState = {
      sessionId: "sid",
      systemPromptHash: "old-hash",
      syncedCount: 5,
    };
    expect(shouldHandoff(state, "new-hash", 5)).toBe(true);
  });

  test("returns true when context message count regressed (session reset on Ghost side)", () => {
    const state: CliSessionState = {
      sessionId: "sid",
      systemPromptHash: "same-hash",
      syncedCount: 10,
    };
    expect(shouldHandoff(state, "same-hash", 5)).toBe(true);
  });

  test("returns false when hash matches and count has grown (normal turn)", () => {
    const state: CliSessionState = {
      sessionId: "sid",
      systemPromptHash: "hash",
      syncedCount: 3,
    };
    expect(shouldHandoff(state, "hash", 5)).toBe(false);
  });

  test("returns false when hash matches and count is equal (idempotent re-send)", () => {
    const state: CliSessionState = {
      sessionId: "sid",
      systemPromptHash: "hash",
      syncedCount: 5,
    };
    expect(shouldHandoff(state, "hash", 5)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt formatting
// ---------------------------------------------------------------------------

describe("formatHandoffPrompt / extractUserPrompt", () => {
  test("extractUserPrompt returns last user message text", () => {
    const msgs = [
      { role: "user", content: "first message" },
      { role: "assistant", content: "response" },
      { role: "user", content: "second message" },
    ];
    expect(extractUserPrompt(msgs)).toBe("second message");
  });

  test("formatHandoffPrompt includes history and latest user message", () => {
    const msgs = [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ];
    const prompt = formatHandoffPrompt(msgs);
    expect(prompt).toContain("<session_context>");
    expect(prompt).toContain("first");
    expect(prompt).toContain("reply");
    expect(prompt).toContain("second");
  });

  test("formatHandoffPrompt with single message returns just the user message", () => {
    const msgs = [{ role: "user", content: "only message" }];
    const prompt = formatHandoffPrompt(msgs);
    expect(prompt).toBe("only message");
  });

  test("drift case: stored state cleared → next query sends full history", () => {
    // Simulates what happens when shouldHandoff returns true:
    // store.clear() is called, formatHandoffPrompt is used for the prompt.
    const dir = join(tmpdir(), `ghost-drift-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const testStore = new CliHandoffStore(join(dir, "s.json"), NOOP_LOGGER);
    testStore.save({ sessionId: "old", systemPromptHash: "old-hash", syncedCount: 3 });

    // Simulate drift detection result
    const stored = testStore.load();
    const drifted = shouldHandoff(stored, "new-hash", 5); // hash changed
    expect(drifted).toBe(true);

    // On drift: clear and use formatHandoffPrompt
    testStore.clear();
    expect(testStore.load()).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  test("resume case: sessionId passed from store when no drift", () => {
    // Simulates the resume path: sessionId from store is passed to query options
    const dir = join(tmpdir(), `ghost-resume-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    const testStore = new CliHandoffStore(join(dir, "s.json"), NOOP_LOGGER);
    testStore.save({ sessionId: "resume-token-abc", systemPromptHash: "hash", syncedCount: 3 });

    const stored = testStore.load();
    const drifted = shouldHandoff(stored, "hash", 5); // same hash, count grew
    expect(drifted).toBe(false);

    // On no-drift: resume sessionId should be used
    const resumeId = stored?.sessionId ?? undefined;
    expect(resumeId).toBe("resume-token-abc");
    rmSync(dir, { recursive: true, force: true });
  });
});
