/**
 * In-process MCP server exposing Ghost tools to the Claude Agent SDK via
 * `createSdkMcpServer`. Runs in the same process as the daemon.
 *
 * Handler responsibilities:
 *   - Confirm-gate — waits indefinitely for user decision;
 *     cannot live in a hook because `HookCallbackMatcher.timeout` caps it
 *   - `tools.execute()` and surface errors
 *
 * Security/path checks → PreToolUse hook (`hooks.ts`).
 * Leak scrubbing      → PostToolUse hook (`hooks.ts`).
 */

import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Zod } from "@sinclair/typemap";
import type { z, ZodObject, ZodRawShape } from "zod";
import type { ToolRegistry } from "../../tools/registry.js";
import type { ConfirmService } from "../../services/trading-confirm.js";
import { isConfirmable, describeConfirm } from "../../services/confirm-policy.js";
import type { Logger } from "pino";

export interface SdkMcpDeps {
  tools: ToolRegistry;
  confirmService: ConfirmService;
  logger: Logger;
}

/**
 * Create the in-process MCP server config to mount under
 * `options.mcpServers.ghost` in the Claude Agent SDK `query()` call.
 */
export function createGhostSdkMcpServer(deps: SdkMcpDeps): McpSdkServerConfigWithInstance {
  const { tools, confirmService, logger } = deps;

  const toolDefs = tools.all().map((agentTool) => {
    // TypeBox → Zod object → raw shape. SDK's `tool()` expects ZodRawShape;
    // all Ghost tool params are TypeBox object schemas.
    const zodSchema = Zod(agentTool.parameters) as unknown as ZodObject<ZodRawShape>;
    const inputSchema: ZodRawShape = zodSchema.shape;

    return tool(
      agentTool.name,
      agentTool.description,
      inputSchema,
      async (args: z.infer<ZodObject<ZodRawShape>>) => {
        const argsRecord = (typeof args === "object" && args !== null)
          ? (args as Record<string, unknown>)
          : {};
        const toolCallId = `sdk-mcp-${crypto.randomUUID()}`;
        const t0 = Date.now();

        // Confirm gate. Same describer the orchestrator uses,
        // so web and Telegram render identical cards regardless of which
        // provider issued the call.
        if (isConfirmable(agentTool.name)) {
          const desc = describeConfirm(agentTool.name, argsRecord);
          let decision: { decision: "approved" | "rejected"; reason?: string };
          try {
            decision = await confirmService.confirm(desc.title, { lines: desc.bullets });
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Confirm service failed";
            logger.warn({ tool: agentTool.name, err }, "confirm threw — treating as rejected");
            return { content: [{ type: "text" as const, text: msg }], isError: true };
          }
          if (decision.decision === "rejected") {
            const reasonMsg = decision.reason && decision.reason.length > 0
              ? `User declined. Reason: ${decision.reason}`
              : "User declined. Do not retry.";
            logger.debug({ tool: agentTool.name, reason: decision.reason }, "tool rejected by user");
            return { content: [{ type: "text" as const, text: reasonMsg }], isError: true };
          }
        }

        try {
          const result = await tools.execute(agentTool.name, toolCallId, argsRecord);
          const textContent = result.content.filter(
            (c): c is { type: "text"; text: string } => c.type === "text",
          );
          logger.debug({ tool: agentTool.name, elapsed: `${Date.now() - t0}ms` }, "tool done");
          return { content: textContent };
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Tool execution failed";
          logger.error({ err, tool: agentTool.name, elapsed: `${Date.now() - t0}ms` }, "tool error");
          return { content: [{ type: "text" as const, text: msg }], isError: true };
        }
      },
    );
  });

  return createSdkMcpServer({
    name: "ghost",
    version: "1.0.0",
    tools: toolDefs,
  });
}
