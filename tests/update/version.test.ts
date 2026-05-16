import { describe, test, expect } from "bun:test";
import { formatHintLine, formatUpdateHint } from "../../src/update/version.js";

describe("formatUpdateHint", () => {
  test("returns null when cache is absent", () => {
    expect(formatUpdateHint("0.0.1", null)).toBeNull();
  });

  test("returns null when last fetch failed (latestVersion=null)", () => {
    expect(
      formatUpdateHint("0.0.1", { latestVersion: null, checkedAt: 1 }),
    ).toBeNull();
  });

  test("returns null when current version is unknown", () => {
    expect(
      formatUpdateHint("unknown", { latestVersion: "0.0.5", checkedAt: 1 }),
    ).toBeNull();
  });

  test("returns null when cached version equals current", () => {
    expect(
      formatUpdateHint("0.0.5", { latestVersion: "0.0.5", checkedAt: 1 }),
    ).toBeNull();
  });

  test("returns null when cached version is older than current", () => {
    expect(
      formatUpdateHint("0.1.0", { latestVersion: "0.0.9", checkedAt: 1 }),
    ).toBeNull();
  });

  test("returns hint string when cached version is newer", () => {
    const hint = formatUpdateHint("0.0.1", { latestVersion: "0.0.2", checkedAt: 1 });
    expect(hint).toBe("(update available: v0.0.2 — run `ghost update`)");
  });
});

describe("formatHintLine", () => {
  test("returns null when latest is null", () => {
    expect(formatHintLine("0.0.1", null)).toBeNull();
  });

  test("returns null when current version is unknown", () => {
    expect(formatHintLine("unknown", "0.0.5")).toBeNull();
  });

  test("returns null when latest equals current", () => {
    expect(formatHintLine("0.0.5", "0.0.5")).toBeNull();
  });

  test("returns null when latest is older than current", () => {
    expect(formatHintLine("0.1.0", "0.0.9")).toBeNull();
  });

  test("returns hint string when latest is newer", () => {
    expect(formatHintLine("0.0.1", "0.0.2")).toBe(
      "(update available: v0.0.2 — run `ghost update`)",
    );
  });
});
