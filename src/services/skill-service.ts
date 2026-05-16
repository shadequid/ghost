/**
 * Skill service — manages skill enable/disable state, upload, validation, deletion.
 * SQLite-backed persistence for skill toggle state.
 */

import type { Database } from "bun:sqlite";
import type { SkillsLoader } from "../skills/loader.js";
import { parseFrontmatter } from "../skills/loader.js";
import { uploadZipSkill } from "./skill-upload.js";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, extname } from "node:path";

export interface SkillInfo {
  name: string;
  description: string;
  source: "builtin" | "workspace";
  enabled: boolean;
  emoji?: string;
  always?: boolean;
  available: boolean;
  missing?: string[];
}

export type ValidationResult =
  | { ok: true; name: string }
  | { ok: false; errors: string[] };

export interface DeleteResult {
  ok: boolean;
  error?: string;
}

export interface UploadResult {
  ok: boolean;
  skill?: SkillInfo;
  errors?: string[];
  conflict?: boolean;
}

const NAME_PATTERN = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

export class SkillService {
  private readonly stmts;

  constructor(
    private readonly db: Database,
    private readonly loader: SkillsLoader,
  ) {
    this.stmts = {
      upsert: db.prepare(
        `INSERT INTO skill_states (name, source, enabled) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET source = excluded.source, updated_at = datetime('now')`,
      ),
      toggle: db.prepare(
        `UPDATE skill_states SET enabled = ?, updated_at = datetime('now') WHERE name = ?`,
      ),
      remove: db.prepare(`DELETE FROM skill_states WHERE name = ?`),
      getAll: db.prepare(`SELECT name, source, enabled FROM skill_states ORDER BY name`),
      getOne: db.prepare(`SELECT name, source, enabled FROM skill_states WHERE name = ?`),
    };
  }

  /** Reconcile disk skills with DB rows. Call on startup. */
  syncState(): void {
    const diskSkills = this.loader.listSkills();
    const diskNames = new Set(diskSkills.map((s) => s.name));

    // Insert new skills (preserve enabled state for existing ones via ON CONFLICT)
    for (const skill of diskSkills) {
      this.stmts.upsert.run(skill.name, skill.source, 1);
    }

    // Remove DB rows for skills no longer on disk
    const dbRows = this.stmts.getAll.all() as Array<{ name: string }>;
    for (const row of dbRows) {
      if (!diskNames.has(row.name)) {
        this.stmts.remove.run(row.name);
      }
    }
  }

  /** List all skills with merged disk metadata + DB state. */
  listSkills(): SkillInfo[] {
    const diskSkills = this.loader.listSkills();
    const dbRows = this.stmts.getAll.all() as Array<{
      name: string; source: string; enabled: number;
    }>;
    const dbMap = new Map(dbRows.map((r) => [r.name, r]));

    return diskSkills.map((entry) => {
      const meta = this.loader.getSkillMetadata(entry.name);
      const dbRow = dbMap.get(entry.name);
      const available = meta ? this.loader.checkRequirements(meta) : true;
      const missing = meta ? this.loader.getMissingRequirements(meta) : [];
      return {
        name: entry.name,
        description: meta?.description ?? "",
        source: entry.source,
        enabled: dbRow ? dbRow.enabled === 1 : true,
        emoji: meta?.metadata?.ghost?.emoji,
        always: meta?.always,
        available,
        missing: missing.length > 0 ? missing : undefined,
      };
    });
  }

  /** Toggle a skill's enabled state. Auto-syncs if skill is on disk but not in DB. */
  toggleSkill(name: string, enabled: boolean): void {
    let row = this.stmts.getOne.get(name) as { name: string } | null;
    if (!row) {
      // Skill may exist on disk but not yet synced (e.g. installed via clawhub mid-session)
      this.syncState();
      row = this.stmts.getOne.get(name) as { name: string } | null;
      if (!row) throw new Error(`Skill not found: ${name}`);
    }
    this.stmts.toggle.run(enabled ? 1 : 0, name);
  }

