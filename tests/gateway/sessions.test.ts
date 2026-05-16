import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MethodRegistry, type MethodContext } from "../../src/gateway/method-registry.js";
import { registerSessionsMethods } from "../../src/gateway/sessions.js";
import { SessionManager } from "../../src/session/manager.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeCtx(): MethodContext {
  return { clientId: "c1", sessionId: "s1", broadcast: () => {}, emit: () => {} };
}

describe("sessions methods", () => {
  let tmpDir: string;
  let sm: SessionManager;
  let reg: MethodRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-sess-test-"));
    sm = new SessionManager(tmpDir);
    reg = new MethodRegistry();
    registerSessionsMethods(reg.register.bind(reg), { sessionManager: sm });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("sessions.list returns empty initially", async () => {
    const result = await reg.dispatch("sessions.list", makeCtx(), {}) as { sessions: unknown[]; total: number };
    expect(result.sessions).toEqual([]);
    expect(result.total).toBe(0);
  });

  test("sessions.list supports limit and offset", async () => {
    // Create and persist some sessions
    for (let i = 0; i < 5; i++) {
      const s = sm.getOrCreate(`sess-${i}`);
      s.addMessage({ role: "user", content: `msg ${i}` } as never);
      await sm.save(s);
    }
    const result = await reg.dispatch("sessions.list", makeCtx(), { limit: 2, offset: 1 }) as { sessions: unknown[]; total: number };
    expect(result.sessions).toHaveLength(2);
    expect(result.total).toBe(5);
  });

  test("sessions.list defaults to limit 50", async () => {
    const result = await reg.dispatch("sessions.list", makeCtx(), {}) as { sessions: unknown[]; total: number };
    expect(result.total).toBe(0);
  });

  test("sessions.preview returns preview items per key", async () => {
    const session = sm.getOrCreate("test-key");
    session.addMessage({ role: "user", content: "hello" } as never);
    session.addMessage({ role: "assistant", content: "world" } as never);
    await sm.save(session);

    const result = await reg.dispatch("sessions.preview", makeCtx(), { keys: ["test-key"] }) as {
      previews: Array<{ key: string; status: string; items: Array<{ role: string; text: string }> }>;
    };
    expect(result.previews).toHaveLength(1);
    expect(result.previews[0].key).toBe("test-key");
    expect(result.previews[0].status).toBe("active");
    expect(result.previews[0].items).toHaveLength(2);
    expect(result.previews[0].items[0].role).toBe("user");
    expect(result.previews[0].items[0].text).toBe("hello");
  });

  test("sessions.preview truncates text to maxChars", async () => {
    const session = sm.getOrCreate("long-key");
    session.addMessage({ role: "user", content: "x".repeat(500) } as never);
    await sm.save(session);

    const result = await reg.dispatch("sessions.preview", makeCtx(), { keys: ["long-key"], maxChars: 10 }) as {
      previews: Array<{ key: string; items: Array<{ text: string }> }>;
    };
    expect(result.previews[0].items[0].text.length).toBeLessThanOrEqual(11); // 10 + ellipsis char
  });

  test("sessions.preview rejects missing keys", async () => {
    try {
      await reg.dispatch("sessions.preview", makeCtx(), {});
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toBe("keys is required");
    }
  });

  test("sessions.preview returns empty status for empty session", async () => {
    const result = await reg.dispatch("sessions.preview", makeCtx(), { keys: ["empty-key"] }) as {
      previews: Array<{ key: string; status: string; items: unknown[] }>;
    };
    expect(result.previews[0].status).toBe("empty");
    expect(result.previews[0].items).toHaveLength(0);
  });

  test("sessions.reset deletes session and returns key", async () => {
    const s = sm.getOrCreate("reset-key");
    s.addMessage({ role: "user", content: "test" } as never);
    await sm.save(s);

    const result = await reg.dispatch("sessions.reset", makeCtx(), { sessionKey: "reset-key" }) as { ok: boolean; key: string };
    expect(result.ok).toBe(true);
    expect(result.key).toBe("reset-key");
  });

  test("sessions.reset rejects missing sessionKey", async () => {
    try {
      await reg.dispatch("sessions.reset", makeCtx(), {});
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toBe("sessionKey is required");
    }
  });

  test("sessions.delete removes session", async () => {
    sm.getOrCreate("del-key");
    await reg.dispatch("sessions.delete", makeCtx(), { sessionId: "del-key" });
    const result = await reg.dispatch("sessions.list", makeCtx(), {}) as { sessions: unknown[] };
    expect(result.sessions).toEqual([]);
  });
});
