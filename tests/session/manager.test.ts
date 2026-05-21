import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { SessionManager } from "../../src/session/manager.js";
import { Session } from "../../src/session/session.js";
import type { UserMessage, AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let workspace: string;
let manager: SessionManager;

function userMsg(content: string): UserMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function assistantMsg(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text } as TextContent],
    api: "openai" as never,
    provider: "openai" as never,
    model: "gpt-4",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  workspace = join(tmpdir(), `ghost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  manager = new SessionManager(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("SessionManager", () => {
  describe("getOrCreate()", () => {
    test("creates new session when none exists", () => {
      const session = manager.getOrCreate("telegram:123");
      expect(session.key).toBe("telegram:123");
      expect(session.messages).toHaveLength(0);
    });

    test("returns cached session on second call", () => {
      const s1 = manager.getOrCreate("telegram:123");
      s1.addMessage(userMsg("hello"));
      const s2 = manager.getOrCreate("telegram:123");
      expect(s2.messages).toHaveLength(1);
      expect(s1).toBe(s2); // Same reference
    });

    test("loads from disk if not in cache", async () => {
      const session = manager.getOrCreate("telegram:456");
      session.addMessage(userMsg("hello"));
      session.addMessage(assistantMsg("hi"));
      await manager.save(session);
      manager.invalidate("telegram:456");

      const reloaded = manager.getOrCreate("telegram:456");
      expect(reloaded.messages).toHaveLength(2);
      expect(reloaded.key).toBe("telegram:456");
    });
  });

  describe("save()", () => {
    test("persists session to JSONL file", async () => {
      const session = manager.getOrCreate("test:1");
      session.addMessage(userMsg("hello"));
      await manager.save(session);

      const path = join(workspace, "sessions", "test_1.jsonl");
      expect(existsSync(path)).toBe(true);

      const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
      expect(lines).toHaveLength(2); // metadata + 1 message

      const meta = JSON.parse(lines[0]);
      expect(meta._type).toBe("metadata");
      expect(meta.key).toBe("test:1");
    });

    test("preserves lastConsolidated", async () => {
      const session = manager.getOrCreate("test:2");
      session.addMessage(userMsg("old"));
      session.addMessage(assistantMsg("old reply"));
      session.lastConsolidated = 2;
      session.addMessage(userMsg("new"));
      await manager.save(session);
      manager.invalidate("test:2");

      const reloaded = manager.getOrCreate("test:2");
      expect(reloaded.lastConsolidated).toBe(2);
      expect(reloaded.messages).toHaveLength(3);
    });

    test("atomic write — temp file then rename", async () => {
      const session = manager.getOrCreate("test:atomic");
      session.addMessage(userMsg("test"));
      await manager.save(session);

      // .tmp should not exist after save
      const tmpPath = join(workspace, "sessions", "test_atomic.jsonl.tmp");
      expect(existsSync(tmpPath)).toBe(false);
    });
  });

  describe("delete()", () => {
    test("removes session from cache and disk", async () => {
      const session = manager.getOrCreate("test:del");
      session.addMessage(userMsg("hello"));
      await manager.save(session);

      manager.delete("test:del");

      const path = join(workspace, "sessions", "test_del.jsonl");
      expect(existsSync(path)).toBe(false);

      // Fresh getOrCreate should return empty session
      const fresh = manager.getOrCreate("test:del");
      expect(fresh.messages).toHaveLength(0);
    });
  });

  describe("listSessions()", () => {
    test("returns empty array when no sessions", () => {
      expect(manager.listSessions()).toHaveLength(0);
    });

    test("lists sessions sorted by updatedAt desc", async () => {
      const s1 = manager.getOrCreate("test:old");
      s1.addMessage(userMsg("old"));
      await manager.save(s1);

      // Ensure different timestamps via actual delay
      await new Promise(resolve => setTimeout(resolve, 50));

      const s2 = manager.getOrCreate("test:new");
      s2.addMessage(userMsg("new"));
      await manager.save(s2);

      const list = manager.listSessions();
      expect(list).toHaveLength(2);
      expect(list[0].key).toBe("test:new");
      expect(list[1].key).toBe("test:old");
    });
  });

  describe("lastActiveAt persistence", () => {
    test("lastActiveAt round-trips through save → load", async () => {
      const session = manager.getOrCreate("test:active");
      session.addMessage(userMsg("hello"));
      const activeAt = session.lastActiveAt;
      expect(activeAt).not.toBeNull();

      await manager.save(session);
      manager.invalidate("test:active");

      const reloaded = manager.getOrCreate("test:active");
      expect(reloaded.lastActiveAt).not.toBeNull();
      expect(reloaded.lastActiveAt!.getTime()).toBe(activeAt!.getTime());
    });

    test("null lastActiveAt round-trips through save → load", async () => {
      const session = manager.getOrCreate("test:noactive");
      // Only assistant messages — lastActiveAt stays null
      session.addMessage(assistantMsg("background write"));
      expect(session.lastActiveAt).toBeNull();

      await manager.save(session);
      manager.invalidate("test:noactive");

      const reloaded = manager.getOrCreate("test:noactive");
      expect(reloaded.lastActiveAt).toBeNull();
    });

    test("legacy session JSONL (no lastActiveAt field) backfills from last user msg", () => {
      const userTs = Date.now() - 3_600_000; // 1 hour ago
      const path = join(workspace, "sessions", "test_legacy.jsonl");
      mkdirSync(join(workspace, "sessions"), { recursive: true });
      const lines = [
        // Metadata WITHOUT lastActiveAt — simulates a pre-Slice1 session file
        JSON.stringify({ _type: "metadata", key: "test:legacy", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {}, lastConsolidated: 0 }),
        JSON.stringify({ role: "user", content: "old message", timestamp: userTs }),
        JSON.stringify(assistantMsg("reply")),
      ];
      writeFileSync(path, lines.join("\n") + "\n");

      const session = manager.getOrCreate("test:legacy");
      expect(session.lastActiveAt).not.toBeNull();
      // Should match the user message timestamp
      expect(session.lastActiveAt!.getTime()).toBe(userTs);
    });

    test("session with persisted lastActiveAt:null but user messages backfills from messages", () => {
      // Reproduces the bug where appendEntry writes initial metadata with
      // lastActiveAt:null and never rewrites it, leaving the in-memory updates
      // unflushed. On load, falsy persisted value must fall through to backfill.
      const userTs = Date.now() - 7_200_000; // 2 hours ago
      const path = join(workspace, "sessions", "test_stalemeta.jsonl");
      mkdirSync(join(workspace, "sessions"), { recursive: true });
      const lines = [
        JSON.stringify({ _type: "metadata", key: "test:stalemeta", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastActiveAt: null, metadata: {}, lastConsolidated: 0 }),
        JSON.stringify({ role: "user", content: "hello", timestamp: userTs }),
        JSON.stringify(assistantMsg("hi")),
      ];
      writeFileSync(path, lines.join("\n") + "\n");

      const session = manager.getOrCreate("test:stalemeta");
      expect(session.lastActiveAt).not.toBeNull();
      expect(session.lastActiveAt!.getTime()).toBe(userTs);
    });

    test("legacy session with no user messages backfills to null", () => {
      const path = join(workspace, "sessions", "test_legacynull.jsonl");
      mkdirSync(join(workspace, "sessions"), { recursive: true });
      const lines = [
        JSON.stringify({ _type: "metadata", key: "test:legacynull", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {}, lastConsolidated: 0 }),
        JSON.stringify(assistantMsg("agent-only session")),
      ];
      writeFileSync(path, lines.join("\n") + "\n");

      const session = manager.getOrCreate("test:legacynull");
      expect(session.lastActiveAt).toBeNull();
    });
  });

  describe("malformed JSONL handling", () => {
    test("skips malformed message lines without crashing", () => {
      const path = join(workspace, "sessions", "test_bad.jsonl");
      mkdirSync(join(workspace, "sessions"), { recursive: true });
      const lines = [
        JSON.stringify({ _type: "metadata", key: "test:bad", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), metadata: {}, lastConsolidated: 0 }),
        JSON.stringify(userMsg("good")),
        "this is not json {{{",
        JSON.stringify(assistantMsg("also good")),
      ];
      writeFileSync(path, lines.join("\n") + "\n");

      const session = manager.getOrCreate("test:bad");
      expect(session.messages).toHaveLength(2); // skipped bad line
    });
  });
});
