import { describe, test, expect } from "bun:test";
import { generateGhostCloid, isGhostCloid, GHOST_CLOID_PREFIX } from "../../src/helpers/cloid";

describe("cloid", () => {
  test("GHOST_CLOID_PREFIX is exactly 0x67686f7374 (ASCII 'ghost')", () => {
    expect(GHOST_CLOID_PREFIX).toBe("0x67686f7374");
  });

  test("generateGhostCloid produces 32 hex chars after 0x (HL constraint)", () => {
    const cloid = generateGhostCloid();
    expect(cloid).toMatch(/^0x[a-f0-9]{32}$/);
  });

  test("generateGhostCloid always starts with the Ghost prefix", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateGhostCloid().startsWith(GHOST_CLOID_PREFIX)).toBe(true);
    }
  });

  test("generateGhostCloid produces unique values", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateGhostCloid());
    expect(seen.size).toBe(100);
  });

  test("isGhostCloid matches Ghost cloid (lowercase)", () => {
    expect(isGhostCloid("0x67686f73740123456789abcdef012345")).toBe(true);
  });

  test("isGhostCloid matches Ghost cloid (mixed case)", () => {
    expect(isGhostCloid("0x67686F7374ABCDEF0123456789ABCDEF")).toBe(true);
  });

  test("isGhostCloid rejects non-Ghost cloid", () => {
    expect(isGhostCloid("0x000000000000000000000000ff000000")).toBe(false);
  });

  test("isGhostCloid rejects undefined / null / empty", () => {
    expect(isGhostCloid(undefined)).toBe(false);
    expect(isGhostCloid(null)).toBe(false);
    expect(isGhostCloid("")).toBe(false);
  });
});
