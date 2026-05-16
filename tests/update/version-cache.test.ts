import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readUpdateCache,
  writeUpdateCache,
  getUpdateCachePath,
} from "../../src/update/version-cache.js";

function withTmp<T>(fn: (path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "update-cache-"));
  try {
    return fn(join(dir, "update-cache.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("readUpdateCache", () => {
  test("returns null when file does not exist", () => {
    withTmp((path) => {
      expect(readUpdateCache(path)).toBeNull();
    });
  });

  test("returns null when JSON is malformed", () => {
    withTmp((path) => {
      writeFileSync(path, "{not json");
      expect(readUpdateCache(path)).toBeNull();
    });
  });

  test("returns null when fields are missing", () => {
    withTmp((path) => {
      writeFileSync(path, JSON.stringify({ latestVersion: "1.0.0" }));
      expect(readUpdateCache(path)).toBeNull();
    });
  });

  test("returns null when checkedAt is wrong type", () => {
    withTmp((path) => {
      writeFileSync(
        path,
        JSON.stringify({ latestVersion: "1.0.0", checkedAt: "now" }),
      );
      expect(readUpdateCache(path)).toBeNull();
    });
  });

  test("returns null when latestVersion is wrong type", () => {
    withTmp((path) => {
      writeFileSync(
        path,
        JSON.stringify({ latestVersion: 42, checkedAt: Date.now() }),
      );
      expect(readUpdateCache(path)).toBeNull();
    });
  });

  test("returns cache when latestVersion is explicitly null (failed fetch snapshot)", () => {
    withTmp((path) => {
      const snap = { latestVersion: null, checkedAt: 1_700_000_000_000 };
      writeFileSync(path, JSON.stringify(snap));
      expect(readUpdateCache(path)).toEqual(snap);
    });
  });
});

describe("writeUpdateCache + readUpdateCache round-trip", () => {
  test("persists and reads back a successful fetch snapshot", () => {
    withTmp((path) => {
      const snap = { latestVersion: "0.0.2", checkedAt: 1_700_000_000_000 };
      writeUpdateCache(snap, path);
      expect(readUpdateCache(path)).toEqual(snap);
    });
  });

  test("overwrites previous snapshot", () => {
    withTmp((path) => {
      writeUpdateCache({ latestVersion: "0.0.1", checkedAt: 1_000 }, path);
      writeUpdateCache({ latestVersion: "0.0.2", checkedAt: 2_000 }, path);
      expect(readUpdateCache(path)).toEqual({
        latestVersion: "0.0.2",
        checkedAt: 2_000,
      });
    });
  });

  test("atomic write — does not leave the tmp file behind on success", () => {
    withTmp((path) => {
      writeUpdateCache({ latestVersion: "0.0.9", checkedAt: 5 }, path);
      expect(existsSync(path)).toBe(true);
      expect(existsSync(`${path}.tmp`)).toBe(false);
    });
  });

  test("atomic write — previous cache remains intact when a partial tmp already exists", () => {
    // The rename replaces the destination atomically, so a stray tmp
    // from a crashed prior write must never corrupt the live cache.
    withTmp((path) => {
      const original = { latestVersion: "0.0.1", checkedAt: 1 };
      writeUpdateCache(original, path);

      // Simulate a leftover tmp file from a crashed previous write.
      writeFileSync(`${path}.tmp`, "{ partial");
      expect(readUpdateCache(path)).toEqual(original);

      // Next successful write cleans up by rename.
      writeUpdateCache({ latestVersion: "0.0.2", checkedAt: 2 }, path);
      expect(readUpdateCache(path)).toEqual({
        latestVersion: "0.0.2",
        checkedAt: 2,
      });
      expect(existsSync(`${path}.tmp`)).toBe(false);
    });
  });

  test("write errors are swallowed (never throws)", () => {
    // Writing under a path that doesn't exist should fail silently —
    // the cache is best-effort and must never crash the caller.
    const bogus = join(tmpdir(), "definitely-not-a-dir", "x", "y.json");
    expect(() =>
      writeUpdateCache({ latestVersion: "0.0.1", checkedAt: 1 }, bogus),
    ).not.toThrow();
    expect(readUpdateCache(bogus)).toBeNull();
  });
});

describe("getUpdateCachePath", () => {
  test("points at update-cache.json under the Ghost dir", () => {
    const p = getUpdateCachePath();
    expect(p.endsWith("update-cache.json")).toBe(true);
  });

  test("round-trip via getUpdateCachePath honors GHOST_HOME override", () => {
    const prev = Bun.env["GHOST_HOME"];
    const dir = mkdtempSync(join(tmpdir(), "ghost-home-"));
    try {
      Bun.env["GHOST_HOME"] = dir;
      const path = getUpdateCachePath();
      expect(path.startsWith(dir)).toBe(true);
      writeUpdateCache({ latestVersion: "1.2.3", checkedAt: 42 }, path);
      const raw = readFileSync(path, "utf-8");
      expect(JSON.parse(raw)).toEqual({ latestVersion: "1.2.3", checkedAt: 42 });
    } finally {
      if (prev === undefined) delete Bun.env["GHOST_HOME"];
      else Bun.env["GHOST_HOME"] = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
