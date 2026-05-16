import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MethodRegistry, type MethodContext } from "../../src/gateway/method-registry.js";
import { registerChatMethods } from "../../src/gateway/chat.js";
import { SessionManager } from "../../src/session/manager.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import type { Orchestrator, PromptOptions } from "../../src/agent/orchestrator.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeCtx(): MethodContext & { emitted: Array<{ event: string; payload: unknown }> } {
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    clientId: "c1",
    sessionId: "s1",
    broadcast: () => {},
    emit: (event, payload) => emitted.push({ event, payload }),
    emitted,
  };
}

function makeOrchestrator(overrides?: Partial<{ prompt: (opts: PromptOptions) => Promise<{ text: string }>; sessionKey: string }>): Orchestrator {
  return {
    sessionKey: overrides?.sessionKey ?? "main",
    prompt: overrides?.prompt ?? (async () => ({ text: "" })),
    abort: () => {},
  } as unknown as Orchestrator;
}

describe("chat methods", () => {
  let tmpDir: string;
  let sm: SessionManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-chat-test-"));
    sm = new SessionManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("chat.send rejects empty message", async () => {
    const reg = new MethodRegistry();
    registerChatMethods(reg.register.bind(reg), { orchestrator: makeOrchestrator(), sessionManager: sm, logger: NOOP_LOGGER });
    const ctx = makeCtx();
    try {
      await reg.dispatch("chat.send", ctx, {});
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toBe("message is required");
    }
  });

  test("chat.send returns runId and started status", async () => {
    const reg = new MethodRegistry();
    registerChatMethods(reg.register.bind(reg), { orchestrator: makeOrchestrator(), sessionManager: sm, logger: NOOP_LOGGER });
    const ctx = makeCtx();
    const result = await reg.dispatch("chat.send", ctx, { message: "hello" }) as { runId: string; status: string };
    expect(result.status).toBe("started");
    expect(typeof result.runId).toBe("string");
    expect(result.runId.length).toBeGreaterThan(0);
  });

  test("chat.send emits chat.done event when orchestrator completes", async () => {
    const reg = new MethodRegistry();
    const orchestrator = makeOrchestrator({
      prompt: async (opts) => {
        // Simulate text delta via onEvent
        opts.onEvent?.({ type: "message_update", message: {} as never, assistantMessageEvent: { type: "text_delta", delta: "hi" } as never });
        return { text: "hi" };
      },
    });
    registerChatMethods(reg.register.bind(reg), { orchestrator, sessionManager: sm, logger: NOOP_LOGGER });
    const ctx = makeCtx();
    const result = await reg.dispatch("chat.send", ctx, { message: "hello" }) as { runId: string };
    await Bun.sleep(50);
    const doneEvent = ctx.emitted.find(e => e.event === "chat.done");
    expect(doneEvent).toBeDefined();
    expect((doneEvent!.payload as { runId: string }).runId).toBe(result.runId);
    expect((doneEvent!.payload as { response: string }).response).toBe("hi");
  });

  test("chat.send emits chat.error when orchestrator rejects", async () => {
    const reg = new MethodRegistry();
    const orchestrator = makeOrchestrator({
      prompt: async () => { throw new Error("No API key configured"); },
    });
    registerChatMethods(reg.register.bind(reg), { orchestrator, sessionManager: sm, logger: NOOP_LOGGER });
    const ctx = makeCtx();
    const result = await reg.dispatch("chat.send", ctx, { message: "hello" }) as { runId: string };
    await Bun.sleep(50);
    const errorEvent = ctx.emitted.find(e => e.event === "chat.error");
    expect(errorEvent).toBeDefined();
    expect((errorEvent!.payload as { runId: string }).runId).toBe(result.runId);
    expect((errorEvent!.payload as { error: string }).error).toBe("No API key configured");
  });

  test("chat.history returns session messages from main session", async () => {
    const reg = new MethodRegistry();
    registerChatMethods(reg.register.bind(reg), { orchestrator: makeOrchestrator(), sessionManager: sm, logger: NOOP_LOGGER });
    const session = sm.getOrCreate("main");
    session.addMessage({ role: "user", content: "hello" } as never);
    const ctx = makeCtx();
    const result = await reg.dispatch("chat.history", ctx, {}) as { sessionKey: string; messages: unknown[] };
    expect(result.sessionKey).toBe("main");
    expect(result.messages).toHaveLength(1);
  });

  test("chat.history respects limit param (max 1000)", async () => {
    const reg = new MethodRegistry();
    registerChatMethods(reg.register.bind(reg), { orchestrator: makeOrchestrator(), sessionManager: sm, logger: NOOP_LOGGER });
    const session = sm.getOrCreate("main");
    for (let i = 0; i < 10; i++) {
      session.addMessage({ role: "user", content: `msg ${i}` } as never);
    }
    const ctx = makeCtx();
    const result = await reg.dispatch("chat.history", ctx, { limit: 3 }) as { messages: unknown[] };
    expect(result.messages).toHaveLength(3);
  });

  test("chat.history returns empty for new session", async () => {
    const reg = new MethodRegistry();
    registerChatMethods(reg.register.bind(reg), { orchestrator: makeOrchestrator(), sessionManager: sm, logger: NOOP_LOGGER });
    const ctx = makeCtx();
    const result = await reg.dispatch("chat.history", ctx, {}) as { messages: unknown[] };
    expect(result.messages).toEqual([]);
  });

  test("chat.abort returns aborted false when no active run", async () => {
    const reg = new MethodRegistry();
    registerChatMethods(reg.register.bind(reg), { orchestrator: makeOrchestrator(), sessionManager: sm, logger: NOOP_LOGGER });
    const ctx = makeCtx();
    const result = await reg.dispatch("chat.abort", ctx, { runId: "nonexistent" }) as { ok: boolean; aborted: boolean };
    expect(result.ok).toBe(true);
    expect(result.aborted).toBe(false);
  });

  test("chat.abort without runId aborts all runs", async () => {
    const reg = new MethodRegistry();
    registerChatMethods(reg.register.bind(reg), { orchestrator: makeOrchestrator(), sessionManager: sm, logger: NOOP_LOGGER });
    const ctx = makeCtx();
    const result = await reg.dispatch("chat.abort", ctx, {}) as { ok: boolean; aborted: boolean };
    expect(result.ok).toBe(true);
    expect(result.aborted).toBe(false);
  });

  test("registers all 3 chat methods", () => {
    const reg = new MethodRegistry();
    registerChatMethods(reg.register.bind(reg), { orchestrator: makeOrchestrator(), sessionManager: sm, logger: NOOP_LOGGER });
    expect(reg.has("chat.send")).toBe(true);
    expect(reg.has("chat.history")).toBe(true);
    expect(reg.has("chat.abort")).toBe(true);
  });
});
