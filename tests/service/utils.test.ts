import { describe, test, expect } from "bun:test";
import { escapeXml, resolveGhostExecPath, ensureLogDir } from "../../src/services/os/utils.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("escapeXml", () => {
  test("escapes the five XML entities", () => {
    expect(escapeXml(`<a b="c" d='e' & f>`)).toBe(
      "&lt;a b=&quot;c&quot; d=&apos;e&apos; &amp; f&gt;",
    );
  });

  test("returns empty string unchanged", () => {
    expect(escapeXml("")).toBe("");
  });

  test("leaves safe strings unchanged", () => {
    expect(escapeXml("hello world")).toBe("hello world");
  });
});

describe("resolveGhostExecPath", () => {
  test("returns an absolute path", () => {
    const p = resolveGhostExecPath();
    expect(p.startsWith("/") || /^[A-Z]:/i.test(p)).toBe(true);
  });
});

describe("ensureLogDir", () => {
  test("creates directory if missing", () => {
    const dir = join(tmpdir(), `ghost-log-test-${Date.now()}`);
    ensureLogDir(dir);
    expect(existsSync(dir)).toBe(true);
  });

  test("is idempotent on existing dir", () => {
    const dir = join(tmpdir(), `ghost-log-test-idem-${Date.now()}`);
    ensureLogDir(dir);
    ensureLogDir(dir);
    expect(existsSync(dir)).toBe(true);
  });
});
