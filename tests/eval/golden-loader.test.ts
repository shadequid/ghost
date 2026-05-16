import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadGolden } from "../../src/eval/golden-loader.js";

function seedDir(): string {
  const root = mkdtempSync(join(tmpdir(), "golden-"));
  mkdirSync(join(root, "personas"));
  mkdirSync(join(root, "scenarios"));
  writeFileSync(
    join(root, "personas", "alice.json"),
    JSON.stringify({
      name: "Alice",
      experience: "1y",
      portfolioSize: 1000,
      riskBehavior: "cautious",
      emotionalState: "calm",
      marketContext: "sideways",
      timePressure: "relaxed",
      tradingStyle: "swing",
      languageStyle: "en casual",
      backstory: "tester",
    }),
  );
  return root;
}

describe("loadGolden", () => {
  test("resolves personaRef and loads scenarios", () => {
    const root = seedDir();
    writeFileSync(
      join(root, "scenarios", "s1.json"),
      JSON.stringify({
        id: "s1",
        personaRef: "alice",
        turns: ["hi"],
        expected: { skill: "market-intel", tools: ["ghost_get_price"] },
      }),
    );
    const out = loadGolden(root);
    expect(out).toHaveLength(1);
    expect(out[0].persona.name).toBe("Alice");
    // Loader normalizes v1 `skill` → v2 `primarySkill`.
    expect(out[0].expected.primarySkill).toBe("market-intel");
    expect(out[0].skill).toBe("market-intel");
    expect(out[0].turns).toEqual(["hi"]);
  });

  test("bundle file with scenarios array", () => {
    const root = seedDir();
    writeFileSync(
      join(root, "scenarios", "bundle.json"),
      JSON.stringify({
        scenarios: [
          { id: "a", personaRef: "alice", turns: ["q1"], expected: {} },
          { id: "b", personaRef: "alice", turns: ["q2", "q3"], expected: { skill: "market-intel" } },
        ],
      }),
    );
    const out = loadGolden(root);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.id === "b")?.turns).toHaveLength(2);
  });

  test("derives journey step from id slug", () => {
    const root = seedDir();
    writeFileSync(
      join(root, "scenarios", "bundle.json"),
      JSON.stringify({
        scenarios: [
          { id: "alice-research-1", personaRef: "alice", turns: ["q"], expected: { primarySkill: "market-intel" } },
          { id: "alice-decision-3", personaRef: "alice", turns: ["q"], expected: { primarySkill: "pre-trade-advisory" } },
          // Hand-authored scenario whose id doesn't follow the slug pattern —
          // loader should fall back to primarySkill so step stays non-empty.
          { id: "custom", personaRef: "alice", turns: ["q"], expected: { primarySkill: "risk-manager" } },
        ],
      }),
    );
    const out = loadGolden(root);
    const byId = new Map(out.map((s) => [s.id, s]));
    expect(byId.get("alice-research-1")?.step).toBe("research");
    expect(byId.get("alice-decision-3")?.step).toBe("decision");
    expect(byId.get("custom")?.step).toBe("risk-manager");
  });

  test("unknown personaRef throws", () => {
    const root = seedDir();
    writeFileSync(
      join(root, "scenarios", "bad.json"),
      JSON.stringify({ id: "bad", personaRef: "ghost", turns: ["x"], expected: {} }),
    );
    expect(() => loadGolden(root)).toThrow(/unknown persona/);
  });
});
