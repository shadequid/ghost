import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TextContent } from "@earendil-works/pi-ai";
import { EditFileTool } from "../../src/tools/edit-file.js";

const text = (r: { content: { type: string; text?: string }[] }) =>
  (r.content.filter((c): c is TextContent => c.type === "text")[0]?.text ?? "");

const ID = "test-id";
let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `ghost-ef-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("EditFileTool", () => {
  test("name is edit_file", () => {
    expect(new EditFileTool().name).toBe("edit_file");
  });

  test("replaces first occurrence by default", async () => {
    const path = join(tmpDir, "edit.txt");
    writeFileSync(path, "hello world hello");
    const tool = new EditFileTool();
    await tool.execute(ID, { path, old_text: "hello", new_text: "bye" });
    expect(readFileSync(path, "utf-8")).toBe("bye world hello");
  });

  test("replace_all replaces all occurrences", async () => {
    const path = join(tmpDir, "all.txt");
    writeFileSync(path, "aaa bbb aaa");
    const tool = new EditFileTool();
    await tool.execute(ID, { path, old_text: "aaa", new_text: "ccc", replace_all: true });
    expect(readFileSync(path, "utf-8")).toBe("ccc bbb ccc");
  });

  test("throws when old_text not found", async () => {
    const path = join(tmpDir, "miss.txt");
    writeFileSync(path, "hello world");
    const tool = new EditFileTool();
    await expect(
      tool.execute(ID, { path, old_text: "missing", new_text: "x" }),
    ).rejects.toThrow();
  });

  test("whitespace-tolerant fallback matching", async () => {
    const path = join(tmpDir, "ws.txt");
    writeFileSync(path, "function  foo() {\n  return 1;\n}");
    const tool = new EditFileTool();
    await tool.execute(ID, { path, old_text: "function foo() {", new_text: "function bar() {" });
    const result = readFileSync(path, "utf-8");
    expect(result).toContain("bar");
  });

  test("returns success message", async () => {
    const path = join(tmpDir, "msg.txt");
    writeFileSync(path, "hello world");
    const tool = new EditFileTool();
    const result = await tool.execute(ID, { path, old_text: "world", new_text: "ghost" });
    expect(text(result)).toContain("updated");
  });

  test("whitespace fallback with replace_all replaces all occurrences", async () => {
    const path = join(tmpDir, "ws-all.txt");
    writeFileSync(path, "fn  foo() {}\nother\nfn  foo() {}");
    const tool = new EditFileTool();
    await tool.execute(ID, { path, old_text: "fn foo() {}", new_text: "fn bar() {}", replace_all: true });
    const result = readFileSync(path, "utf-8");
    expect(result).not.toContain("foo");
    expect(result.split("bar").length - 1).toBe(2);
  });

  test("shows closest match hint when old_text not found", async () => {
    const path = join(tmpDir, "hint.txt");
    writeFileSync(path, "function hello() {\n  return 1;\n}");
    const tool = new EditFileTool();
    await expect(
      tool.execute(ID, { path, old_text: "function goodbye() {", new_text: "x" }),
    ).rejects.toThrow(/closest|line/i);
  });
});
