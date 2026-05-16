/**
 * Stream factory for Claude CLI provider — uses @anthropic-ai/claude-agent-sdk query().
 *
 * SDK message → pi-ai event mapping lives in sdk-mapper.ts.
 */

import type { Api, Context, Model, StreamOptions } from "@mariozechner/pi-ai";
import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
} from "@mariozechner/pi-ai";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance, HookCallback, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import { agentRunContext } from "../../agent/run-context.js";
import { resolveClaudeCodeBinary } from "./binary-path.js";
import {
  type CliHandoff,
  shouldHandoff,
  formatHandoffPrompt,
  extractUserPrompt,
  sha256,
} from "./handoff.js";
import type { CliHandoffStore, CliSessionState } from "./handoff-store.js";
import { SdkMessageMapper } from "./sdk-mapper.js";
import type { Logger } from "pino";

// Re-export handoff public API so consumers that import from this module still compile
export { type CliHandoff, shouldHandoff, formatHandoffPrompt, extractUserPrompt } from "./handoff.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudeCliStreamDeps {
  workspacePath: string;
  logger: Logger;
  permissionMode: PermissionMode;
  /** Returns a CLI-specific system prompt (without skill sections). */
  buildCliSystemPrompt: () => string;
  /** Called before each invocation to sync CLAUDE.md and skills. */
  setupWorkspace: (systemPrompt: string) => void;
  /** Persistent store for session state (sessionId + drift detection). */
  handoffStore: CliHandoffStore;
  /** In-process MCP server exposing Ghost tools to the SDK. */
  mcpServer: McpSdkServerConfigWithInstance;
  /** PreToolUse hook for security + path checks. */
  preToolUseHook: HookCallback;
  /** PostToolUse hook for leak detection. */
  postToolUseHook: HookCallback;
}

// ---------------------------------------------------------------------------
// Stream factory
// ---------------------------------------------------------------------------

export function createClaudeCliStream(
  deps: ClaudeCliStreamDeps,
): (model: Model<Api>, context: Context, options?: StreamOptions) => AssistantMessageEventStream {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    void runSdkQuery(stream, model, context, deps, options);
    return stream;
  };
}

// ---------------------------------------------------------------------------
// SDK query runner
// ---------------------------------------------------------------------------

