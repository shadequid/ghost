/**
 * Skill upload helpers — zip extraction, symlink checks, recursive copy.
 * Extracted from skill-service.ts to keep files under 300 LOC.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, readdirSync, lstatSync } from "node:fs";
import { join } from "node:path";
import type { SkillsLoader } from "../skills/loader.js";
import type { UploadResult, ValidationResult, SkillInfo } from "./skill-service.js";

export function resolveTmpdir(): string {
  return Bun.env.TMPDIR ?? Bun.env.TMP ?? "/tmp";
}

/** Recursively check whether any entry under `dir` is a symlink. */
export function checkSymlinks(dir: string): boolean {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (lstatSync(full).isSymbolicLink()) return true;
    if (lstatSync(full).isDirectory()) {
      if (checkSymlinks(full)) return true;
    }
  }
  return false;
}

/** Recursively copy all files from `src` to `dest`. */
export function copyRecursive(src: string, dest: string): void {
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (lstatSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyRecursive(srcPath, destPath);
    } else {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

/** Extract and install a .zip/.skill skill archive. */
export function uploadZipSkill(
  content: Buffer,
  overwrite: boolean,
  loader: SkillsLoader,
  validateFn: (content: string) => ValidationResult,
  syncFn: () => void,
  listFn: () => SkillInfo[],
): UploadResult {
  const tempDir = join(resolveTmpdir(), `ghost-skill-upload-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    // Write zip to temp file and extract
    const zipPath = join(tempDir, "upload.zip");
    writeFileSync(zipPath, content);

    // Extract using unzip command (available on all platforms)
    const result = Bun.spawnSync(["unzip", "-o", zipPath, "-d", tempDir]);
    if (result.exitCode !== 0) {
      return { ok: false, errors: ["Failed to extract zip file. Ensure it is a valid zip archive."] };
    }

    // Find SKILL.md at root or one level deep
    let skillMdPath: string | null = null;
    let skillRootDir: string | null = null;

    if (existsSync(join(tempDir, "SKILL.md"))) {
      skillMdPath = join(tempDir, "SKILL.md");
      skillRootDir = tempDir;
    } else {
      for (const entry of readdirSync(tempDir)) {
        const subdir = join(tempDir, entry);
        if (!lstatSync(subdir).isDirectory()) continue;
        const candidate = join(subdir, "SKILL.md");
        if (existsSync(candidate)) {
          skillMdPath = candidate;
          skillRootDir = subdir;
          break;
        }
      }
    }

    if (!skillMdPath || !skillRootDir) {
      return { ok: false, errors: ["No SKILL.md found in archive (checked root and one level deep)"] };
    }

    // Validate SKILL.md
    const skillContent = readFileSync(skillMdPath, "utf-8");
    const validation = validateFn(skillContent);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    const name = validation.name;

    // Check for symlinks (security)
    if (checkSymlinks(skillRootDir)) {
      return { ok: false, errors: ["Skill archive contains symlinks (not allowed for security)"] };
    }

    // Validate allowed directories
    const allowedDirs = new Set(["scripts", "references", "assets"]);
    for (const entry of readdirSync(skillRootDir)) {
      const full = join(skillRootDir, entry);
      if (lstatSync(full).isDirectory() && !allowedDirs.has(entry)) {
        return { ok: false, errors: [`Unexpected directory "${entry}". Only scripts/, references/, assets/ allowed.`] };
      }
    }

    // Check conflict
    const existing = loader.listSkills().find((s) => s.name === name);
    if (existing && !overwrite) {
      return { ok: false, conflict: true, errors: [`Skill "${name}" already exists. Upload again with overwrite to replace.`] };
    }

    // Copy to workspace
    const targetDir = join(loader.workspaceSkillsPath(), name);
    if (existsSync(targetDir)) rmSync(targetDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    copyRecursive(skillRootDir, targetDir);

    // Sync DB and return
    syncFn();
    const skill = listFn().find((s) => s.name === name);
    return { ok: true, skill };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
