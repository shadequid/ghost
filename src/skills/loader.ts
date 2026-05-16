import { readdirSync, readFileSync, lstatSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface SkillEntry {
  name: string;
  path: string;
  source: "workspace" | "builtin";
}

export interface SkillMetadata {
  name: string;
  description: string;
  always?: boolean;
  metadata?: {
    ghost?: {
      emoji?: string;
      requires?: { bins?: string[]; env?: string[] };
    };
  };
}

export function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const meta: Record<string, string> = {};
  const lines = match[1].split("\n");
  let currentKey = "";

  for (const line of lines) {
    // Continuation line (indented) for multiline values (YAML | or >)
    if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      const trimmed = line.trim();
      if (trimmed) {
        meta[currentKey] = meta[currentKey] ? meta[currentKey] + " " + trimmed : trimmed;
      }
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;
    const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, "");

    // Multiline indicator (| or >) — value starts on next line
    if (value === "|" || value === ">") {
      currentKey = key;
      meta[key] = "";
    } else {
      currentKey = key;
      meta[key] = value;
    }
  }
  return { meta, body: match[2] };
}

const MAX_SKILLS_IN_PROMPT = 30;
const MAX_SKILLS_PROMPT_CHARS = 20_000;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Skills loader.
 *
 * Skills are markdown files (SKILL.md) with YAML frontmatter that teach the
 * agent how to use specific tools or perform certain tasks. Workspace skills
 * shadow builtin skills by name (highest priority wins).
 */
export class SkillsLoader {
  private readonly workspaceSkillsDir: string;
  private readonly builtinSkillsDir: string;

  constructor(workspaceDir: string, builtinSkillsDir?: string) {
    this.workspaceSkillsDir = join(workspaceDir, "skills");
    this.builtinSkillsDir = builtinSkillsDir ?? "";
  }

  /** Public access to the workspace skills directory path. */
  workspaceSkillsPath(): string {
    return this.workspaceSkillsDir;
  }

  listSkills(filterUnavailable = false, disabledNames?: Set<string>): SkillEntry[] {
    const seen = new Set<string>();
    const entries: SkillEntry[] = [];

    for (const entry of this.scanDir(this.workspaceSkillsDir, "workspace")) {
      seen.add(entry.name);
      if (disabledNames?.has(entry.name)) continue;
      if (!filterUnavailable || this.isAvailable(entry.name)) entries.push(entry);
    }

    for (const entry of this.scanDir(this.builtinSkillsDir, "builtin")) {
      if (seen.has(entry.name)) continue;
      if (disabledNames?.has(entry.name)) continue;
      if (!filterUnavailable || this.isAvailable(entry.name)) entries.push(entry);
    }

    return entries;
  }

  loadSkill(name: string): string | null {
    const wsPath = join(this.workspaceSkillsDir, name, "SKILL.md");
    if (existsSync(wsPath)) return readFileSync(wsPath, "utf-8");
    const biPath = join(this.builtinSkillsDir, name, "SKILL.md");
    if (this.builtinSkillsDir && existsSync(biPath)) return readFileSync(biPath, "utf-8");
    return null;
  }

  loadSkillsForContext(names: string[]): string {
    const parts: string[] = [];
    for (const name of names) {
      const content = this.loadSkill(name);
      if (!content) continue;
      const { body } = parseFrontmatter(content);
      parts.push(`### Skill: ${name}\n\n${body.trim()}`);
    }
    return parts.join("\n\n---\n\n");
  }

