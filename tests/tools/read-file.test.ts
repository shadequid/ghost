import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TextContent } from "@earendil-works/pi-ai";
import { ReadFileTool } from "../../src/tools/read-file.js";

const text = (r: { content: { type: string; text?: string }[] }) =>
  (r.content.filter((c): c is TextContent => c.type === "text")[0]?.text ?? "");

const ID = "test-id";
let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `ghost-rf-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

describe("ReadFileTool", () => {
  test("name is read_file", () => {
    expect(new ReadFileTool().name).toBe("read_file");
  });

  test("reads file with line numbers", async () => {
    writeFileSync(join(tmpDir, "test.txt"), "line1\nline2\nline3");
    const tool = new ReadFileTool();
    const result = await tool.execute(ID, { path: join(tmpDir, "test.txt") });
    const out = text(result);
    expect(out).toContain("1");
    expect(out).toContain("line1");
    expect(out).toContain("line2");
    expect(out).toContain("line3");
  });

  test("respects offset parameter (1-indexed)", async () => {
    writeFileSync(join(tmpDir, "off.txt"), "a\nb\nc\nd\ne");
    const tool = new ReadFileTool();
    const result = await tool.execute(ID, { path: join(tmpDir, "off.txt"), offset: 3 });
    const out = text(result);
    expect(out).not.toContain("| a\n");
    expect(out).toContain("c");
    expect(out).toContain("d");
  });

  test("respects limit parameter", async () => {
    writeFileSync(join(tmpDir, "lim.txt"), "a\nb\nc\nd\ne");
    const tool = new ReadFileTool();
    const result = await tool.execute(ID, { path: join(tmpDir, "lim.txt"), limit: 2 });
    const out = text(result);
    expect(out).toContain("a");
    expect(out).toContain("b");
    expect(out).not.toContain("| c");
  });

  test("offset + limit combined", async () => {
    writeFileSync(join(tmpDir, "ol.txt"), "a\nb\nc\nd\ne");
    const tool = new ReadFileTool();
    const result = await tool.execute(ID, { path: join(tmpDir, "ol.txt"), offset: 2, limit: 2 });
    const out = text(result);
    expect(out).toContain("b");
    expect(out).toContain("c");
    expect(out).not.toContain("| a");
    expect(out).not.toContain("| d");
  });

  test("throws for missing file", async () => {
    const tool = new ReadFileTool();
    await expect(tool.execute(ID, { path: join(tmpDir, "nope.txt") })).rejects.toThrow();
  });

  test("detects image file and returns ImageContent", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const imgPath = join(tmpDir, "test.png");
    writeFileSync(imgPath, png);
    const tool = new ReadFileTool();
    const result = await tool.execute(ID, { path: imgPath });
    expect(result.content[0].type).toBe("image");
  });
});
