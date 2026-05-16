import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expandHome } from "../config/paths.js";

const ListDirSchema = Type.Object({
  path: Type.String({ description: "Directory path to list" }),
  recursive: Type.Optional(Type.Boolean({ description: "List files recursively (default: false)" })),
  max_entries: Type.Optional(Type.Number({ description: "Max entries to return (default: 200)", minimum: 1 })),
});

const NOISE_DIRS = new Set([
  ".git", "node_modules", "__pycache__", ".venv", "venv",
  "dist", ".next", "coverage", ".cache", ".tsbuildinfo",
  ".DS_Store", "target", "build",
]);

const DEFAULT_MAX = 200;

export class ListDirTool implements AgentTool<typeof ListDirSchema> {
  readonly name = "list_dir";
  readonly label = "List Directory";
  readonly description = "List files and directories. Auto-ignores noise directories (.git, node_modules, etc.).";
  readonly parameters = ListDirSchema;

  async execute(
    _toolCallId: string,
    params: Static<typeof ListDirSchema>,
  ): Promise<AgentToolResult<{ total: number }>> {
    const { path: rawPath, recursive = false, max_entries = DEFAULT_MAX } = params;
    const path = expandHome(rawPath);
    const entries: string[] = [];
    let total = 0;

    const walk = (dir: string) => {
      const items = readdirSync(dir);
      for (const item of items) {
        if (NOISE_DIRS.has(item)) continue;
        const full = join(dir, item);
        const rel = relative(path, full);
        let isDir = false;
        try {
          isDir = statSync(full).isDirectory();
        } catch { continue; }

        total++;
        if (entries.length < max_entries) {
          entries.push(isDir ? `${rel}/` : rel);
        }

        if (recursive && isDir) walk(full);
      }
    };

    walk(path);

    let text = entries.join("\n");
    if (total > max_entries) {
      text += `\n\n[Showing ${max_entries} of ${total} entries (truncated). Use max_entries to see more.]`;
    }

    return {
      content: [{ type: "text", text: text || "(empty directory)" }],
      details: { total },
    };
  }
}
