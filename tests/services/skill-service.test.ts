import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { SkillService } from "../../src/services/skill-service.js";
import { SkillsLoader } from "../../src/skills/loader.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { initDatabase } from "../../src/core/database.js";
import { tmpdir } from "node:os";

function createTempDir(): string {
  const dir = join(tmpdir(), `ghost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSkill(dir: string, name: string, content: string): void {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content);
}

const VALID_SKILL = `---
name: test-skill
description: A test skill for unit tests.
---

# Test Skill

This is a test skill.
`;

const VALID_SKILL_B = `---
name: another-skill
description: Another test skill.
---

# Another Skill

Content here.
`;

describe("SkillService", () => {
  let db: Database;
  let workspaceDir: string;
  let builtinDir: string;
  let loader: SkillsLoader;
  let service: SkillService;
  let dbPath: string;

  beforeEach(() => {
    const tempDir = createTempDir();
    workspaceDir = join(tempDir, "workspace");
    builtinDir = join(tempDir, "builtin");
    dbPath = join(tempDir, "brain.db");
    mkdirSync(join(workspaceDir, "skills"), { recursive: true });
    mkdirSync(builtinDir, { recursive: true });

    db = initDatabase(dbPath);
    loader = new SkillsLoader(workspaceDir, builtinDir);
    service = new SkillService(db, loader);
  });

  afterEach(() => {
    db.close();
  });

  test("syncState inserts new skills into DB", () => {
    writeSkill(builtinDir, "builtin-skill", VALID_SKILL.replace("test-skill", "builtin-skill"));
    service.syncState();
    const skills = service.listSkills();
    expect(skills.length).toBe(1);
    expect(skills[0].name).toBe("builtin-skill");
    expect(skills[0].enabled).toBe(true);
    expect(skills[0].source).toBe("builtin");
  });

  test("syncState removes DB rows for deleted skills", () => {
    writeSkill(builtinDir, "temp-skill", VALID_SKILL.replace("test-skill", "temp-skill"));
    service.syncState();
    expect(service.listSkills().length).toBe(1);

    // Remove skill from disk
    rmSync(join(builtinDir, "temp-skill"), { recursive: true });
    service.syncState();
    expect(service.listSkills().length).toBe(0);
  });

  test("syncState preserves enabled state across syncs", () => {
    writeSkill(builtinDir, "my-skill", VALID_SKILL.replace("test-skill", "my-skill"));
    service.syncState();
    service.toggleSkill("my-skill", false);
    service.syncState();
    const skills = service.listSkills();
    expect(skills[0].enabled).toBe(false);
  });

  test("toggleSkill enables and disables", () => {
    writeSkill(builtinDir, "toggle-me", VALID_SKILL.replace("test-skill", "toggle-me"));
    service.syncState();

    service.toggleSkill("toggle-me", false);
    expect(service.listSkills()[0].enabled).toBe(false);

    service.toggleSkill("toggle-me", true);
    expect(service.listSkills()[0].enabled).toBe(true);
  });

  test("toggleSkill throws for unknown skill", () => {
    expect(() => service.toggleSkill("nonexistent", false)).toThrow();
  });

  test("getDisabledNames returns only disabled skill names", () => {
    writeSkill(builtinDir, "skill-a", VALID_SKILL.replace("test-skill", "skill-a"));
    writeSkill(builtinDir, "skill-b", VALID_SKILL_B.replace("another-skill", "skill-b"));
    service.syncState();

    service.toggleSkill("skill-a", false);
    const disabled = service.getDisabledNames();
    expect(disabled.has("skill-a")).toBe(true);
    expect(disabled.has("skill-b")).toBe(false);
  });

  test("deleteSkill removes workspace skill from disk and DB", () => {
    writeSkill(join(workspaceDir, "skills"), "user-skill", VALID_SKILL.replace("test-skill", "user-skill"));
    service.syncState();

    const result = service.deleteSkill("user-skill");
    expect(result.ok).toBe(true);
    expect(existsSync(join(workspaceDir, "skills", "user-skill"))).toBe(false);
    expect(service.listSkills().length).toBe(0);
  });

  test("deleteSkill rejects builtin skills", () => {
    writeSkill(builtinDir, "builtin-skill", VALID_SKILL.replace("test-skill", "builtin-skill"));
    service.syncState();

    const result = service.deleteSkill("builtin-skill");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Builtin");
  });

  test("deleteSkill rejects unknown skills", () => {
    const result = service.deleteSkill("nonexistent");
    expect(result.ok).toBe(false);
  });

  test("validateSkillContent accepts valid SKILL.md content", () => {
    const result = service.validateSkillContent(VALID_SKILL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("test-skill");
    }
  });

  test("validateSkillContent rejects missing frontmatter", () => {
    const result = service.validateSkillContent("# Just markdown\n\nNo frontmatter.");
    expect(result.ok).toBe(false);
  });

  test("validateSkillContent rejects missing name", () => {
    const content = `---\ndescription: No name field\n---\n\n# Skill`;
    const result = service.validateSkillContent(content);
    expect(result.ok).toBe(false);
  });

  test("validateSkillContent rejects invalid name format", () => {
    const content = `---\nname: INVALID_NAME!\ndescription: Bad name\n---\n\n# Skill`;
    const result = service.validateSkillContent(content);
    expect(result.ok).toBe(false);
  });

  test("validateSkillContent rejects description over 1024 chars", () => {
    const longDesc = "a".repeat(1025);
    const content = `---\nname: long-desc\ndescription: ${longDesc}\n---\n\n# Skill`;
    const result = service.validateSkillContent(content);
    expect(result.ok).toBe(false);
  });
});
