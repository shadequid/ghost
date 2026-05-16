import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { expandHome } from "../config/paths.js";

const ReadFileSchema = Type.Object({
  path: Type.String({ description: "The file path to read" }),
  offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed, default 1)", minimum: 1 })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read (default 2000)", minimum: 1 })),
});

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico"]);
const IMAGE_MIMES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".bmp": "image/bmp", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
const DEFAULT_LIMIT = 2000;
const MAX_CHARS = 128_000;

export class ReadFileTool implements AgentTool<typeof ReadFileSchema> {
  readonly name = "read_file";
  readonly label = "Read File";
  readonly description = "Read the contents of a file. Returns numbered lines. Use offset and limit to paginate through large files.";
  readonly parameters = ReadFileSchema;

  async execute(
    _toolCallId: string,
    params: Static<typeof ReadFileSchema>,
  ): Promise<AgentToolResult<{ path: string; lines: number }>> {
    const { path: rawPath, offset = 1, limit = DEFAULT_LIMIT } = params;
    const path = expandHome(rawPath);

    const ext = extname(path).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      const data = readFileSync(path);
      const mime = IMAGE_MIMES[ext] ?? "image/png";
      return {
        content: [{ type: "image", data: data.toString("base64"), mimeType: mime }],
        details: { path, lines: 0 },
      };
    }

    const stat = statSync(path);
    if (stat.size > MAX_CHARS * 4) {
      const sample = readFileSync(path, { encoding: null }).subarray(0, 512);
      if (sample.includes(0)) {
        throw new Error(`File appears to be binary: ${path}. Use a more specific tool or download it.`);
      }
    }

    const content = readFileSync(path, "utf-8");
    const allLines = content.split("\n");
    const startIdx = offset - 1;
    const endIdx = Math.min(startIdx + limit, allLines.length);
    const slice = allLines.slice(startIdx, endIdx);

    const maxLineNumWidth = String(endIdx).length;
    const numbered = slice.map((line, i) => {
      const lineNum = String(startIdx + i + 1).padStart(maxLineNumWidth, " ");
      return `${lineNum} | ${line}`;
    }).join("\n");

    let result = numbered;
    if (result.length > MAX_CHARS) {
      result = result.slice(0, MAX_CHARS) + "\n... (truncated)";
    }

    if (endIdx < allLines.length) {
      result += `\n\n[Showing lines ${offset}-${endIdx} of ${allLines.length}. Use offset=${endIdx + 1} to continue.]`;
    }

    return {
      content: [{ type: "text", text: result }],
      details: { path, lines: slice.length },
    };
  }
}
