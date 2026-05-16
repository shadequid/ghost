// Credential patterns compiled once at module load time.
const PATTERNS: Array<{ name: string; regex: RegExp; redactWith?: string }> = [
  {
    name: "stripe",
    regex: /[sp]k_(live|test)_[A-Za-z0-9]{24,}/g,
  },
  {
    name: "openai",
    // sk- followed by 48+ alphanumeric chars — must not match sk-ant- (Anthropic)
    regex: /sk-(?!ant-)[A-Za-z0-9]{48,}/g,
  },
  {
    name: "anthropic",
    regex: /sk-ant-[A-Za-z0-9]{32,}/g,
  },
  {
    name: "google",
    regex: /AIza[A-Za-z0-9_-]{35}/g,
  },
  {
    name: "github",
    regex: /gh[pousr]_[A-Za-z0-9]{36,}/g,
  },
  {
    name: "github_pat",
    regex: /github_pat_[A-Za-z0-9]{22,}/g,
  },
  {
    name: "aws_access_key",
    regex: /AKIA[A-Z0-9]{16}/g,
  },
  {
    name: "aws_secret",
    regex: /aws[_-]?secret[_-]?access[_-]?key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/gi,
  },
  {
    name: "private_key",
    regex: /-----BEGIN\s+(?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END\s+(?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    redactWith: "[REDACTED_PRIVATE_KEY]",
  },
  {
    name: "jwt",
    regex: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    name: "db_url",
    regex: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/gi,
  },
  {
    name: "generic_secret",
    regex: /(?:api[_-]?key|token|password|secret)\s*[=:]\s*['"]?[A-Za-z0-9_\-/.+=]{20,}/gi,
  },
];

export class LeakDetector {
  private readonly sensitivity: number;

  /**
   * @param sensitivity - Detection threshold 0.0–1.0 (default 0.7).
   *   When sensitivity <= 0.5 the broad `generic_secret` pattern is skipped
   *   to reduce false positives at lower sensitivity settings.
   */
  constructor(sensitivity: number = 0.7) {
    this.sensitivity = sensitivity;
  }

  /**
   * Scrubs credentials from the input string.
   * Returns the detected pattern names, redacted text, and a clean flag.
   */
  scrub(input: string): { clean: boolean; patterns: string[]; redacted: string } {
    const detectedPatterns: string[] = [];
    let redacted = input;

    for (const { name, regex, redactWith } of PATTERNS) {
      // Skip generic_secret pattern when sensitivity is at or below 0.5
      if (name === "generic_secret" && this.sensitivity <= 0.5) {
        continue;
      }

      // Reset lastIndex before each use (patterns have /g flag and are shared)
      regex.lastIndex = 0;
      const replacement = redactWith ?? "[REDACTED]";
      const replaced = redacted.replace(regex, () => {
        if (!detectedPatterns.includes(name)) {
          detectedPatterns.push(name);
        }
        return replacement;
      });
      redacted = replaced;
    }

    return {
      clean: detectedPatterns.length === 0,
      patterns: detectedPatterns,
      redacted,
    };
  }
}
