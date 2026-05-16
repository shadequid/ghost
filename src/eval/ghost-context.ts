/**
 * Ghost context loader — reads SOUL.md + a caller-specified set of SKILL.md
 * files so persona/scenario generators can ground their output in Ghost's
 * actual behavior instead of guessing.
 *
 * Skill-agnostic by design: the caller passes a list of skill directory
 * names (typically from `EvalConfig.evalSkills`). Adding or removing a skill
 * is a config change, not a code change. If you pass no skills (or none
 * exist on disk), the context returns SOUL-only — generators still work but
 * lose skill-specific tool mandates.
 *
 * Why this exists: earlier regen runs produced scenarios with minimal
 * `expected.tools` (1-2 tools per step). The real Ghost agent, running the
 * same skills, legitimately calls 6-9 tools because SKILL.md files
 * explicitly mandate it (e.g. pre-trade-advisory says
 * "MANDATORY: Call ALL tools below in parallel"). Same Opus model, different
 * context → mismatch. Injecting the actual SKILL.md + SOUL.md eliminates
 * the guesswork.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface GhostContext {
  soul: string;
  /** Map skill-directory name → raw SKILL.md body. */
  skills: Record<string, string>;
}

/**
 * Resolve the repo root from this module's own location so we don't depend on
 * `process.cwd()`. `src/eval/ghost-context.ts` → two levels up = repo root.
 */
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(MODULE_DIR, "..", "..");

// Cache the loaded context — generator calls can hit this multiple times per
// regen run (once per persona, plus persona-gen). The files are static at
// runtime; reading them 5+ times is pointless I/O. Key includes the skill
// list so different callers can request different slices.
const CACHE = new Map<string, GhostContext>();

/**
 * Reads SOUL.md from the REPO TEMPLATE (`src/templates/SOUL.md`), not the
 * user's workspace copy (`~/.ghost/workspace/SOUL.md`). Rationale: eval is a
 * regression test of the shipped product, not of an individual user's
 * customization. Generators should see the canonical companion character —
 * otherwise personas calibrate to a SOUL the agent-under-test may not share
 * (a custom workspace SOUL can diverge significantly from the template).
 *
 * `skillNames` are resolved relative to `src/skills/builtin/<name>/SKILL.md`.
 * Skills not found on disk are silently skipped — the caller can detect the
 * gap by comparing requested vs returned `skills` map keys.
 */
export function loadGhostContext(
  skillNames: readonly string[],
  repoRoot = DEFAULT_REPO_ROOT,
): GhostContext {
  const cacheKey = `${repoRoot}::${[...skillNames].sort().join(",")}`;
  const cached = CACHE.get(cacheKey);
  if (cached) return cached;

  const soulPath = join(repoRoot, "src/templates/SOUL.md");
  const soul = existsSync(soulPath) ? readFileSync(soulPath, "utf-8") : "";

  const skills: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of skillNames) {
    const p = join(repoRoot, "src/skills/builtin", name, "SKILL.md");
    if (existsSync(p)) {
      skills[name] = readFileSync(p, "utf-8");
    } else {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    // Silent skips would mask typos in --eval-skills and dataset drift when
    // a skill is renamed or removed. One-line warn is cheap and surfaces the
    // gap at gen-time instead of at "scenarios don't match anything" time.
    console.warn(`  [ghost-context] SKILL.md not found for: ${missing.join(", ")}`);
  }
  const ctx = { soul, skills };
  CACHE.set(cacheKey, ctx);
  return ctx;
}

/** Test-only: clear the cache between tests that mutate disk. */
export function resetGhostContextCache(): void {
  CACHE.clear();
}

/**
 * Inline the full SOUL.md for the persona generator. Personas should know
 * what kind of companion they're going to interact with, so their language
 * style and emotional framing map to a real product rather than a generic AI.
 */
export function formatSoulContext(ctx: GhostContext): string {
  if (!ctx.soul.trim()) return "";
  return `## Ghost's character (SOUL.md — read first)

The personas you generate will interact with THIS specific companion, not a generic AI. Ground their style and expectations accordingly.

\`\`\`
${ctx.soul.trim()}
\`\`\`
`;
}

/**
 * Inline full SKILL.md bodies for each skill in the context. Scenario
 * generator MUST use these as the authoritative source when picking
 * `expectedTools`. The LLM is expected to read each skill's frontmatter
 * (`name`, `description`) to map user intents to skills; no step→skill
 * mapping is hardcoded here.
 */
export function formatSkillsContext(ctx: GhostContext): string {
  const names = Object.keys(ctx.skills);
  if (names.length === 0) return "";
  const sections: string[] = [];
  for (const name of names) {
    const body = ctx.skills[name]?.trim();
    if (!body) continue;
    sections.push(`### ${name}/SKILL.md\n\n\`\`\`\n${body}\n\`\`\``);
  }
  if (sections.length === 0) return "";
  return `## Ghost's actual skill specifications (authoritative)

These are the skills available to Ghost. For each scenario, pick the \`primarySkill\` whose description best matches the user intent, and list \`expectedTools\` based on what that skill (and any upstream skills) mandates. If the skill says "MANDATORY: Call ALL tools below", list ALL of them. If it says "call X, then optionally Y", list only X. Do not guess a minimal subset — the real Ghost will follow the SKILL.md, and the eval will grade against actual tool coverage.

${sections.join("\n\n")}
`;
}
