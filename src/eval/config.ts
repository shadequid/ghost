/**
 * Eval configuration — Zod schema with sensible defaults.
 */

import { z } from "zod";

/**
 * Default skill list loaded into scenario-gen context. Covers Ghost's core
 * trading skills. Exported so regen (and any future dataset tooling) can
 * reuse the same default instead of redeclaring it.
 */
export const DEFAULT_EVAL_SKILLS: readonly string[] = [
  "market-intel",
  "technical-analysis",
  "pre-trade-advisory",
  "trade-executor",
  "ask-user-questions",
  "risk-manager",
  "position-monitor",
];

export const evalConfigSchema = z.object({
  /** Filter eval to a single skill (e.g. "pre-trade-advisory"). Empty = all skills. */
  skill: z.string().default(""),
  /** Filter eval to one scenario by id (e.g. "marcus-decision"). Empty = no id filter. */
  scenarioId: z.string().default(""),
  /** Cap number of scenarios executed after all filters. 0 = no cap. */
  limit: z.coerce.number().int().min(0).default(0),
  /** Number of LLM-generated personas to add on top of the golden set. 0 = golden only. */
  generatedCount: z.coerce.number().int().min(0).default(0),
  /** Include the 4 fixed golden personas. */
  includeFixed: z.boolean().default(true),
  /** Path to golden dataset root (personas/ + scenarios/). */
  goldenDir: z.string().default("eval-data/golden"),
  /**
   * Skills to include in eval (directory names under `src/skills/builtin/`).
   * Scenario generator picks `primarySkill` from this list based on user
   * intent; skills not in this list are never tested. Empty = SOUL-only
   * context, LLM guesses at tools (not recommended). Adding/removing a
   * skill from Ghost is a config change here, not a code change.
   */
  evalSkills: z.array(z.string()).default([...DEFAULT_EVAL_SKILLS]),
  /** LLM provider for judge calls. Default differs from Ghost to reduce self-bias. */
  judgeProvider: z.string().default("openrouter"),
  /** Model ID for judge calls. */
  judgeModel: z.string().default("anthropic/claude-sonnet-4"),
  /** Paper trading initial balance for eval runtime. */
  paperBalance: z.coerce.number().positive().default(50_000),
  /** Directory to write JSON reports. */
  outputDir: z.string().default("eval-results"),
  /** Print per-scenario details. */
  verbose: z.boolean().default(false),
  /** Compare with previous run. */
  compare: z.boolean().default(false),
  /**
   * L2 behavior — minimum average score to pass (out of MAX_L3_SCORE = 24).
   * 15/24 ≈ 62% matches the prior 10/16 ratio from v1 rubric.
   */
  passThreshold: z.coerce.number().min(0).max(24).default(15),
  /**
   * L1 execution — minimum pass rate [0..1]. Applies to the merged
   * routing+tool-use tier. Replaces the prior l1Threshold + l2Threshold.
   */
  executionThreshold: z.coerce.number().min(0).max(1).default(0.85),
});

export type EvalConfig = z.infer<typeof evalConfigSchema>;

/** Parse CLI args into EvalConfig. Unknown flags ignored. */
export function parseEvalArgs(argv: string[]): EvalConfig {
  const raw: Record<string, unknown> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skill" && argv[i + 1]) {
      raw.skill = argv[++i];
    } else if (arg === "--scenario" && argv[i + 1]) {
      raw.scenarioId = argv[++i];
    } else if (arg === "--limit" && argv[i + 1]) {
      raw.limit = Number(argv[++i]);
    } else if ((arg === "--count" || arg === "--generated") && argv[i + 1]) {
      raw.generatedCount = Number(argv[++i]);
    } else if (arg === "--golden-dir" && argv[i + 1]) {
      raw.goldenDir = argv[++i];
    } else if (arg === "--eval-skills" && argv[i + 1]) {
      raw.evalSkills = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--judge-model" && argv[i + 1]) {
      raw.judgeModel = argv[++i];
    } else if (arg === "--judge-provider" && argv[i + 1]) {
      raw.judgeProvider = argv[++i];
    } else if (arg === "--output" && argv[i + 1]) {
      raw.outputDir = argv[++i];
    } else if (arg === "--verbose") {
      raw.verbose = true;
    } else if (arg === "--compare") {
      raw.compare = true;
    } else if (arg === "--no-fixed") {
      raw.includeFixed = false;
    } else if ((arg === "--threshold" || arg === "--behavior-threshold") && argv[i + 1]) {
      raw.passThreshold = Number(argv[++i]);
    } else if ((arg === "--execution-threshold" || arg === "--l1-threshold") && argv[i + 1]) {
      // --l1-threshold kept as alias for one-release-deprecation period.
      raw.executionThreshold = Number(argv[++i]);
    }
  }
  return evalConfigSchema.parse(raw);
}
