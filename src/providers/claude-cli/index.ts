/**
 * Claude CLI provider — entry point.
 *
 * Registers "claude-cli" as a pi-ai API provider. The stream function uses
 * @anthropic-ai/claude-agent-sdk query() via an in-process MCP server.
 *
 * Accepts raw deps (tools, confirmService, eventBus, security, leakDetector)
 * and builds the MCP server + hooks internally so the runtime composition
 * root stays free of SDK-specific details.
 */

import { registerApiProvider } from "@mariozechner/pi-ai";
import type { Api, SimpleStreamOptions, StreamOptions } from "@mariozechner/pi-ai";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { createClaudeCliStream, type ClaudeCliStreamDeps } from "./chat.js";
import { setupCliWorkspace } from "./workspace.js";
import { createGhostSdkMcpServer } from "./mcp.js";
import { createPreToolUseHook, createPostToolUseHook } from "./hooks.js";
import type { CliHandoffStore } from "./handoff-store.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { ConfirmService } from "../../services/trading-confirm.js";
import type { EventBus } from "../../bus/events.js";
import type { SecurityPolicy } from "../../security/policy.js";
import type { LeakDetector } from "../../security/leak-detector.js";
import pino, { type Logger } from "pino";

export interface ClaudeCliProviderConfig {
  model: string;
  permissionMode: PermissionMode;
  workspacePath: string;
  builtinSkillsDir: string | undefined;
  userSkillsDir: string | undefined;
  /** Returns a CLI-specific system prompt (without skill sections). */
  buildCliSystemPrompt: () => string;
  /** Returns disabled skill names (for excluding from workspace sync). */
  getDisabledSkills?: () => Set<string>;
  /** Persistent store for session state. */
  handoffStore: CliHandoffStore;
  /** Pino logger; silent logger used if omitted. */
  logger?: Logger;
  /** Raw deps — provider builds the MCP server and hooks from these. */
  tools: ToolRegistry;
  confirmService: ConfirmService;
  eventBus: EventBus;
  security: SecurityPolicy;
  leakDetector: LeakDetector;
}

export interface ClaudeCliProvider {
  register(): void;
  setupWorkspace(systemPrompt: string): void;
}

export function createClaudeCliProvider(config: ClaudeCliProviderConfig): ClaudeCliProvider {
  const logger = config.logger ?? pino({ level: "silent" });
  let registered = false;

  // Detect a fresh Ghost workspace (user deleted ~/.ghost, first daemon start, etc.)
  // before setupCliWorkspace creates CLAUDE.md. SDK manages its own session state via
  // the handoffStore — we reset it here so a wiped Ghost doesn't resume a stale session.
  const workspaceIsFresh = !existsSync(join(config.workspacePath, "CLAUDE.md"));
  if (workspaceIsFresh) {
    config.handoffStore.clear();
  }

  // Build the SDK cluster (MCP server + hooks) from raw deps.
  const mcpServer = createGhostSdkMcpServer({
    tools: config.tools,
    confirmService: config.confirmService,
    logger,
  });
  const preToolUseHook = createPreToolUseHook({
    security: config.security,
    logger,
  });
  const postToolUseHook = createPostToolUseHook({
    leakDetector: config.leakDetector,
    eventBus: config.eventBus,
    logger,
  });

  function doSetupWorkspace(systemPrompt: string): void {
    setupCliWorkspace({
      workspacePath: config.workspacePath,
      systemPrompt,
      builtinSkillsDir: config.builtinSkillsDir,
      userSkillsDir: config.userSkillsDir,
      disabledSkills: config.getDisabledSkills?.(),
    });
  }

  return {
    register(): void {
      if (registered) return;
      registered = true;

      const streamDeps: ClaudeCliStreamDeps = {
        workspacePath: config.workspacePath,
        logger,
        permissionMode: config.permissionMode,
        buildCliSystemPrompt: () => config.buildCliSystemPrompt(),
        setupWorkspace: (systemPrompt) => doSetupWorkspace(systemPrompt),
        handoffStore: config.handoffStore,
        mcpServer,
        preToolUseHook,
        postToolUseHook,
      };

      const streamFn = createClaudeCliStream(streamDeps);
      registerApiProvider(
        {
          api: "claude-cli" as Api,
          stream: streamFn,
          streamSimple: (m, ctx, opts?: SimpleStreamOptions) => streamFn(m, ctx, opts as StreamOptions),
        },
        "ghost-claude-cli",
      );
    },

    setupWorkspace(systemPrompt: string): void {
      doSetupWorkspace(systemPrompt);
    },
  };
}
