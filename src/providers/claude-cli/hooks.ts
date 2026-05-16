/**
 * Claude Code SDK hooks for Ghost tool calls.
 *
 *   PreToolUse  — security policy + path allowlist (fast, sync gates)
 *   PostToolUse — leak detector scrub (replaces tool output via
 *                 `updatedToolOutput` before result reaches the model)
 *
 * Confirm-gate lives in the MCP handler — it waits indefinitely
 * for user decision and `HookCallbackMatcher.timeout` would cap it.
 */

import type {
  HookCallback,
  PreToolUseHookInput,
  PostToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { SecurityPolicy } from "../../security/policy.js";
import type { LeakDetector } from "../../security/leak-detector.js";
import type { EventBus } from "../../bus/events.js";
import { ToolEvents } from "../../events/tool-events.js";
import { SecurityError } from "../../core/errors.js";
import { READ_TOOLS } from "../../security/constants.js";
import type { Logger } from "pino";

/** SDK reports MCP tools as `mcp__<server>__<tool>`; strip back to raw name. */
const MCP_PREFIX_RE = /^mcp__ghost__/;
const rawToolName = (name: string): string => name.replace(MCP_PREFIX_RE, "");

// ---------------------------------------------------------------------------
// PreToolUse — security + path
// ---------------------------------------------------------------------------

export interface PreToolUseHookDeps {
  security: SecurityPolicy;
  logger: Logger;
}

const denyPre = (reason: string) => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse" as const,
    permissionDecision: "deny" as const,
    permissionDecisionReason: reason,
  },
});

const allowPre = () => ({
  hookSpecificOutput: {
    hookEventName: "PreToolUse" as const,
    permissionDecision: "allow" as const,
  },
});

export function createPreToolUseHook(deps: PreToolUseHookDeps): HookCallback {
  const { security, logger } = deps;

  return async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    const pre = input as PreToolUseHookInput;

    const toolName = rawToolName(pre.tool_name);
    const args = (typeof pre.tool_input === "object" && pre.tool_input !== null)
      ? pre.tool_input as Record<string, unknown>
      : {};

    try {
      const op: "read" | "act" = READ_TOOLS.has(toolName) ? "read" : "act";
      security.enforceToolOperation(op, toolName);
    } catch (err) {
      const msg = err instanceof SecurityError ? err.message : "Blocked by security policy";
      logger.warn({ tool: toolName, reason: msg }, "tool blocked by security");
      return denyPre(msg);
    }

    if (typeof args.path === "string" && !security.isPathAllowed(args.path)) {
      logger.warn({ tool: toolName, path: args.path }, "tool blocked by path check");
      return denyPre(`Path not allowed: ${args.path}`);
    }

    return allowPre();
  };
}

// ---------------------------------------------------------------------------
// PostToolUse — leak detector scrub
// ---------------------------------------------------------------------------

export interface PostToolUseHookDeps {
  leakDetector: LeakDetector;
  /** Emit mcpResult after tool execution so the web UI can update confirm cards. */
  eventBus: EventBus;
  logger: Logger;
}

interface ToolResponseShape {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export function createPostToolUseHook(deps: PostToolUseHookDeps): HookCallback {
  const { leakDetector, eventBus, logger } = deps;

  return async (input) => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const post = input as PostToolUseHookInput;
    const response = post.tool_response as ToolResponseShape | undefined;
    const toolName = rawToolName(post.tool_name);

    // Publish mcpResult so the web UI can transition confirmation cards from
    // "executing" to "executed". The pi-ai toolcall_end fires from the assistant's
    // tool_use stream block BEFORE this handler runs, so the frontend needs this
    // separate event to mark completion.
    eventBus.publish(ToolEvents.mcpResult({
      toolCallId: post.tool_use_id,
      name: toolName,
      success: response?.isError !== true,
      durationSecs: typeof post.duration_ms === "number"
        ? Math.round(post.duration_ms / 1000)
        : undefined,
    }));

    if (!response?.content) return {};

    let dirty = false;
    const scrubbed = response.content.map((c) => {
      if (c.type !== "text" || typeof c.text !== "string") return c;
      const r = leakDetector.scrub(c.text);
      if (r.clean) return c;
      dirty = true;
      return { ...c, text: r.redacted };
    });

    if (!dirty) return {};

    logger.debug({ tool: toolName }, "leak detector redacted tool output");
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        updatedToolOutput: { ...response, content: scrubbed },
      },
    };
  };
}
