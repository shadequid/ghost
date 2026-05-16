import { describe, test, expect, beforeAll } from "bun:test";
import { existsSync, statSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..", "..");
const DIST = join(ROOT, "dist");

describe("copy-assets.mjs", () => {
  beforeAll(() => {
    // Wipe dist/ first so we assert against fresh build output, not stale state
    if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
    const result = spawnSync("bun", ["run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      timeout: 120_000,
    });
    expect(result.status).toBe(0);
  }, 120_000);

  test("dist/index.js exists and has shebang", () => {
    expect(existsSync(join(DIST, "index.js"))).toBe(true);
    const head = readFileSync(join(DIST, "index.js"), "utf8").slice(0, 32);
    expect(head).toContain("#!/usr/bin/env bun");
  });

  test("dist/index.js has owner-execute bit", () => {
    const mode = statSync(join(DIST, "index.js")).mode;
    expect(mode & 0o100).toBe(0o100);
  });

  test("dist/package.json copied", () => {
    expect(existsSync(join(DIST, "package.json"))).toBe(true);
  });

  test("dist/templates/SOUL.md copied", () => {
    expect(existsSync(join(DIST, "templates", "SOUL.md"))).toBe(true);
  });

  test("dist/skills/builtin copied and non-empty", () => {
    expect(existsSync(join(DIST, "skills", "builtin"))).toBe(true);
  });

  test("dist/web/dist copied (prebuilt SPA)", () => {
    expect(existsSync(join(DIST, "web", "dist", "index.html"))).toBe(true);
  });
});
