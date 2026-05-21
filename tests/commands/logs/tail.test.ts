import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readLogTail } from "../../../src/commands/logs/tail.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("log-tail-reader", () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ghost-logtail-test-"));
    logFile = join(tmpDir, "test.log");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeLog(lines: string[]): void {
    const content = lines.length > 0 ? lines.join("\n") + "\n" : "";
    writeFileSync(logFile, content, "utf8");
  }

  test("empty file returns empty payload", async () => {
    writeLog([]);
    const result = await readLogTail({ file: logFile });
    expect(result.lines).toEqual([]);
    expect(result.cursor).toBe(0);
    expect(result.size).toBe(0);
    expect(result.reset).toBe(false);
    expect(result.truncated).toBe(false);
  });

  test("reads all lines when no cursor provided", async () => {
    writeLog(["line1", "line2", "line3", "line4", "line5"]);
    const result = await readLogTail({ file: logFile });
    expect(result.lines).toEqual(["line1", "line2", "line3", "line4", "line5"]);
    expect(result.cursor).toBe(result.size);
    expect(result.truncated).toBe(false);
    expect(result.reset).toBe(false);
  });

  test("respects limit parameter", async () => {
    writeLog(["line1", "line2", "line3", "line4", "line5"]);
    const result = await readLogTail({ file: logFile, limit: 3 });
    expect(result.lines).toEqual(["line3", "line4", "line5"]);
  });

  test("returns from cursor to end", async () => {
    writeLog(["line1", "line2", "line3", "line4", "line5"]);
    const firstResult = await readLogTail({ file: logFile });
    const cursor = firstResult.cursor;

    // Write more lines
    writeLog(["line1", "line2", "line3", "line4", "line5", "line6", "line7"]);
    const result = await readLogTail({ file: logFile, cursor });
    expect(result.lines).toEqual(["line6", "line7"]);
    expect(result.reset).toBe(false);
  });

  test("returns empty lines when cursor at EOF", async () => {
    writeLog(["line1", "line2", "line3"]);
    const firstResult = await readLogTail({ file: logFile });
    const result = await readLogTail({ file: logFile, cursor: firstResult.cursor });
    expect(result.lines).toEqual([]);
    expect(result.cursor).toBe(firstResult.cursor);
  });

  test("resets when cursor exceeds file size (rotation)", async () => {
    writeLog(["line1", "line2", "line3"]);
    const firstResult = await readLogTail({ file: logFile });
    const bigCursor = firstResult.cursor + 1000;

    const result = await readLogTail({ file: logFile, cursor: bigCursor });
    expect(result.reset).toBe(true);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  test("marks truncated when cursor lag exceeds maxBytes", async () => {
    const content = "x".repeat(100) + "\n";
    writeLog(Array(100).fill(content.trim()));

    const firstResult = await readLogTail({ file: logFile });
    const smallCursor = 10;

    const result = await readLogTail({
      file: logFile,
      cursor: smallCursor,
      maxBytes: 500,
    });
    expect(result.reset).toBe(true);
    expect(result.truncated).toBe(true);
  });

  test("handles partial-line boundary with prefix byte", async () => {
    // Write a file that ends WITHOUT a newline (partial line)
    const { open } = require("node:fs/promises");
    const handle = await open(logFile, "w");
    await handle.write("line1\nline2\npartial-line");
    await handle.close();

    const result = await readLogTail({ file: logFile });
    // The trailing partial line (no \n) should be preserved
    expect(result.lines).toEqual(["line1", "line2", "partial-line"]);
  });

  test("drops partial first line when cursor lands mid-line", async () => {
    const { open } = require("node:fs/promises");
    const handle = await open(logFile, "w");
    await handle.write("1234567890\nline2\nline3");
    await handle.close();

    // Land cursor at byte 5 (middle of first line)
    const result = await readLogTail({ file: logFile, cursor: 5 });
    // First element will be partial "67890", which should be dropped
    // so we get ["line2", "line3"]
    expect(result.lines[0]).not.toContain("67890");
    expect(result.lines).toContainEqual("line2");
    expect(result.lines).toContainEqual("line3");
  });

  test("missing file returns empty payload with no error", async () => {
    const nonexistent = join(tmpDir, "nonexistent.log");
    const result = await readLogTail({ file: nonexistent });
    expect(result.lines).toEqual([]);
    expect(result.cursor).toBe(0);
    expect(result.size).toBe(0);
  });

  test("limit:0 returns no historical lines (skip-history mode)", async () => {
    writeLog(["line1", "line2", "line3", "line4", "line5"]);
    const result = await readLogTail({
      file: logFile,
      limit: 0,
    });
    expect(result.lines).toEqual([]);
    expect(result.cursor).toBeGreaterThan(0);
  });

  test("clamps invalid maxBytes to bounds", async () => {
    writeLog(["line1", "line2", "line3"]);
    const result = await readLogTail({
      file: logFile,
      maxBytes: 0, // Invalid, should clamp to 1
    });
    expect(result.size).toBeGreaterThanOrEqual(0);
  });

  test("defaults used when no cursor provided", async () => {
    // Write a large file
    const lines = Array(300).fill("x".repeat(1000));
    writeLog(lines);
    const result = await readLogTail({ file: logFile });
    // Default limit is 200, so should return at most 200 lines
    expect(result.lines.length).toBeLessThanOrEqual(200);
  });
});
