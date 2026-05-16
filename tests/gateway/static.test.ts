import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWebDist } from "../../src/gateway/static.js";

describe("resolveWebDist", () => {
  // Behavioral test using injectable candidates — no filesystem dependency on a built web/dist
  test("returns the first candidate whose index.html exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "resolve-webdist-"));
    try {
      const second = join(tmp, "second");
      mkdirSync(second, { recursive: true });
      writeFileSync(join(second, "index.html"), "<html/>");
      const first = join(tmp, "first-missing"); // does not exist
      const third = join(tmp, "third");
      mkdirSync(third, { recursive: true });
      writeFileSync(join(third, "index.html"), "<html/>");

      const resolved = resolveWebDist([first, second, third]);
      expect(resolved).toBe(second);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("returns null when no candidate exists", () => {
    const resolved = resolveWebDist(["/nonexistent/a", "/nonexistent/b"]);
    expect(resolved).toBeNull();
  });

  // Integration test: only runs when the project's web/dist is actually built
  const builtDist = join(import.meta.dir, "..", "..", "web", "dist", "index.html");
  test.skipIf(!existsSync(builtDist))(
    "production-mode resolves to a real built web/dist when present",
    () => {
      const resolved = resolveWebDist();
      expect(resolved).not.toBeNull();
      expect(existsSync(join(resolved!, "index.html"))).toBe(true);
    },
  );
});
