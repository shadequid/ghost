import { homedir } from "node:os";
import { SecurityError } from "../core/errors.js";
import type { AutonomyLevel, CommandRiskLevel } from "../core/types.js";

// ---------------------------------------------------------------------------
// Risk classification tables
// ---------------------------------------------------------------------------

const HIGH_RISK_COMMANDS = new Set([
  "rm", "rmdir", "dd", "mkfs", "format", "sudo", "su", "chmod", "chown",
  "shutdown", "reboot", "mount", "umount", "curl", "wget", "nc", "netcat",
  "ssh", "scp", "ftp", "iptables", "ufw",
]);

// Subcommands that elevate git/npm/bun to medium risk
const MEDIUM_RISK_GIT_SUBCOMMANDS = new Set([
  "commit", "push", "reset", "rebase", "merge", "cherry-pick",
]);
const MEDIUM_RISK_PKG_SUBCOMMANDS = new Set([
  "install", "add", "remove",
]);
const MEDIUM_RISK_COMMANDS = new Set([
  "touch", "mkdir", "mv", "cp", "ln",
]);

const LOW_RISK_COMMANDS = new Set([
  "ls", "cat", "grep", "find", "head", "tail", "wc", "pwd", "date", "df",
  "du", "uname", "uptime", "hostname", "echo", "printf", "which", "whoami",
  "id", "env", "file", "stat", "diff", "sort", "uniq", "tr", "cut", "seq",
  "test", "true", "false",
]);

// ---------------------------------------------------------------------------
// Forbidden path prefixes — checked after ~ expansion
// ---------------------------------------------------------------------------

const FORBIDDEN_PREFIXES = [
  "/etc",
  "/root",
  "/sys",
  "/proc",
];

// ---------------------------------------------------------------------------
// SecurityPolicy
// ---------------------------------------------------------------------------

export class SecurityPolicy {
  private readonly home: string;
  private readonly allowedCommands: Set<string>;
  constructor(
    private autonomyLevel: AutonomyLevel,
    private config: {
      allowedCommands: string[];
      workspaceDir: string;
      forbiddenPaths: string[];
      blockHighRiskCommands: boolean;
      requireApprovalForMediumRisk: boolean;
    }
  ) {
    this.home = homedir();
    this.allowedCommands = new Set(config.allowedCommands);
  }

  // -------------------------------------------------------------------------
  // enforceToolOperation
  // -------------------------------------------------------------------------

  /**
   * Throws SecurityError if the autonomy level does not permit the operation.
   * read_only forbids all "act" operations.
   */
  enforceToolOperation(operation: "read" | "act", toolName: string): void {
    if (this.autonomyLevel === "read_only" && operation === "act") {
      throw new SecurityError(
        `Tool "${toolName}" requires act permission but autonomy level is read_only`,
        "TOOL_OPERATION_DENIED"
      );
    }
  }

  // -------------------------------------------------------------------------
  // classifyCommandRisk
  // -------------------------------------------------------------------------

  /**
   * Returns the risk level of a single command string.
   * Extracts the base command (first word, strips path prefix).
   */
  classifyCommandRisk(command: string): CommandRiskLevel {
    const trimmed = command.trim();
    if (!trimmed) return "medium";

    const firstWord = trimmed.split(/\s+/)[0]!;
    // Strip any leading path (e.g. /usr/bin/rm → rm)
    const base = firstWord.includes("/") ? firstWord.split("/").pop()! : firstWord;

    if (HIGH_RISK_COMMANDS.has(base)) return "high";

    // Explicitly allowed commands (e.g. runtime launchers used by skills)
    if (this.allowedCommands.has(base)) return "low";

    // git subcommands
    if (base === "git") {
      const rest = trimmed.slice(firstWord.length).trim();
      const subcommand = rest.split(/\s+/)[0] ?? "";
      if (MEDIUM_RISK_GIT_SUBCOMMANDS.has(subcommand)) return "medium";
      return "low";
    }

    // npm / bun subcommands
    if (base === "npm" || base === "bun") {
      const rest = trimmed.slice(firstWord.length).trim();
      const subcommand = rest.split(/\s+/)[0] ?? "";
      if (MEDIUM_RISK_PKG_SUBCOMMANDS.has(subcommand)) return "medium";
      return "low";
    }

    if (MEDIUM_RISK_COMMANDS.has(base)) return "medium";
    if (LOW_RISK_COMMANDS.has(base)) return "low";

    // Unknown → medium (safe default)
    return "medium";
  }

