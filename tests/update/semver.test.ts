import { describe, test, expect } from "bun:test";
import { semverGt } from "../../src/update/semver.js";

describe("semverGt", () => {
  test("patch / minor / major ordering", () => {
    expect(semverGt("0.0.2", "0.0.1")).toBe(true);
    expect(semverGt("0.0.1", "0.0.2")).toBe(false);
    expect(semverGt("0.1.0", "0.0.9")).toBe(true);
    expect(semverGt("2.0.0", "1.99.99")).toBe(true);
  });

  test("equal versions are not greater", () => {
    expect(semverGt("1.2.3", "1.2.3")).toBe(false);
  });

  test("release > pre-release of the same core", () => {
    expect(semverGt("0.0.2", "0.0.2-rc.1")).toBe(true);
    expect(semverGt("0.0.2-rc.1", "0.0.2")).toBe(false);
  });

  test("pre-release numeric identifiers compare numerically (rc.10 > rc.9)", () => {
    expect(semverGt("0.0.2-rc.10", "0.0.2-rc.9")).toBe(true);
    expect(semverGt("0.0.2-rc.9", "0.0.2-rc.10")).toBe(false);
    expect(semverGt("0.0.2-rc.100", "0.0.2-rc.99")).toBe(true);
  });

  test("longer pre-release identifier wins when prefix matches", () => {
    expect(semverGt("0.0.2-rc.1.2", "0.0.2-rc.1")).toBe(true);
  });

  test("malformed inputs are never greater", () => {
    expect(semverGt("abc", "0.0.1")).toBe(false);
    expect(semverGt("0.0.1", "abc")).toBe(false);
    expect(semverGt("", "0.0.1")).toBe(false);
  });
});
