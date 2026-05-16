import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillsLoader } from "../../src/skills/loader.js";

let tmpDir: string;
let workspaceSkills: string;
let builtinSkills: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `ghost-sk-${Date.now()}`);
  workspaceSkills = join(tmpDir, "workspace", "skills");
  builtinSkills = join(tmpDir, "builtin");
  mkdirSync(workspaceSkills, { recursive: true });
  mkdirSync(builtinSkills, { recursive: true });
});
afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

function writeSkill(dir: string, name: string, content: string) {
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), content);
}

describe("SkillsLoader", () => {
  test("listSkills discovers skills from workspace", () => {
    writeSkill(workspaceSkills, "github", "---\nname: github\ndescription: GitHub CLI\n---\n# GitHub");
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    const skills = loader.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("github");
    expect(skills[0].source).toBe("workspace");
  });

  test("listSkills discovers builtin skills", () => {
    writeSkill(builtinSkills, "memory", "---\nname: memory\ndescription: Memory management\nalways: true\n---\n# Memory");
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    const skills = loader.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("memory");
    expect(skills[0].source).toBe("builtin");
  });

  test("workspace skills shadow builtin by name", () => {
    writeSkill(workspaceSkills, "github", "---\nname: github\ndescription: Custom GitHub\n---\nCustom");
    writeSkill(builtinSkills, "github", "---\nname: github\ndescription: Builtin GitHub\n---\nBuiltin");
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    const skills = loader.listSkills();
    expect(skills).toHaveLength(1);
    expect(skills[0].source).toBe("workspace");
  });

  test("loadSkill returns content by name", () => {
    writeSkill(workspaceSkills, "test", "---\nname: test\ndescription: Test skill\n---\n# Test Content");
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    const content = loader.loadSkill("test");
    expect(content).toContain("# Test Content");
  });

  test("loadSkill returns null for unknown skill", () => {
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    expect(loader.loadSkill("nope")).toBeNull();
  });

  test("getSkillMetadata parses frontmatter", () => {
    writeSkill(workspaceSkills, "gh", "---\nname: gh\ndescription: GitHub\nalways: true\n---\nContent");
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    const meta = loader.getSkillMetadata("gh");
    expect(meta?.name).toBe("gh");
    expect(meta?.description).toBe("GitHub");
    expect(meta?.always).toBe(true);
  });

  test("getAlwaysSkills returns skills with always=true", () => {
    writeSkill(workspaceSkills, "a", "---\nname: a\ndescription: A\nalways: true\n---\nA");
    writeSkill(workspaceSkills, "b", "---\nname: b\ndescription: B\n---\nB");
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    const always = loader.getAlwaysSkills();
    expect(always).toHaveLength(1);
    expect(always[0].name).toBe("a");
  });

  test("buildSkillsSummary returns XML format", () => {
    writeSkill(workspaceSkills, "test", "---\nname: test\ndescription: A test skill\n---\nContent");
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    const summary = loader.buildSkillsSummary();
    expect(summary).toContain("<skills>");
    expect(summary).toContain("<name>test</name>");
    expect(summary).toContain("<description>A test skill</description>");
    expect(summary).toContain("</skills>");
  });

  test("loadSkillsForContext strips frontmatter and formats", () => {
    writeSkill(workspaceSkills, "s1", "---\nname: s1\ndescription: S1\n---\n# Skill One Instructions");
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    const ctx = loader.loadSkillsForContext(["s1"]);
    expect(ctx).toContain("### Skill: s1");
    expect(ctx).toContain("# Skill One Instructions");
    expect(ctx).not.toContain("---");
  });

  test("checkRequirements validates bins via Bun.which", () => {
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    expect(loader.checkRequirements({ name: "x", description: "x", metadata: { ghost: { requires: { bins: ["ls"] } } } })).toBe(true);
    expect(loader.checkRequirements({ name: "x", description: "x", metadata: { ghost: { requires: { bins: ["nonexistent_binary_xyz"] } } } })).toBe(false);
  });

  test("listSkills returns empty for non-existent directories", () => {
    const loader = new SkillsLoader("/tmp/ghost-nonexistent-xyz");
    expect(loader.listSkills()).toEqual([]);
  });

  test("buildSkillsSummary returns empty string when no skills", () => {
    const loader = new SkillsLoader(join(tmpDir, "workspace"), builtinSkills);
    expect(loader.buildSkillsSummary()).toBe("");
  });
});