  /** Get set of disabled skill names (for filtering in context builder). */
  getDisabledNames(): Set<string> {
    const rows = this.stmts.getAll.all() as Array<{ name: string; enabled: number }>;
    return new Set(rows.filter((r) => r.enabled === 0).map((r) => r.name));
  }

  /** Delete a user-added (workspace) skill. Rejects builtins. */
  deleteSkill(name: string): DeleteResult {
    const row = this.stmts.getOne.get(name) as { name: string; source: string } | null;
    if (!row) return { ok: false, error: `Skill not found: ${name}` };
    if (row.source === "builtin") {
      return { ok: false, error: "Builtin skills cannot be deleted. You can disable them instead." };
    }

    // Find on disk and remove
    const diskSkills = this.loader.listSkills();
    const diskEntry = diskSkills.find((s) => s.name === name && s.source === "workspace");
    if (!diskEntry) return { ok: false, error: `Skill not found on disk: ${name}` };

    // Remove skill directory (SKILL.md's parent)
    const skillDir = join(diskEntry.path, "..");
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true });
    }
    this.stmts.remove.run(name);
    return { ok: true };
  }

  /** Validate raw SKILL.md content. */
  validateSkillContent(content: string): ValidationResult {
    const errors: string[] = [];

    // Parse frontmatter (reuse shared parser from loader)
    const { meta } = parseFrontmatter(content);
    if (Object.keys(meta).length === 0 && !content.startsWith("---")) {
      return { ok: false, errors: ["Missing YAML frontmatter (---\\n...\\n---)"] };
    }

    // Required: name
    if (!meta.name) {
      errors.push("Missing required field: name");
    } else if (!NAME_PATTERN.test(meta.name)) {
      errors.push(
        `Invalid name "${meta.name}": must be lowercase, hyphens allowed, 2-64 chars, start/end with letter or digit`,
      );
    }

    // Required: description
    if (!meta.description) {
      errors.push("Missing required field: description");
    } else if (meta.description.length > 1024) {
      errors.push(`Description too long (${meta.description.length} chars, max 1024)`);
    }

    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, name: meta.name };
  }

  /** Upload a skill from raw file content. Returns the installed skill info or errors. */
  uploadSkill(
    fileContent: Buffer,
    filename: string,
    overwrite = false,
  ): UploadResult {
    const ext = extname(filename).toLowerCase();

    if (ext === ".md") {
      return this.uploadMarkdownSkill(fileContent.toString("utf-8"), overwrite);
    }
    if (ext === ".skill" || ext === ".zip") {
      return this.handleZipUpload(fileContent, overwrite);
    }

    return { ok: false, errors: [`Unsupported file type: ${ext}. Expected .md, .skill, or .zip`] };
  }

  private uploadMarkdownSkill(content: string, overwrite: boolean): UploadResult {
    const validation = this.validateSkillContent(content);
    if (!validation.ok) return { ok: false, errors: validation.errors };
    const name = validation.name;

    // Check conflict
    const existing = this.loader.listSkills().find((s) => s.name === name);
    if (existing && !overwrite) {
      return { ok: false, conflict: true, errors: [`Skill "${name}" already exists. Upload again with overwrite to replace.`] };
    }

    // Write to workspace
    const skillDir = join(this.loader.workspaceSkillsPath(), name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), content);

    // Sync DB and return info
    this.syncState();
    const skill = this.listSkills().find((s) => s.name === name);
    return { ok: true, skill };
  }

  private handleZipUpload(content: Buffer, overwrite: boolean): UploadResult {
    return uploadZipSkill(
      content,
      overwrite,
      this.loader,
      (c) => this.validateSkillContent(c),
      () => this.syncState(),
      () => this.listSkills(),
    );
  }
}
