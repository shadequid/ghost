import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TextContent } from "@mariozechner/pi-ai";
import { ListDirTool } from "../../src/tools/list-dir.js";

const text = (r: { content: { type: string; text?: string }[] }) =>
  (r.content.filter((c): c is TextContent => c.type === "text")[0]?.text ?? "");

const ID = "test-id";
let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `ghost-ld-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("ListDirTool", () => {
  test("name is list_dir", () => {
    expect(new ListDirTool().name).toBe("list_dir");
  });

  test("lists files and directories", async () => {
    writeFileSync(join(tmpDir, "file.txt"), "");
    mkdirSync(join(tmpDir, "subdir"));
    const tool = new ListDirTool();
    const result = await tool.execute(ID, { path: tmpDir });
    const out = text(result);
    expect(out).toContain("file.txt");
    expect(out).toContain("subdir");
  });

  test("recursive lists nested files", async () => {
    mkdirSync(join(tmpDir, "a", "b"), { recursive: true });
    writeFileSync(join(tmpDir, "a", "b", "deep.txt"), "");
    const tool = new ListDirTool();
    const result = await tool.execute(ID, { path: tmpDir, recursive: true });
    expect(text(result)).toContain("deep.txt");
  });

  test("ignores noise directories", async () => {
    mkdirSync(join(tmpDir, "node_modules"));
    mkdirSync(join(tmpDir, ".git"));
    mkdirSync(join(tmpDir, "src"));
    const tool = new ListDirTool();
    const result = await tool.execute(ID, { path: tmpDir });
    const out = text(result);
    expect(out).not.toContain("node_modules");
    expect(out).not.toContain(".git");
    expect(out).toContain("src");
  });

  test("truncates at max_entries", async () => {
    for (let i = 0; i < 10; i++) writeFileSync(join(tmpDir, `f${i}.txt`), "");
    const tool = new ListDirTool();
    const result = await tool.execute(ID, { path: tmpDir, max_entries: 3 });
    const out = text(result);
    expect(out).toContain("truncated");
  });

  test("throws for non-existent path", async () => {
    const tool = new ListDirTool();
    await expect(tool.execute(ID, { path: join(tmpDir, "nope") })).rejects.toThrow();
  });
});
