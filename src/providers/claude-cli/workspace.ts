/**
 * Claude CLI workspace manager.
 *
 * Manages ~/.ghost/cli-workspace/:
 * - CLAUDE.md (system prompt, hash-checked)
 * - .claude/skills/ (on-demand skills, synced from builtin + user)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./handoff.js";

// ---------------------------------------------------------------------------
// Consolidated workspace setup
// ---------------------------------------------------------------------------

export interface SetupCliWorkspaceInput {
  workspacePath: string;
  systemPrompt: string;
  builtinSkillsDir: string | undefined;
  userSkillsDir: string | undefined;
  /** Skill names to exclude from the workspace (disabled or deleted). */
  disabledSkills?: Set<string>;
}

/** Single entry point: create workspace dir, write CLAUDE.md, sync skills. */
export function setupCliWorkspace(input: SetupCliWorkspaceInput): void {
  ensureWorkspace(input.workspacePath, input.systemPrompt);
  syncSkills(input.workspacePath, input.builtinSkillsDir, input.userSkillsDir, input.disabledSkills);
}

// ---------------------------------------------------------------------------
// CLAUDE.md
// ---------------------------------------------------------------------------

/** Ensure workspace dir exists and write CLAUDE.md if content changed. Returns true if written. */
export function ensureWorkspace(workspacePath: string, systemPrompt: string): boolean {
  mkdirSync(workspacePath, { recursive: true });

  const claudeMdPath = join(workspacePath, "CLAUDE.md");
  const newHash = sha256(systemPrompt);

  if (existsSync(claudeMdPath)) {
    const existing = readFileSync(claudeMdPath, "utf-8");
    if (sha256(existing) === newHash) return false;
  }

  writeFileSync(claudeMdPath, systemPrompt, "utf-8");
  return true;
}

// ---------------------------------------------------------------------------
// Skills sync
// ---------------------------------------------------------------------------

/**
 * Sync ALL skills (both always-on and on-demand) to .claude/skills/.
 *
 * Claude CLI auto-discovers files in .claude/skills/ within its cwd,
 * so we copy entire skill folders here — SKILL.md plus any scripts,
 * references, or other supporting files.
 */
export function syncSkills(
  workspacePath: string,
  builtinSkillsDir: string | undefined,
  userSkillsDir: string | undefined,
  disabledSkills?: Set<string>,
): void {
  const skillsDir = join(workspacePath, ".claude", "skills");
  mkdirSync(skillsDir, { recursive: true });

  // Collect skill source dirs: user overrides builtin by name
  const skillSources = new Map<string, string>(); // name → source dir path

  if (builtinSkillsDir && existsSync(builtinSkillsDir)) {
    for (const entry of readdirSync(builtinSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(builtinSkillsDir, entry.name, "SKILL.md"))) continue;
      skillSources.set(entry.name, join(builtinSkillsDir, entry.name));
    }
  }

  if (userSkillsDir && existsSync(userSkillsDir)) {
    for (const entry of readdirSync(userSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!existsSync(join(userSkillsDir, entry.name, "SKILL.md"))) continue;
      skillSources.set(entry.name, join(userSkillsDir, entry.name));
    }
  }

  // Copy entire skill folders, skipping disabled and unchanged skills
  const written = new Set<string>();
  for (const [name, srcDir] of skillSources) {
    if (disabledSkills?.has(name)) continue;
    const destDir = join(skillsDir, name);
    if (!skillChanged(srcDir, destDir)) {
      written.add(name);
      continue;
    }
    rmSync(destDir, { recursive: true, force: true });
    cpSync(srcDir, destDir, { recursive: true });
    written.add(name);
  }

  // Remove stale skill directories and old flat files
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      unlinkSync(join(skillsDir, entry.name));
      continue;
    }
    if (!written.has(entry.name)) {
      rmSync(join(skillsDir, entry.name), { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Quick check: did the skill's SKILL.md change? Compares source vs dest hash. */
function skillChanged(srcDir: string, destDir: string): boolean {
  const destSkill = join(destDir, "SKILL.md");
  if (!existsSync(destSkill)) return true;
  const srcSkill = join(srcDir, "SKILL.md");
  return sha256(readFileSync(srcSkill, "utf-8")) !== sha256(readFileSync(destSkill, "utf-8"));
}
