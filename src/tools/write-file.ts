import { Type, type Static } from "@mariozechner/pi-ai";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const WriteFileSchema = Type.Object({
  path: Type.String({ description: "File path to write" }),
  content: Type.String({ description: "Content to write to the file" }),
});

export class WriteFileTool implements AgentTool<typeof WriteFileSchema> {
  readonly name = "write_file";
  readonly label = "Write File";
  readonly description = "Write content to a file. Creates parent directories automatically.";
  readonly parameters = WriteFileSchema;

  async execute(
    _toolCallId: string,
    params: Static<typeof WriteFileSchema>,
  ): Promise<AgentToolResult<{ path: string; bytes: number }>> {
    mkdirSync(dirname(params.path), { recursive: true });
    const written = await Bun.write(params.path, params.content);
    return {
      content: [{ type: "text", text: `Wrote ${written} bytes to ${params.path}` }],
      details: { path: params.path, bytes: written },
    };
  }
}
