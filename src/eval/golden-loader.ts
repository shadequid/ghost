/**
 * Golden dataset loader — reads frozen personas and scenarios from disk.
 *
 * Layout (repo-checked-in at `eval-data/golden/`):
 *   personas/<name>.json      Persona shape (see src/eval/persona.ts)
 *   scenarios/<id>.json       GoldenScenario (see below)
 *
 * Scenarios reference personas by name. Loader resolves refs, validates shape,
 * and returns ready-to-run Scenario[] compatible with the rest of the eval
 * pipeline.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Persona } from "./persona.js";
import type { Scenario } from "./scenario.js";

// ── Schemas ──────────────────────────────────────────────────────────────

const personaSchema = z.object({
  name: z.string(),
  experience: z.string(),
  portfolioSize: z.number(),
  riskBehavior: z.string(),
  emotionalState: z.string(),
  marketContext: z.string(),
  timePressure: z.string(),
  tradingStyle: z.string(),
  languageStyle: z.string(),
  backstory: z.string(),
});

const goldenScenarioSchema = z.object({
  id: z.string(),
  personaRef: z.string(),
  turns: z.array(z.string()).min(1),
  expected: z.object({
    // v2 fields
    primarySkill: z.string().optional(),
    skills: z.array(z.string()).optional(),
    intent: z.string().optional(),
    shouldRefuse: z.boolean().optional(),
    // shared
    tools: z.array(z.string()).optional(),
    violations: z.array(z.string()).optional(),
    decision: z.enum(["YES", "NO", "WAIT"]).optional(),
    // v1 legacy (accepted for backward compat; normalized in loadGolden)
    skill: z.string().optional(),
  }),
  tags: z.array(z.string()).default([]),
});

export type GoldenScenario = z.infer<typeof goldenScenarioSchema>;

// ── Loader ───────────────────────────────────────────────────────────────

export function loadGolden(rootDir: string): Scenario[] {
  if (!existsSync(rootDir)) {
    throw new Error(`Golden dataset not found at ${rootDir}`);
  }
  const personas = loadPersonas(join(rootDir, "personas"));
  const scenarios = loadScenarios(join(rootDir, "scenarios"));

  const resolved: Scenario[] = [];
  for (const g of scenarios) {
    const persona = personas.get(g.personaRef);
    if (!persona) {
      throw new Error(`Scenario ${g.id} references unknown persona "${g.personaRef}"`);
    }
    // v1 → v2 normalization: old scenarios only had `expected.skill`. New
    // scenarios have `primarySkill` + optional `skills[]`. Prefer v2 fields,
    // fall back to v1 so existing golden files keep loading.
    const primarySkill = g.expected.primarySkill ?? g.expected.skill ?? "unknown";
    const skills = g.expected.skills && g.expected.skills.length > 0
      ? Array.from(new Set([primarySkill, ...g.expected.skills]))
      : [primarySkill];

    resolved.push({
      id: g.id,
      persona,
      // Derive the journey step from the id ("<persona>-<step>-<n>" per the
      // scenario generator's slug rule). Earlier versions set step to
      // `primarySkill`, which silently broke step-based ordering in the
      // runner (sorter looked for "research"/"decision"/... but saw skill
      // names like "market-intel"). Falling back to primarySkill preserves
      // behavior for any hand-authored scenario that doesn't follow the
      // slug pattern.
      step: parseStepFromId(g.id) ?? (primarySkill as Scenario["step"]),
      skill: primarySkill,
      message: g.turns[0],
      turns: g.turns,
      expected: {
        primarySkill,
        skills,
        tools: g.expected.tools,
        violations: g.expected.violations,
        intent: g.expected.intent ?? "",
        ...(g.expected.decision ? { decision: g.expected.decision } : {}),
        ...(g.expected.shouldRefuse ? { shouldRefuse: true } : {}),
      },
      tags: g.tags,
    });
  }
  return resolved;
}

/**
 * Extract the journey step from an id shaped like "<persona>-<step>-<n>"
 * (the generator's slug format). Returns null if the id doesn't match —
 * hand-curated scenarios can opt out and the caller falls back to
 * `primarySkill`.
 */
function parseStepFromId(id: string): string | null {
  const m = id.match(/-([a-z0-9]+)-\d+$/i);
  return m ? m[1] : null;
}

function loadPersonas(dir: string): Map<string, Persona> {
  const map = new Map<string, Persona>();
  if (!existsSync(dir)) return map;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    const parsed = personaSchema.parse(raw);
    // Key by slug — must match the slug regen writes (lowercase + non-[a-z0-9]
    // runs collapsed to "-"). Using raw lowercase name breaks on accents or
    // spaces, e.g. "Tomás" stays as "tomás" but scenarios reference "tom-s".
    const slug = parsed.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    map.set(slug, { ...parsed, source: "fixed" });
  }
  return map;
}

/**
 * Accepts either one scenario per file, or a file containing `{ scenarios: [...] }`,
 * or a bare array of scenarios. Bundled files make the dataset easier to curate
 * by hand; per-file layout makes diffs easier. Both are supported.
 */
function loadScenarios(dir: string): GoldenScenario[] {
  if (!existsSync(dir)) return [];
  const out: GoldenScenario[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    const batch: unknown[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as { scenarios?: unknown[] }).scenarios)
        ? (raw as { scenarios: unknown[] }).scenarios
        : [raw];
    for (const item of batch) {
      out.push(goldenScenarioSchema.parse(item));
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