async function runSdkQuery(
  stream: AssistantMessageEventStream,
  model: Model<Api>,
  context: Context,
  deps: ClaudeCliStreamDeps,
  options: StreamOptions | undefined,
): Promise<void> {
  const t0 = Date.now();
  const log = deps.logger;

  // Wire abort signal from pi-ai StreamOptions into an AbortController.
  // Declared outside try/catch so the catch block can inspect it when
  // determining whether a thrown error is an abort or a real failure.
  // Handle pre-aborted signals explicitly: addEventListener fires only for
  // future events, so an already-aborted signal must be forwarded manually.
  const abortController = new AbortController();
  if (options?.signal) {
    if (options.signal.aborted) {
      abortController.abort();
    } else {
      options.signal.addEventListener("abort", () => abortController.abort(), { once: true });
    }
  }

  // Short-circuit if signal was already aborted before we started
  if (abortController.signal.aborted) {
    stream.push(makeErrorEvent("Aborted by user", model.id));
    stream.end();
    return;
  }

  // Task-kind calls (Runner-driven background jobs) run ephemerally —
  // no resume, no disk persistence, no handoff mutations — so they never
  // clobber the user's main SDK session, even on the error path.
  const isTaskCall = agentRunContext.getStore()?.kind === "task";

  try {
    // Build system prompt and sync workspace (CLAUDE.md + skills)
    const systemPrompt = deps.buildCliSystemPrompt();
    const systemHash = sha256(systemPrompt);
    deps.setupWorkspace(systemPrompt);

    // Drift detection + resume only apply to the main agent path. For task
    // calls we always start a fresh ephemeral session.
    let resumeSessionId: string | undefined;
    let prompt: string;
    if (isTaskCall) {
      prompt = extractUserPrompt(context.messages);
      resumeSessionId = undefined;
    } else {
      const stored = deps.handoffStore.load();
      const handoffState: CliHandoff | null = stored;
      const needsHandoff = shouldHandoff(handoffState, systemHash, context.messages.length);
      prompt = needsHandoff
        ? formatHandoffPrompt(context.messages)
        : extractUserPrompt(context.messages);
      resumeSessionId = needsHandoff ? undefined : (stored?.sessionId ?? undefined);
      if (needsHandoff) {
        log.debug({ elapsed: Date.now() - t0 }, "sdk: drift detected, starting fresh session");
        deps.handoffStore.clear();
      }
    }

    if (!prompt) throw new Error("No user message found in context");

    // Pin the native binary path on Linux: the SDK probes its musl optional
    // dep before the glibc one, so on a glibc host both packages installed →
    // it picks the musl binary and exec() fails with ENOENT on the missing
    // musl loader.
    const pathToClaudeCodeExecutable = resolveClaudeCodeBinary(log);

    const sdkQuery = query({
      prompt,
      options: {
        // Disable all SDK built-in tools (Read, Write, Bash, Edit, etc.) so only
        // Ghost MCP tools are available. This prevents prompt-injection attacks from
        // reaching the user's filesystem via the SDK's native tool surface.
        tools: [],
        ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
        // Suppress thinking content blocks from the response stream. The model
        // still reasons internally (quality preserved); only a signature is
        // returned for multi-turn continuity instead of the raw thinking text.
        // Without this, adaptive thinking on Opus 4.6+ leaks reasoning prose
        // into the rendered chat between tool calls.
        thinking: { type: "adaptive", display: "omitted" },
        systemPrompt,
        ...(isTaskCall ? { persistSession: false } : { resume: resumeSessionId }),
        cwd: deps.workspacePath,
        permissionMode: deps.permissionMode,
        model: model.id,
        // Isolate from the user's global Claude Code config (~/.claude/settings.json,
        // ~/.claude/AGENTS.md, plugins, hooks). Only the workspace's `.claude/` is loaded.
        settingSources: ["project", "local"],
        // Emit stream_event messages so sdk-mapper can produce token-by-token deltas.
        includePartialMessages: true,
        mcpServers: { ghost: deps.mcpServer },
        hooks: {
          PreToolUse: [{ matcher: "mcp__ghost__.*", hooks: [deps.preToolUseHook] }],
          PostToolUse: [{ matcher: "mcp__ghost__.*", hooks: [deps.postToolUseHook] }],
        },
        abortController,
      },
    });

    let capturedSessionId: string | null = null;
    const mapper = new SdkMessageMapper(model.id, log);

    for await (const msg of sdkQuery) {
      if (msg.type === "system") {
        // Capture session_id from init message for resume on the next turn.
        // Not emitted as a pi-ai event — internal bookkeeping only.
        capturedSessionId = msg.session_id ?? null;
        continue;
      }

      const piEvents = mapper.process(msg);
      for (const e of piEvents) {
        if (e.type === "done" || e.type === "error") {
          log.debug({ elapsed: Date.now() - t0 }, e.type);
        }
        stream.push(e);
      }
    }

    // Persist session state so the next turn can resume without drift.
    // Task calls run ephemerally — skip save so the main session stays intact.
    if (!isTaskCall) {
      const finalState: CliSessionState = {
        sessionId: capturedSessionId,
        systemPromptHash: systemHash,
        syncedCount: context.messages.length,
      };
      deps.handoffStore.save(finalState);
    }

    stream.end();
  } catch (err) {
    const elapsed = Date.now() - t0;
    // Abort is user-initiated, not a session failure — preserve the SDK sessionId
    // so the next turn can resume cleanly with prompt caching intact.
    // Task calls never touch the handoff store, so an error must not clear it
    // either — otherwise a flaky background job would wipe the main session.
    const isAbort = err instanceof Error
      && (err.name === "AbortError" || abortController.signal.aborted);
    if (!isAbort && !isTaskCall) {
      deps.handoffStore.clear();
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ err, elapsed, isAbort }, "sdk query terminated");
    stream.push(makeErrorEvent(
      isAbort ? "Aborted by user" : `Claude Code error: ${errorMsg}`,
      model.id,
    ));
    stream.end();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeErrorEvent(message: string, modelId: string): AssistantMessageEvent {
  return {
    type: "error",
    reason: "error",
    error: {
      role: "assistant",
      content: [{ type: "text", text: message }],
      api: "claude-cli",
      provider: "claude-cli",
      model: modelId,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "error",
      errorMessage: message,
      timestamp: Date.now(),
    },
  };
}
