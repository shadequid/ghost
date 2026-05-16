import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

const ExecSchema = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  working_dir: Type.Optional(Type.String({ description: "Working directory (default: current)" })),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (default: 60, max: 600)", minimum: 1, maximum: 600 })),
});

const SAFE_ENV_KEYS = ["PATH", "HOME", "TERM", "LANG", "USER", "SHELL", "TMPDIR"];
const MAX_OUTPUT = 10_000;
const HEAD_SIZE = 5_000;
const TAIL_SIZE = 5_000;

const DENY_PATTERNS = [
  /\brm\s+-[rf]{1,2}\b/,
  /\brm\s+--(?:recursive|force)\b/,
  /\bdel\s+\/[fq]\b/,
  /\brmdir\s+\/s\b/,
  /(?:^|[;&|]\s*)format\b/,
  /\b(mkfs|diskpart)\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/sd/,
  /\b(shutdown|reboot|poweroff)\b/,
  /:\(\)\s*\{.*\};\s*:/,
];

const INTERNAL_URL_RE = /https?:\/\/(?:localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\[::1\])/i;

function buildSafeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of SAFE_ENV_KEYS) {
    const val = Bun.env[key];
    if (val !== undefined) env[key] = val;
  }
  return env;
}

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  const head = text.slice(0, HEAD_SIZE);
  const tail = text.slice(-TAIL_SIZE);
  const skipped = text.length - HEAD_SIZE - TAIL_SIZE;
  return `${head}\n\n--- truncated (${skipped} chars omitted) ---\n\n${tail}`;
}

export class ExecTool implements AgentTool<typeof ExecSchema> {
  readonly name = "exec";
  readonly label = "Execute";
  readonly description = "Execute a shell command and return its output.";
  readonly parameters = ExecSchema;

  async execute(
    _toolCallId: string,
    params: Static<typeof ExecSchema>,
    signal?: AbortSignal,
  ): Promise<AgentToolResult<{ exitCode: number }>> {
    const { command, working_dir, timeout = 60 } = params;

    for (const pattern of DENY_PATTERNS) {
      if (pattern.test(command)) {
        throw new Error(`Command denied by security policy: ${command}`);
      }
    }

    if (INTERNAL_URL_RE.test(command)) {
      throw new Error("Command denied: contains internal/private URL");
    }

    const proc = Bun.spawn(["sh", "-c", command], {
      stdout: "pipe",
      stderr: "pipe",
      env: buildSafeEnv(),
      cwd: working_dir,
    });

    const timeoutMs = Math.min(timeout, 600) * 1000;
    const timer = setTimeout(() => proc.kill(), timeoutMs);

    try {
      const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).arrayBuffer(),
        proc.exited,
      ]);
      clearTimeout(timer);

      if (signal?.aborted) throw new Error("Aborted");

      const stdout = Buffer.from(stdoutBuf).toString("utf-8");
      const stderr = Buffer.from(stderrBuf).toString("utf-8");
      const combined = stderr ? `${stdout}\n${stderr}` : stdout;
      const output = truncateOutput(combined);

      return {
        content: [{ type: "text", text: `${output}\n[exit code: ${exitCode}]` }],
        details: { exitCode },
      };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && (err.message.includes("killed") || err.message === "Aborted")) {
        throw new Error(`Command timeout/killed after ${timeout}s`);
      }
      throw err;
    }
  }
}
