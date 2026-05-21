import { describe, test, expect } from "bun:test";
import pino from "pino";
import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { TSchema } from "@earendil-works/pi-ai";
import { ToolRegistry } from "../../src/tools/registry.js";
import { assertExecution } from "../../src/eval/assertions.js";
import type { Scenario } from "../../src/eval/scenario.js";
import type { Persona } from "../../src/eval/persona.js";

const PERSONA: Persona = {
  name: "Test",
  source: "fixed",
  experience: "",
  portfolioSize: 1000,
  riskBehavior: "",
  emotionalState: "",
  marketContext: "",
  timePressure: "",
  tradingStyle: "",
  languageStyle: "",
  backstory: "",
};

function scenario(expected: Partial<Scenario["expected"]> & { skill?: string }): Scenario {
  const primarySkill = expected.primarySkill ?? expected.skill ?? "";
  const full: Scenario["expected"] = {
    ...(expected as Partial<Scenario["expected"]>),
    primarySkill,
    skills: expected.skills ?? (primarySkill ? [primarySkill] : []),
  };
  return {
    id: "t",
    persona: PERSONA,
    step: "research",
    skill: primarySkill || "market-intel",
    message: "hi",
    turns: ["hi"],
    expected: full,
    tags: [],
  };
}

function makeRegistry(): ToolRegistry {
  const reg = new ToolRegistry(pino({ level: "silent" }));
  const tool: AgentTool<TSchema> = {
    name: "ghost_get_price",
    description: "",
    label: "Get Price",
    parameters: Type.Object({ symbol: Type.String() }),
    execute: async () => ({ content: [], details: {} }),
  };
  reg.register(tool);
  return reg;
}

describe("assertExecution — tool-use only", () => {
  test("skipped when scenario has no expected tools", () => {
    const r = assertExecution(scenario({ skill: "market-intel" }), [], makeRegistry());
    expect(r.status).toBe("skipped");
  });

  test("pass when required tools called with valid args", () => {
    const r = assertExecution(
      scenario({ skill: "market-intel", tools: ["ghost_get_price"] }),
      [{ name: "ghost_get_price", arguments: { symbol: "BTC" } }],
      makeRegistry(),
    );
    expect(r.status).toBe("pass");
    expect(r.extras).toEqual([]);
  });

  test("fail when required tool missing", () => {
    const r = assertExecution(
      scenario({ skill: "market-intel", tools: ["ghost_get_price", "ghost_news_search"] }),
      [{ name: "ghost_get_price", arguments: { symbol: "BTC" } }],
      makeRegistry(),
    );
    expect(r.status).toBe("fail");
    expect(r.missingRequired).toEqual(["ghost_news_search"]);
  });

  test("fail when param schema violated", () => {
    const r = assertExecution(
      scenario({ skill: "market-intel", tools: ["ghost_get_price"] }),
      [{ name: "ghost_get_price", arguments: { symbol: 123 } }],
      makeRegistry(),
    );
    expect(r.status).toBe("fail");
    expect(r.invalidParams).toContain("ghost_get_price");
  });

  test("extras are informational — don't fail execution", () => {
    const r = assertExecution(
      scenario({ skill: "market-intel", tools: ["ghost_get_price"] }),
      [
        { name: "ghost_get_price", arguments: { symbol: "BTC" } },
        { name: "ghost_news_search", arguments: {} },
        { name: "ghost_get_funding_rates", arguments: {} },
        { name: "ghost_market_overview", arguments: {} },
      ],
      makeRegistry(),
    );
    expect(r.status).toBe("pass");
    expect(r.extras).toHaveLength(3);
  });
});
