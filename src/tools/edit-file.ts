import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { readFileSync, writeFileSync } from "node:fs";

const EditFileSchema = Type.Object({
  path: Type.String({ description: "File path to edit" }),
  old_text: Type.String({ description: "Text to find and replace" }),
  new_text: Type.String({ description: "Replacement text" }),
  replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences (default: false)" })),
});

function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+/g, " ").replace(/\r\n/g, "\n");
}

export class EditFileTool implements AgentTool<typeof EditFileSchema> {
  readonly name = "edit_file";
  readonly label = "Edit File";
  readonly description = "Find and replace text in a file. Supports whitespace-tolerant matching.";
  readonly parameters = EditFileSchema;

  async execute(
    _toolCallId: string,
    params: Static<typeof EditFileSchema>,
  ): Promise<AgentToolResult<{ path: string; replacements: number }>> {
    const { path, old_text, new_text, replace_all = false } = params;
    const content = readFileSync(path, "utf-8");

    // Exact match first
    if (content.includes(old_text)) {
      const updated = replace_all
        ? content.split(old_text).join(new_text)
        : content.replace(old_text, new_text);
      const count = replace_all
        ? content.split(old_text).length - 1
        : 1;
      writeFileSync(path, updated);
      return {
        content: [{ type: "text", text: `File updated: ${path} (${count} replacement${count > 1 ? "s" : ""})` }],
        details: { path, replacements: count },
      };
    }

    // Whitespace-tolerant fallback: collapse internal whitespace + trim for comparison
    const norm = (s: string) => s.replace(/[ \t]+/g, " ").trim();
    const oldLines = old_text.split("\n");
    const normOldLines = oldLines.map(norm);
    const contentLines = content.split("\n");
    const matches: string[] = [];

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const window = contentLines.slice(i, i + oldLines.length);
      if (window.map(norm).every((l, j) => l === normOldLines[j])) {
        matches.push(window.join("\n"));
      }
    }

    if (matches.length > 0) {
      const matchText = matches[0];
      let updated: string;
      let count: number;
      if (replace_all) {
        updated = content.split(matchText).join(new_text);
        count = matches.length;
      } else {
        updated = content.replace(matchText, new_text);
        count = 1;
      }
      writeFileSync(path, updated);
      return {
        content: [{ type: "text", text: `File updated: ${path} (${count} replacement${count > 1 ? "s" : ""}, whitespace-tolerant match)` }],
        details: { path, replacements: count },
      };
    }

    // Find closest matching lines for error hint
    const words = old_text.split(/\s+/).filter(w => w.length > 2).slice(0, 5);
    const hints: string[] = [];
    for (let i = 0; i < contentLines.length && hints.length < 3; i++) {
      const line = contentLines[i];
      if (words.some(w => line.includes(w))) {
        hints.push(`  line ${i + 1}: ${line}`);
      }
    }
    const hintMsg = hints.length > 0
      ? `\nClosest matches:\n${hints.join("\n")}`
      : "";
    throw new Error(`String not found in ${path}.${hintMsg}`);
  }
}
