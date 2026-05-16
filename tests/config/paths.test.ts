import { describe, test, expect } from "bun:test";
import { getCliHandoffPath } from "../../src/config/paths.js";

describe("getCliHandoffPath", () => {
  test("returns path under workspace directory", () => {
    const result = getCliHandoffPath();
    expect(result).toContain("workspace");
    expect(result).toEndWith("cli-handoff.json");
  });

  test("respects GHOST_HOME override", () => {
    const original = Bun.env.GHOST_HOME;
    try {
      Bun.env.GHOST_HOME = "/tmp/test-ghost";
      const result = getCliHandoffPath();
      expect(result).toStartWith("/tmp/test-ghost");
      expect(result).toContain("workspace");
      expect(result).toEndWith("cli-handoff.json");
    } finally {
      if (original === undefined) {
        delete Bun.env.GHOST_HOME;
      } else {
        Bun.env.GHOST_HOME = original;
      }
    }
  });
});