  buildSkillsSummary(disabledNames?: Set<string>): string {
    const allSkills = this.listSkills(false, disabledNames);
    if (allSkills.length === 0) return "";

    // Prioritize: always-on first, then workspace > builtin, then by name
    const sorted = [...allSkills].sort((a, b) => {
      const aMeta = this.getSkillMetadata(a.name);
      const bMeta = this.getSkillMetadata(b.name);
      const aAlways = aMeta?.always === true ? 0 : 1;
      const bAlways = bMeta?.always === true ? 0 : 1;
      if (aAlways !== bAlways) return aAlways - bAlways;
      const aSrc = a.source === "workspace" ? 0 : 1;
      const bSrc = b.source === "workspace" ? 0 : 1;
      if (aSrc !== bSrc) return aSrc - bSrc;
      return a.name.localeCompare(b.name);
    });

    // Enforce count limit
    const truncatedCount = Math.max(0, sorted.length - MAX_SKILLS_IN_PROMPT);
    const skills = sorted.slice(0, MAX_SKILLS_IN_PROMPT);

    let xml = "<skills>\n";
    let charTruncated = 0;
    for (const skill of skills) {
      const meta = this.getSkillMetadata(skill.name);
      const available = meta ? this.checkRequirements(meta) : true;
      const missing = meta ? this.getMissingRequirements(meta) : [];

      let entry = `  <skill available="${available}">\n`;
      entry += `    <name>${escapeXml(skill.name)}</name>\n`;
      entry += `    <description>${escapeXml(meta?.description ?? "")}</description>\n`;
      entry += `    <location>${escapeXml(skill.path)}</location>\n`;
      if (missing.length > 0) {
        entry += `    <missing>${escapeXml(missing.join(", "))}</missing>\n`;
      }
      entry += `  </skill>\n`;

      if (xml.length + entry.length + 10 > MAX_SKILLS_PROMPT_CHARS) {
        charTruncated = skills.length - xml.split("<skill ").length + 1;
        break;
      }
      xml += entry;
    }

    const totalTruncated = truncatedCount + charTruncated;
    if (totalTruncated > 0) {
      xml += `  <!-- ${totalTruncated} skills truncated -->\n`;
    }
    xml += "</skills>";
    return xml;
  }

  getAlwaysSkills(disabledNames?: Set<string>): SkillEntry[] {
    return this.listSkills(false, disabledNames).filter((entry) => {
      const meta = this.getSkillMetadata(entry.name);
      return meta?.always === true && this.checkRequirements(meta);
    });
  }

  getSkillMetadata(name: string): SkillMetadata | null {
    const content = this.loadSkill(name);
    if (!content) return null;

    const { meta } = parseFrontmatter(content);
    const result: SkillMetadata = {
      name: meta.name ?? name,
      description: meta.description ?? "",
    };

    if (meta.always === "true") result.always = true;

    if (meta.metadata) {
      try {
        const parsed = JSON.parse(meta.metadata) as Record<string, unknown>;
        const ghost = (parsed.ghost ?? parsed) as SkillMetadata["metadata"] extends { ghost?: infer G } ? G : never;
        result.metadata = { ghost };
      } catch { /* ignore malformed metadata */ }
    }

    return result;
  }

  checkRequirements(meta: SkillMetadata): boolean {
    return this.getMissingRequirements(meta).length === 0;
  }

  getMissingRequirements(meta: SkillMetadata): string[] {
    const missing: string[] = [];
    const reqs = meta.metadata?.ghost?.requires;
    if (!reqs) return missing;

    for (const bin of reqs.bins ?? []) {
      if (!Bun.which(bin)) missing.push(`CLI: ${bin}`);
    }
    for (const env of reqs.env ?? []) {
      if (!Bun.env[env]) missing.push(`ENV: ${env}`);
    }
    return missing;
  }

  private isAvailable(name: string): boolean {
    const meta = this.getSkillMetadata(name);
    return meta ? this.checkRequirements(meta) : true;
  }

  private scanDir(dir: string, source: "workspace" | "builtin"): SkillEntry[] {
    if (!dir || !existsSync(dir)) return [];
    const entries: SkillEntry[] = [];
    try {
      for (const name of readdirSync(dir)) {
        const subdir = join(dir, name);
        try {
          if (!lstatSync(subdir).isDirectory()) continue;
        } catch { continue; }
        const skillFile = join(subdir, "SKILL.md");
        if (existsSync(skillFile)) {
          entries.push({ name, path: skillFile, source });
        }
      }
    } catch { /* dir unreadable */ }
    return entries;
  }
}
