
import type { MethodHandler } from "./method-registry.js";
import type { SessionManager } from "../session/manager.js";

export function registerSessionsMethods(
  register: (method: string, handler: MethodHandler) => void,
  deps: { sessionManager: SessionManager },
): void {
  register("sessions.list", async (_ctx, payload) => {
    const p = payload as { limit?: number; offset?: number } | undefined;
    const limit = Math.min(Math.max(1, p?.limit ?? 50), 500);
    const offset = Math.max(0, p?.offset ?? 0);
    const all = deps.sessionManager.listSessions();
    return {
      sessions: all.slice(offset, offset + limit),
      total: all.length,
    };
  });

  register("sessions.preview", async (_ctx, payload) => {
    const p = payload as { keys?: string[]; limit?: number; maxChars?: number };
    if (!p?.keys?.length) throw new Error("keys is required");
    const limit = Math.min(Math.max(1, p.limit ?? 12), 50);
    const maxChars = Math.min(Math.max(1, p.maxChars ?? 240), 2000);

    const keys = p.keys.slice(0, limit);
    const previews: Array<{ key: string; status: string; items: Array<{ role: string; text: string }> }> = [];

    for (const key of keys) {
      const session = deps.sessionManager.getOrCreate(key);
      const recent = session.messages.slice(-3);
      const items = recent.map(msg => {
        const role = msg.role;
        let text = "";
        if (typeof msg.content === "string") {
          text = msg.content;
        } else if (Array.isArray(msg.content)) {
          const parts: string[] = [];
          for (const part of msg.content) {
            if (typeof part === "string") parts.push(part);
            else if (part && typeof part === "object" && "text" in part) parts.push(String(part.text));
          }
          text = parts.join(" ");
        }
        if (text.length > maxChars) text = text.slice(0, maxChars) + "\u2026";
        return { role, text };
      });
      previews.push({
        key,
        status: session.messages.length > 0 ? "active" : "empty",
        items,
      });
    }

    return { previews };
  });

  register("sessions.reset", async (_ctx, payload) => {
    const p = payload as { sessionKey?: string };
    if (!p?.sessionKey) throw new Error("sessionKey is required");
    deps.sessionManager.delete(p.sessionKey);
    return { ok: true, key: p.sessionKey };
  });

  register("sessions.delete", async (_ctx, payload) => {
    const p = payload as { sessionId?: string };
    if (!p?.sessionId) throw new Error("sessionId is required");
    deps.sessionManager.delete(p.sessionId);
    return { ok: true };
  });
}