  // -------------------------------------------------------------------------
  // validateCommandExecution
  // -------------------------------------------------------------------------

  /**
   * Validates a full command string for execution.
   * 1. Parses with the quote-aware shell lexer
   * 2. Classifies each segment and takes the highest risk
   * 3. Applies policy rules (blockHighRisk, requireApproval, autonomyLevel)
   * Returns the final risk level on success.
   */
  validateCommandExecution(command: string, approved: boolean): CommandRiskLevel {
    // Shell lexer — may throw SecurityError on dangerous operators
    const segments = this.parseShellSegments(command);

    // Classify each segment and take the highest risk
    let risk: CommandRiskLevel = "low";
    for (const seg of segments) {
      const segRisk = this.classifyCommandRisk(seg);
      if (segRisk === "high") {
        risk = "high";
        break;
      }
      if (segRisk === "medium") risk = "medium";
    }

    if (this.config.blockHighRiskCommands && risk === "high") {
      throw new SecurityError(
        `Command blocked: high-risk command execution is disabled`,
        "HIGH_RISK_COMMAND_BLOCKED"
      );
    }

    // In supervised mode, medium+ risk always requires explicit approval.
    // In full mode, the approval check is skipped entirely (config flag ignored).
    if (
      this.autonomyLevel === "supervised" &&
      (risk === "medium" || risk === "high") &&
      !approved
    ) {
      throw new SecurityError(
        `Command requires approval: risk level is "${risk}"`,
        "APPROVAL_REQUIRED"
      );
    }

    if (this.autonomyLevel === "read_only") {
      throw new SecurityError(
        `Command execution is not allowed in read_only autonomy mode`,
        "AUTONOMY_LEVEL_DENIED"
      );
    }

    return risk;
  }

  // -------------------------------------------------------------------------
  // isPathAllowed
  // -------------------------------------------------------------------------

  /**
   * Validates a path against 6 security layers.
   * Returns true only if all layers pass.
   */
  isPathAllowed(rawPath: string): boolean {
    // Layer 1: null bytes
    if (rawPath.includes("\0")) return false;

    // Layer 2: .. components
    const parts = rawPath.split("/");
    if (parts.includes("..")) return false;

    // Layer 3: URL-encoded traversal or slashes
    const lc = rawPath.toLowerCase();
    if (
      lc.includes("%2f") ||
      lc.includes("..%2f") ||
      lc.includes("%2f..")
    ) {
      return false;
    }

    // Layer 4: ~user forms — reject tilde followed by a non-slash character
    // ~/... is allowed (home-relative is fine at this layer)
    if (/~[^/]/.test(rawPath)) return false;

    // Layer 5: absolute path must be inside workspaceDir
    if (rawPath.startsWith("/")) {
      const workspace = this.config.workspaceDir.endsWith("/")
        ? this.config.workspaceDir
        : this.config.workspaceDir + "/";
      const normalized = rawPath.endsWith("/") ? rawPath : rawPath + "/";
      if (!normalized.startsWith(workspace) && rawPath !== this.config.workspaceDir) {
        // Check without trailing slash too
        if (!rawPath.startsWith(workspace) && rawPath !== this.config.workspaceDir) {
          return false;
        }
      }
    }

    // Layer 6: forbidden prefixes — expand ~ to home directory first
    const expandedPath = rawPath.startsWith("~/")
      ? this.home + rawPath.slice(1)
      : rawPath;

    // Static forbidden prefixes
    for (const prefix of FORBIDDEN_PREFIXES) {
      if (expandedPath === prefix || expandedPath.startsWith(prefix + "/")) {
        return false;
      }
    }

    // Dynamic forbidden prefixes derived from home directory
    const homeForbidden = [
      `${this.home}/.ssh`,
      `${this.home}/.aws`,
      `${this.home}/.gnupg`,
    ];
    for (const prefix of homeForbidden) {
      if (expandedPath === prefix || expandedPath.startsWith(prefix + "/")) {
        return false;
      }
    }

    // Custom forbidden paths from config
    for (const forbidden of this.config.forbiddenPaths) {
      if (expandedPath === forbidden || expandedPath.startsWith(forbidden + "/")) {
        return false;
      }
    }

    return true;
  }

