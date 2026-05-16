import { describe, test, expect } from "bun:test";
import type { AutonomyLevel, CommandRiskLevel } from "../../src/core/types.js";

describe("Core types", () => {
  test("AutonomyLevel and CommandRiskLevel are usable", () => {
    const level: AutonomyLevel = "supervised";
    const risk: CommandRiskLevel = "high";
    expect(level).toBe("supervised");
    expect(risk).toBe("high");
  });
});
