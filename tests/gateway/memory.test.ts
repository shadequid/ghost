import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MethodRegistry, type MethodContext } from "../../src/gateway/method-registry.js";
import { registerMemoryMethods } from "../../src/gateway/memory.js";
import { MemoryStore } from "../../src/memory/store.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeCtx(): MethodContext {
  return { clientId: "c1", sessionId: "s1", broadcast: () => {}, emit: () => {} };
}

describe("memory methods", () => {
  let tmpDir: string;
  let store: MemoryStore;
  let reg: MethodRegistry;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-mem-test-"));
    store = new MemoryStore(tmpDir);
    reg = new MethodRegistry();
    registerMemoryMethods(reg.register.bind(reg), { memoryStore: store });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("memory.get returns empty defaults", async () => {
    const result = await reg.dispatch("memory.get", makeCtx(), {}) as { memory: string; history: string };
    expect(result.memory).toBe("");
  });

  test("memory.write + memory.get round-trip", async () => {
    await reg.dispatch("memory.write", makeCtx(), { content: "hello world" });
    const result = await reg.dispatch("memory.get", makeCtx(), {}) as { memory: string };
    expect(result.memory).toBe("hello world");
  });

  test("memory.clear empties content", async () => {
    await reg.dispatch("memory.write", makeCtx(), { content: "data" });
    await reg.dispatch("memory.clear", makeCtx(), {});
    const result = await reg.dispatch("memory.get", makeCtx(), {}) as { memory: string };
    expect(result.memory).toBe("");
  });

  test("memory.write rejects missing content", async () => {
    try {
      await reg.dispatch("memory.write", makeCtx(), {});
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toBe("content is required");
    }
  });
});
