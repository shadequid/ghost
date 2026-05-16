import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import type { TSchema, TextContent } from "@mariozechner/pi-ai";
import type { Logger } from "pino";

const MAX_RESULT_CHARS = 16_000;

export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool<TSchema>>();

  constructor(private readonly log: Logger) {}

  register(tool: AgentTool<TSchema>): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): AgentTool<TSchema> | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  all(): AgentTool<TSchema>[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  async execute(
    name: string,
    toolCallId: string,
    params: Record<string, unknown>,
  ): Promise<AgentToolResult<unknown>> {
    const tool = this.tools.get(name);
    if (!tool) {
      this.log.warn({ tool: name, toolCallId }, "tool not found");
      return {
        content: [{ type: "text", text: `Error: tool '${name}' not found` }],
        details: {},
      };
    }

    try {
      const t0 = Date.now();
      const result = await tool.execute(toolCallId, params as never);
      this.log.debug({ tool: name, elapsed: Date.now() - t0, toolCallId }, "tool completed");
      return this.truncateResult(result, name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error({ err, tool: name, toolCallId }, "tool execution failed");
      return {
        content: [{
          type: "text",
          text: `Error: ${msg}\n\n[Analyze the error and try a different approach.]`,
        }],
        details: {},
      };
    }
  }

  private truncateResult(result: AgentToolResult<unknown>, toolName?: string): AgentToolResult<unknown> {
    const truncated = result.content.map((block) => {
      if (block.type === "text") {
        const tb = block as TextContent;
        if (tb.text.length > MAX_RESULT_CHARS) {
          this.log.debug({ tool: toolName, from: tb.text.length, to: MAX_RESULT_CHARS }, "result truncated");
          return { type: "text" as const, text: tb.text.slice(0, MAX_RESULT_CHARS) + "\n... (truncated)" };
        }
      }
      return block;
    });
    return { ...result, content: truncated };
  }
}
