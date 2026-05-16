
import type { MethodHandler } from "./method-registry.js";
import type { MemoryStore } from "../memory/store.js";
import { readFileSync, existsSync } from "node:fs";

export function registerMemoryMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: { memoryStore: MemoryStore },
): void {
  register("memory.get", async () => {
    const memory = deps.memoryStore.readLongTerm();
    let history = "";
    if (existsSync(deps.memoryStore.historyFile)) {
      try { history = readFileSync(deps.memoryStore.historyFile, "utf-8"); } catch { /* ignore */ }
    }
    return { memory, history };
  });

  register("memory.write", async (_ctx, payload) => {
    const p = payload as { content?: string };
    if (typeof p?.content !== "string") throw new Error("content is required");
    await deps.memoryStore.writeLongTerm(p.content);
    return { ok: true };
  });

  register("memory.clear", async () => {
    await deps.memoryStore.writeLongTerm("");
    return { ok: true };
  });
}
