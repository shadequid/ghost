import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { MemoryStore } from "../../src/memory/store.js";
import { existsSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let workspace: string;
let store: MemoryStore;

beforeEach(() => {
  workspace = join(tmpdir(), `ghost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  store = new MemoryStore(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("MemoryStore", () => {
  describe("readLongTerm()", () => {
    test("returns empty string when MEMORY.md does not exist", () => {
      expect(store.readLongTerm()).toBe("");
    });

    test("returns file content when MEMORY.md exists", () => {
      Bun.write(store.memoryFile, "# Facts\n\nUser likes coffee\n");
      expect(store.readLongTerm()).toBe("# Facts\n\nUser likes coffee\n");
    });
  });

  describe("writeLongTerm()", () => {
    test("creates MEMORY.md with content", async () => {
      await store.writeLongTerm("# My Memory\n\nImportant fact.");
      const content = readFileSync(store.memoryFile, "utf-8");
      expect(content).toBe("# My Memory\n\nImportant fact.");
    });

    test("overwrites existing MEMORY.md", async () => {
      await store.writeLongTerm("old content");
      await store.writeLongTerm("new content");
      expect(store.readLongTerm()).toBe("new content");
    });

    test("creates memory directory if missing", async () => {
      rmSync(store.memoryDir, { recursive: true, force: true });
      await store.writeLongTerm("test");
      expect(existsSync(store.memoryFile)).toBe(true);
    });
  });

  describe("appendHistory()", () => {
    test("creates HISTORY.md on first append", () => {
      store.appendHistory("[2026-04-01 12:00] User asked about weather");
      expect(existsSync(store.historyFile)).toBe(true);
    });

    test("appends entry with trailing double newline", () => {
      store.appendHistory("[2026-04-01 12:00] First entry");
      store.appendHistory("[2026-04-01 13:00] Second entry");
      const content = readFileSync(store.historyFile, "utf-8");
      expect(content).toBe(
        "[2026-04-01 12:00] First entry\n\n[2026-04-01 13:00] Second entry\n\n",
      );
    });

    test("trims trailing whitespace from entry before appending", () => {
      store.appendHistory("entry with trailing space   \n\n");
      const content = readFileSync(store.historyFile, "utf-8");
      expect(content).toBe("entry with trailing space\n\n");
    });
  });

  describe("getMemoryContext()", () => {
    test("returns empty string when no memory", () => {
      expect(store.getMemoryContext()).toBe("");
    });

    test("returns formatted section when memory exists", async () => {
      await store.writeLongTerm("User prefers dark mode");
      const ctx = store.getMemoryContext();
      expect(ctx).toBe("## Long-term Memory\n\nUser prefers dark mode");
    });

    test("returns empty string for whitespace-only memory", async () => {
      await store.writeLongTerm("   \n\n  ");
      expect(store.getMemoryContext()).toBe("");
    });
  });

  describe("healthCheck()", () => {
    test("returns true when memory directory exists", () => {
      expect(store.healthCheck()).toBe(true);
    });

    test("returns false when memory directory is missing", () => {
      rmSync(store.memoryDir, { recursive: true, force: true });
      expect(store.healthCheck()).toBe(false);
    });
  });
});
