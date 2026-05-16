// tests/providers/claude-cli-workspace.test.ts
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureWorkspace,
  syncSkills,
} from "../../../src/providers/claude-cli/workspace.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ghost-test-"));
}

describe("ensureWorkspace", () => {
  let workDir: string;

  beforeEach(() => {
    workDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  test("creates workspace directory and CLAUDE.md", () => {
    const wsPath = join(workDir, "cli-workspace");
    ensureWorkspace(wsPath, "system prompt content");
    expect(existsSync(wsPath)).toBe(true);
    expect(readFileSync(join(wsPath, "CLAUDE.md"), "utf-8")).toBe("system prompt content");
  });

  test("skips CLAUDE.md write if content unchanged", () => {
    const wsPath = join(workDir, "cli-workspace");
    ensureWorkspace(wsPath, "same content");
    Bun.sleepSync(10);
    const changed = ensureWorkspace(wsPath, "same content");
    expect(changed).toBe(false);
  });

  test("rewrites CLAUDE.md when content changes", () => {
    const wsPath = join(workDir, "cli-workspace");
    ensureWorkspace(wsPath, "old content");
    const changed = ensureWorkspace(wsPath, "new content");
    expect(changed).toBe(true);
    expect(readFileSync(join(wsPath, "CLAUDE.md"), "utf-8")).toBe("new content");
  });
});

describe("syncSkills", () => {
  let workDir: string;
  let builtinDir: string;
  let userDir: string;

  beforeEach(() => {
    workDir = makeTempDir();
    builtinDir = makeTempDir();
    userDir = makeTempDir();
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
    rmSync(builtinDir, { recursive: true, force: true });
    rmSync(userDir, { recursive: true, force: true });
  });

  test("copies entire skill folder including SKILL.md", () => {
    const skillDir = join(builtinDir, "market-intel");
    Bun.spawnSync({ cmd: ["mkdir", "-p", skillDir] });
    Bun.write(join(skillDir, "SKILL.md"), "---\nname: market-intel\ndescription: Market intel\n---\nBody");

    syncSkills(workDir, builtinDir, userDir);
    const dest = join(workDir, ".claude", "skills", "market-intel", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    const content = readFileSync(dest, "utf-8");
    expect(content).toContain("name: market-intel");
    expect(content).toContain("description: Market intel");
    expect(content).toContain("Body");
  });

  test("copies supporting files (scripts, references) alongside SKILL.md", () => {
    const skillDir = join(builtinDir, "tmux");
    const scriptsDir = join(skillDir, "scripts");
    Bun.spawnSync({ cmd: ["mkdir", "-p", scriptsDir] });
    Bun.write(join(skillDir, "SKILL.md"), "---\nname: tmux\ndescription: Tmux\n---\nBody");
    Bun.write(join(scriptsDir, "find-sessions.sh"), "#!/bin/bash\necho hello");

    syncSkills(workDir, builtinDir, userDir);
    const destSkill = join(workDir, ".claude", "skills", "tmux", "SKILL.md");
    const destScript = join(workDir, ".claude", "skills", "tmux", "scripts", "find-sessions.sh");
    expect(existsSync(destSkill)).toBe(true);
    expect(existsSync(destScript)).toBe(true);
    expect(readFileSync(destScript, "utf-8")).toBe("#!/bin/bash\necho hello");
  });

  test("copies always-on skills to .claude/skills/<name>/SKILL.md", () => {
    const skillDir = join(builtinDir, "trade-executor");
    Bun.spawnSync({ cmd: ["mkdir", "-p", skillDir] });
    Bun.write(join(skillDir, "SKILL.md"), "---\nname: trade-executor\ndescription: Trade\nalways: true\n---\nBody");

    syncSkills(workDir, builtinDir, userDir);
    const dest = join(workDir, ".claude", "skills", "trade-executor", "SKILL.md");
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf-8")).toContain("Body");
  });

  test("user skills override entire builtin folder by name", () => {
    const builtinSkill = join(builtinDir, "my-skill");
    Bun.spawnSync({ cmd: ["mkdir", "-p", join(builtinSkill, "scripts")] });
    Bun.write(join(builtinSkill, "SKILL.md"), "---\nname: my-skill\ndescription: Builtin\n---\nBuiltin body");
    Bun.write(join(builtinSkill, "scripts", "run.sh"), "builtin script");

    const userSkill = join(userDir, "my-skill");
    Bun.spawnSync({ cmd: ["mkdir", "-p", userSkill] });
    Bun.write(join(userSkill, "SKILL.md"), "---\nname: my-skill\ndescription: User\n---\nUser body");

    syncSkills(workDir, builtinDir, userDir);
    const dest = join(workDir, ".claude", "skills", "my-skill", "SKILL.md");
    expect(readFileSync(dest, "utf-8")).toContain("User body");
    // Builtin's scripts/ should NOT be present — user folder replaces entirely
    expect(existsSync(join(workDir, ".claude", "skills", "my-skill", "scripts", "run.sh"))).toBe(false);
  });

  test("skips disabled skills", () => {
    const skill1 = join(builtinDir, "skill-a");
    Bun.spawnSync({ cmd: ["mkdir", "-p", skill1] });
    Bun.write(join(skill1, "SKILL.md"), "---\nname: skill-a\ndescription: A\n---\nBody A");

    const skill2 = join(builtinDir, "skill-b");
    Bun.spawnSync({ cmd: ["mkdir", "-p", skill2] });
    Bun.write(join(skill2, "SKILL.md"), "---\nname: skill-b\ndescription: B\n---\nBody B");

    syncSkills(workDir, builtinDir, userDir, new Set(["skill-b"]));
    expect(existsSync(join(workDir, ".claude", "skills", "skill-a", "SKILL.md"))).toBe(true);
    expect(existsSync(join(workDir, ".claude", "skills", "skill-b"))).toBe(false);
  });

  test("removes previously synced skill when it becomes disabled", () => {
    const skill = join(builtinDir, "toggleable");
    Bun.spawnSync({ cmd: ["mkdir", "-p", skill] });
    Bun.write(join(skill, "SKILL.md"), "---\nname: toggleable\ndescription: T\n---\nBody");

    // First sync: enabled
    syncSkills(workDir, builtinDir, userDir);
    expect(existsSync(join(workDir, ".claude", "skills", "toggleable", "SKILL.md"))).toBe(true);

    // Second sync: disabled
    syncSkills(workDir, builtinDir, userDir, new Set(["toggleable"]));
    expect(existsSync(join(workDir, ".claude", "skills", "toggleable"))).toBe(false);
  });

  test("removes stale skill directories no longer in sources", () => {
    const staleDir = join(workDir, ".claude", "skills", "removed-skill");
    Bun.spawnSync({ cmd: ["mkdir", "-p", staleDir] });
    Bun.write(join(staleDir, "SKILL.md"), "old content");

    syncSkills(workDir, builtinDir, userDir);
    expect(existsSync(staleDir)).toBe(false);
  });

  test("cleans up old flat file format", () => {
    const skillsDir = join(workDir, ".claude", "skills");
    Bun.spawnSync({ cmd: ["mkdir", "-p", skillsDir] });
    Bun.write(join(skillsDir, "legacy.md"), "old flat format");

    syncSkills(workDir, builtinDir, userDir);
    expect(existsSync(join(skillsDir, "legacy.md"))).toBe(false);
  });
});