  // -------------------------------------------------------------------------
  // Private: shell lexer
  // -------------------------------------------------------------------------

  /**
   * Quote-aware shell lexer.
   * Splits on unquoted: ; | && || \n
   * Rejects unquoted: ` $( <( >( ${ < > >> & (standalone) tee
   * Returns an array of command segments.
   */
  private parseShellSegments(command: string): string[] {
    let i = 0;
    let inSingle = false;
    let inDouble = false;
    const segments: string[] = [];
    let current = "";

    while (i < command.length) {
      const ch = command[i]!;
      const next = command[i + 1];

      if (inSingle) {
        if (ch === "'") inSingle = false;
        else current += ch;
        i++;
        continue;
      }

      if (inDouble) {
        if (ch === '"') inDouble = false;
        else current += ch;
        i++;
        continue;
      }

      // Not in any quote
      switch (ch) {
        case "'":
          inSingle = true;
          i++;
          break;

        case '"':
          inDouble = true;
          i++;
          break;

        case "`":
          throw new SecurityError(
            "Shell injection detected: backtick command substitution is not allowed",
            "SHELL_INJECTION"
          );

        case "$":
          if (next === "(") {
            throw new SecurityError(
              "Shell injection detected: $() command substitution is not allowed",
              "SHELL_INJECTION"
            );
          }
          if (next === "{") {
            throw new SecurityError(
              "Shell injection detected: ${} variable expansion is not allowed",
              "SHELL_INJECTION"
            );
          }
          current += ch;
          i++;
          break;

        case "<":
          if (next === "(") {
            throw new SecurityError(
              "Shell injection detected: <() process substitution is not allowed",
              "SHELL_INJECTION"
            );
          }
          throw new SecurityError(
            "Shell injection detected: input redirection is not allowed",
            "SHELL_INJECTION"
          );

        case ">":
          if (next === ">") {
            throw new SecurityError(
              "Shell injection detected: >> append redirection is not allowed",
              "SHELL_INJECTION"
            );
          }
          if (next === "(") {
            throw new SecurityError(
              "Shell injection detected: >() process substitution is not allowed",
              "SHELL_INJECTION"
            );
          }
          throw new SecurityError(
            "Shell injection detected: output redirection is not allowed",
            "SHELL_INJECTION"
          );

        case "&": {
          // && is a normal logical AND operator — split segment
          if (next === "&") {
            const seg = current.trim();
            if (seg) segments.push(seg);
            current = "";
            i += 2;
          } else {
            // Standalone & → background execution, not allowed
            throw new SecurityError(
              "Shell injection detected: background execution (&) is not allowed",
              "SHELL_INJECTION"
            );
          }
          break;
        }

        case "|": {
          // || is logical OR → split segment
          if (next === "|") {
            const seg = current.trim();
            if (seg) segments.push(seg);
            current = "";
            i += 2;
          } else {
            // Single pipe → split segment
            const seg = current.trim();
            if (seg) {
              // Check if seg contains 'tee' as the command
              this.checkForTee(seg);
              segments.push(seg);
            }
            current = "";
            i++;
          }
          break;
        }

        case ";":
        case "\n": {
          const seg = current.trim();
          if (seg) segments.push(seg);
          current = "";
          i++;
          break;
        }

        default:
          current += ch;
          i++;
      }
    }

    const seg = current.trim();
    if (seg) {
      // Check final segment for tee
      this.checkForTee(seg);
      segments.push(seg);
    }

    return segments.length > 0 ? segments : [""];
  }

  /**
   * Check if a segment's first word is "tee" and reject it.
   */
  private checkForTee(segment: string): void {
    const firstWord = segment.trim().split(/\s+/)[0] ?? "";
    const base = firstWord.includes("/") ? firstWord.split("/").pop()! : firstWord;
    if (base === "tee") {
      throw new SecurityError(
        "Shell injection detected: tee is not allowed",
        "SHELL_INJECTION"
      );
    }
  }
}
