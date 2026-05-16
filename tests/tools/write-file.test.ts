import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TextContent } from "@mariozechner/pi-ai";
import { WriteFileTool } from "../../src/tools/write-file.js";

const text = (r: { content: { type: string; text?: string }[] }) =>
  (r.content.filter((c): c is TextContent => c.type === "text")[0]?.text ?? "");

const ID = "test-id";
let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `ghost-wf-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("WriteFileTool", () => {
  test("name is write_file", () => {
    expect(new WriteFileTool().name).toBe("write_file");
  });

  test("writes content to a file", async () => {
    const path = join(tmpDir, "out.txt");
    const tool = new WriteFileTool();
    const result = await tool.execute(ID, { path, content: "hello world" });
    expect(text(result)).toContain("bytes");
    expect(readFileSync(path, "utf-8")).toBe("hello world");
  });

  test("creates parent directories automatically", async () => {
    const path = join(tmpDir, "deep", "nested", "dir", "file.txt");
    const tool = new WriteFileTool();
    await tool.execute(ID, { path, content: "deep" });
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8")).toBe("deep");
  });

  test("returns byte count in output", async () => {
    const path = join(tmpDir, "count.txt");
    const tool = new WriteFileTool();
    const result = await tool.execute(ID, { path, content: "abc" });
    expect(text(result)).toContain("3");
  });
});
