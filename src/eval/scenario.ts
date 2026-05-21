/**
 * Scenario builder — generates trading journey messages per persona.
 */

import { complete } from "@earendil-works/pi-ai";
import type { Model, Api, ProviderStreamOptions, ToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Persona } from "./persona.js";
import { SCENARIO_GEN_PROMPT } from "./prompts/scenario-gen.js";
import { loadGhostContext, formatSkillsContext } from "./ghost-context.js";

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Journey steps — loose coverage guidance for the generator ("test the
 * persona in each of these contexts"). Deliberately NOT tied to specific
 * skill names: the scenario-gen prompt lists the 5 common steps, and the
 * LLM picks whichever skill from the supplied skill list best matches the
 * user intent it just invented. Adding new steps is a prompt-edit, not a
 * code-edit — the type is a free-form string.
 */
export type JourneyStep = string;

export interface ExpectedOutcome {
  /**
   * Best-matching skill for this scenario (free-form). Used for report
   * aggregation and `--skill` filtering only — execution tier does NOT
   * verify skill activation, so a drifted/renamed/removed skill name here
   * never fails a scenario. Adding a new skill to Ghost is a dataset
   * regen, not a schema change.
   */
  primarySkill: string;
  /**
   * Optional descriptive chain — the skills a good Ghost would internally
   * consult on this turn. Judge sees it as a hint; no verification.
   */
  skills?: string[];
  /** Union of ghost_* tools across the chain. Authoritative execution signal. */
  tools?: string[];
  /** Judge-facing free-form violation descriptors (currently unused for scoring). */
  violations?: string[];
  /**
   * The stance a good Ghost should land on when the scenario tests
   * decision-making (decision / execution steps most commonly). Surfaced
   * to the judge as context — does not carry a dedicated deduction.
   */
  decision?: "YES" | "NO" | "WAIT";
  /**
   * When true, Ghost is expected to REFUSE the request (revenge trade,
   * oversized position, missing confirm, etc). `tools` should still list
   * the READ tools Ghost needs for a data-backed pushback; only the write
   * tools are omitted.
   */
  shouldRefuse?: boolean;
  /**
   * One-sentence eval hypothesis. Answers "what is this scenario testing?".
   * Fed to the judge as calibration context so it knows why the scenario
   * was designed this way. Optional — empty string is acceptable.
   */
  intent?: string;
}

export interface Scenario {
  id: string;
  persona: Persona;
  /** Free-form journey-step label (e.g. "research", "decision", or a newly-coined one). */
  step: JourneyStep;
  /** Convenience alias for `expected.primarySkill`. Kept for report/filter code. */
  skill: string;
  /** First turn — kept for backward compatibility with single-turn callers. */
  message: string;
  /** Full conversation sequence. For single-turn this is `[message]`. */
  turns: string[];
  /** Structural assertions (tool-use tier). */
  expected: ExpectedOutcome;
  /** Informational tags (e.g. "fomo", "multi-turn", "edge-case"). */
  tags: string[];
}

/**
 * Non-`ghost_*` tool names that are legitimate entries in a scenario's
 * `expected.tools` because one or more SKILL.md files explicitly mandate
 * them (e.g. pre-trade-advisory and market-intel call `web_search` for
 * broader / breaking coverage). Without this allowlist the bare
 * `.startsWith("ghost_")` filter in `buildScenarios` would silently strip
 * them, and the judge would then flag correct tool use as "unjustified
 * extras".
 *
 * Kept focused: only add a tool here after verifying it appears in a
 * shipped SKILL.md. Related: `SYSTEM_MANDATED_TOOLS` in `assertions.ts`
 * covers tools the *system prompt* forces unconditionally — different
 * layer, different list.
 */
const NON_GHOST_ALLOWED_EXPECTED_TOOLS: ReadonlySet<string> = new Set(["web_search"]);

// ── Scenario generation ──────────────────────────────────────────────────

const GEN_SCENARIOS_TOOL = {
  name: "gen_scenarios",
  description: "Return exactly 5 trading-journey scenarios (one per step) for a persona.",
  parameters: Type.Object({
    scenarios: Type.Array(
      Type.Object({
        step: Type.String({ description: "Short label for the journey stage this scenario covers (e.g. research, analysis, decision, execution, management). Each step must appear exactly once per persona." }),
        turns: Type.Array(Type.String(), { minItems: 1, description: "1-3 user messages. Only user text — Ghost's responses are not included. Multi-turn = user's follow-up after reading Ghost's reply." }),
        intent: Type.String({ description: "One-sentence eval hypothesis: what is this scenario testing? (e.g., 'Ghost should refuse a revenge trade even when persona pushes back')." }),
        primarySkill: Type.String({ description: "The skill whose description best matches the user intent in this scenario. Pick from the skill specifications injected below — do NOT invent a name not in that list." }),
        expectedSkills: Type.Array(Type.String(), { description: "Optional descriptive context — the full skill chain a good Ghost would internally consult. Pick from the injected skill list only." }),
        expectedTools: Type.Array(Type.String(), { description: "Union of ghost_* tools across the chain that a good Ghost SHOULD call, based on SKILL.md mandates. This is the authoritative execution signal. For refusal scenarios, list the READ tools (positions, balance, price, funding) Ghost must still call to frame a data-backed pushback — the write tools are the only ones to OMIT. Empty array is reserved for rare zero-tool scenarios (e.g. pure greeting)." }),
        expectedDecision: Type.Optional(Type.Union([Type.Literal("YES"), Type.Literal("NO"), Type.Literal("WAIT")], { description: "Optional — the stance a good Ghost should take for this persona + context. Most useful for decision/execution steps." })),
        shouldRefuse: Type.Optional(Type.Boolean({ description: "True when Ghost should REFUSE the request (revenge trade, oversized position, place without confirm, etc.). When true, expectedTools should still list the READ tools Ghost needs to pushback with data; only the write tools (ghost_place_order, ghost_bracket_order, etc.) are omitted." })),
        tags: Type.Array(Type.String(), { description: "Short tags: fomo, multi-turn, edge-case, revenge-trade, underspecified, refusal, etc." }),
      }),
    ),
  }),
};

export async function buildScenarios(
  persona: Persona,
  model: Model<Api>,
  getApiKey: (provider: string) => Promise<string | undefined>,
  evalSkills: readonly string[],
  skillFilter?: string,
): Promise<Scenario[]> {
  const personaContext = formatPersonaForPrompt(persona);

  const skillsContext = formatSkillsContext(loadGhostContext(evalSkills));
  const systemPrompt = skillsContext
    ? `${SCENARIO_GEN_PROMPT}\n\n${skillsContext}`
    : SCENARIO_GEN_PROMPT;
  const context = {
    systemPrompt,
    messages: [
      {
        role: "user" as const,
        content: `Generate trading journey scenarios for this persona:\n\n${personaContext}`,
        timestamp: Date.now(),
      },
    ],
    tools: [GEN_SCENARIOS_TOOL],
  };
  const apiKey = await getApiKey(model.provider);

  // Try forced tool_choice first; fall back to free choice if that fails.
  let response;
  try {
    response = await complete(model, context, {
      tool_choice: { type: "function", function: { name: "gen_scenarios" } },
      apiKey,
    } as ProviderStreamOptions);
  } catch (err) {
    response = await complete(model, context, { apiKey } as ProviderStreamOptions);
    console.warn(`  [scenario-gen] forced tool_choice failed (${err instanceof Error ? err.message : String(err)}), retrying without`);
  }

  const toolCall = response.content.find(
    (c): c is ToolCall => c.type === "toolCall" && c.name === "gen_scenarios",
  );
  if (!toolCall) {
    const textParts = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const preview = textParts.slice(0, 400);
    console.warn(`  [scenario-gen] no tool call in response for persona "${persona.name}". Response preview: ${preview}`);
    return [];
  }

  const args = typeof toolCall.arguments === "string"
    ? JSON.parse(toolCall.arguments)
    : toolCall.arguments;

  const scenarios: Scenario[] = [];
  const raw = (args.scenarios ?? []) as Array<{
    step?: string;
    turns?: string[];
    intent?: string;
    primarySkill?: string;
    expectedSkills?: string[];
    expectedTools?: string[];
    expectedDecision?: "YES" | "NO" | "WAIT";
    shouldRefuse?: boolean;
    tags?: string[];
  }>;

  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    const step = typeof s.step === "string" && s.step.trim() ? s.step.trim() : "";
    if (!step) continue;
    const primarySkill = typeof s.primarySkill === "string" && s.primarySkill.trim()
      ? s.primarySkill.trim()
      : "";
    if (!primarySkill) continue;
    if (skillFilter && primarySkill !== skillFilter && !primarySkill.startsWith(skillFilter)) continue;

    const turns = Array.isArray(s.turns) && s.turns.length > 0 ? s.turns.map(String) : [];
    if (turns.length === 0) continue;

    const rawSkills = Array.isArray(s.expectedSkills)
      ? s.expectedSkills.map(String).filter((k) => k.trim().length > 0)
      : [];
    const skills = rawSkills.length > 0
      ? Array.from(new Set([primarySkill, ...rawSkills]))
      : [primarySkill];

    const expectedTools = Array.isArray(s.expectedTools)
      ? s.expectedTools
          .map(String)
          .filter((t) => t.startsWith("ghost_") || NON_GHOST_ALLOWED_EXPECTED_TOOLS.has(t))
      : [];

    const tags = Array.isArray(s.tags) ? s.tags.map(String) : [];
    const slug = persona.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    scenarios.push({
      id: `${slug}-${step}-${i + 1}`,
      persona,
      step,
      skill: primarySkill,
      message: turns[0],
      turns,
      expected: {
        primarySkill,
        skills,
        tools: expectedTools,
        intent: typeof s.intent === "string" ? s.intent : "",
        ...(s.expectedDecision ? { decision: s.expectedDecision } : {}),
        ...(s.shouldRefuse ? { shouldRefuse: true } : {}),
      },
      tags: ["generated", step, ...tags],
    });
  }
  return scenarios;
}


function formatPersonaForPrompt(p: Persona): string {
  return [
    `**Name:** ${p.name}`,
    `**Experience:** ${p.experience}`,
    `**Portfolio:** $${p.portfolioSize.toLocaleString()}`,
    `**Risk behavior:** ${p.riskBehavior}`,
    `**Emotional state:** ${p.emotionalState}`,
    `**Market context:** ${p.marketContext}`,
    `**Time pressure:** ${p.timePressure}`,
    `**Trading style:** ${p.tradingStyle}`,
    `**Language style:** ${p.languageStyle}`,
    `**Backstory:** ${p.backstory}`,
  ].join("\n");
}
