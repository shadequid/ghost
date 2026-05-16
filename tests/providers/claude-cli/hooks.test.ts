/**
 * Tests for PreToolUse and PostToolUse SDK hook factories.
 *
 * createPreToolUseHook  — security policy enforcement + path allowlist gate
 * createPostToolUseHook — leak detector scrub (replaces tool output)
 *
 * Neither hook touches the network or spawns processes; all deps are
 * pure in-memory stubs.
 */

import { describe, test, expect } from "bun:test";
import {
  createPreToolUseHook,
  createPostToolUseHook,
  type PreToolUseHookDeps,
  type PostToolUseHookDeps,
} from "../../../src/providers/claude-cli/hooks.js";
import { SecurityError } from "../../../src/core/errors.js";
import { NOOP_LOGGER } from "../../../src/logger.js";
import type { SecurityPolicy } from "../../../src/security/policy.js";
import type { LeakDetector } from "../../../src/security/leak-detector.js";
import type { EventBus } from "../../../src/bus/events.js";
import type { GhostEvent } from "../../../src/events/index.js";
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";

/**
 * HookCallback from the SDK requires 3 arguments but in practice the hook
 * implementations only inspect the first (the event input). Cast to a
 * simpler 1-arg callable so tests stay readable without extra `undefined`
 * placeholders.
 */
type HookFn = (input: Parameters<HookCallback>[0]) => ReturnType<HookCallback>;

/** Wrap createPreToolUseHook to return the narrower HookFn for test call sites. */
function makePreHook(deps: PreToolUseHookDeps): HookFn {
  return createPreToolUseHook(deps) as unknown as HookFn;
}

/** Wrap createPostToolUseHook to return the narrower HookFn for test call sites. */
function makePostHook(deps: PostToolUseHookDeps): HookFn {
  return createPostToolUseHook(deps) as unknown as HookFn;
}

// ---------------------------------------------------------------------------
// Minimal stubs
// ---------------------------------------------------------------------------

function makePolicy(overrides: {
  enforceThrows?: Error;
  pathAllowed?: boolean;
}): SecurityPolicy {
  return {
    enforceToolOperation: (_op: string, _name: string): void => {
      if (overrides.enforceThrows) throw overrides.enforceThrows;
    },
    isPathAllowed: (_p: string): boolean => overrides.pathAllowed ?? true,
    classifyCommandRisk: () => "low" as const,
    validateCommandExecution: () => "low" as const,
  } as unknown as SecurityPolicy;
}

function makeLeakDetector(options: {
  clean?: boolean;
  redacted?: string;
}): LeakDetector {
  return {
    scrub: (input: string) => ({
      clean: options.clean ?? true,
      patterns: options.clean ? [] : ["generic_secret"],
      redacted: options.redacted ?? input,
    }),
  } as unknown as LeakDetector;
}

function makePreDeps(overrides: Partial<PreToolUseHookDeps> = {}): PreToolUseHookDeps {
  return {
    security: makePolicy({}),
    logger: NOOP_LOGGER,
    ...overrides,
  };
}

function makeEventBus(onPublish?: (e: GhostEvent) => void): EventBus {
  return {
    publish: (e: GhostEvent) => { onPublish?.(e); },
    subscribe: () => () => {},
  } as unknown as EventBus;
}

function makePostDeps(overrides: Partial<PostToolUseHookDeps> = {}): PostToolUseHookDeps {
  return {
    leakDetector: makeLeakDetector({ clean: true }),
    eventBus: makeEventBus(),
    logger: NOOP_LOGGER,
    ...overrides,
  };
}

// Shared input builders — typed via HookFn so call sites compile cleanly.
function preInput(toolName: string, toolInput: Record<string, unknown> = {}): Parameters<HookFn>[0] {
  return { hook_event_name: "PreToolUse" as const, tool_name: toolName, tool_input: toolInput } as Parameters<HookFn>[0];
}

function postInput(toolResponse: Record<string, unknown> | undefined, toolUseId = "call-001"): Parameters<HookFn>[0] {
  return {
    hook_event_name: "PostToolUse" as const,
    tool_name: "mcp__ghost__ghost_watchlist_get",
    tool_use_id: toolUseId,
    tool_response: toolResponse,
  } as Parameters<HookFn>[0];
}

// ---------------------------------------------------------------------------
// PreToolUse — non-matching event
// ---------------------------------------------------------------------------

describe("createPreToolUseHook — non-PreToolUse event", () => {
  test("returns empty object for PostToolUse event", async () => {
    const hook = makePreHook(makePreDeps());
    const result = await hook({ hook_event_name: "PostToolUse" } as unknown as Parameters<HookFn>[0]);
    expect(result).toEqual({});
  });

  test("returns empty object for unknown event type", async () => {
    const hook = makePreHook(makePreDeps());
    const result = await hook({ hook_event_name: "Unknown" } as unknown as Parameters<HookFn>[0]);
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// PreToolUse — security policy enforcement
// ---------------------------------------------------------------------------

describe("createPreToolUseHook — security policy", () => {
  test("security policy throws SecurityError → deny with reason", async () => {
    const secErr = new SecurityError(
      'Tool "ghost_place_order" requires act permission but autonomy level is read_only',
      "TOOL_OPERATION_DENIED",
    );
    const hook = makePreHook(makePreDeps({ security: makePolicy({ enforceThrows: secErr }) }));

    const result = await hook(preInput("ghost_place_order"));
    expect(result).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("read_only"),
      },
    });
  });

  test("security policy throws generic Error → deny with fallback message", async () => {
    const hook = makePreHook(
      makePreDeps({ security: makePolicy({ enforceThrows: new Error("unexpected") }) }),
    );

    const result = await hook(preInput("ghost_watchlist_get"));
    expect(result).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Blocked by security policy",
      },
    });
  });

  test("security passes + path allowed → allow", async () => {
    const hook = makePreHook(makePreDeps());

    const result = await hook(preInput("ghost_watchlist_get"));
    expect(result).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
      },
    });
  });

  test("security passes, no path arg → allow (path check skipped)", async () => {
    // pathAllowed: false but no `path` key in tool_input → check never runs
    const hook = makePreHook(makePreDeps({ security: makePolicy({ pathAllowed: false }) }));

    const result = await hook(preInput("ghost_watchlist_get", { symbol: "BTC" }));
    expect(result).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
  });
});

// ---------------------------------------------------------------------------
// PreToolUse — path allowlist gate
// ---------------------------------------------------------------------------

describe("createPreToolUseHook — path allowlist", () => {
  test("path NOT in allowlist → deny with path error message", async () => {
    const hook = makePreHook(makePreDeps({ security: makePolicy({ pathAllowed: false }) }));

    const result = await hook(preInput("read_file", { path: "/etc/passwd" }));
    expect(result).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Path not allowed: /etc/passwd",
      },
    });
  });

  test("path in allowlist → allow", async () => {
    const hook = makePreHook(makePreDeps({ security: makePolicy({ pathAllowed: true }) }));

    const result = await hook(
      preInput("read_file", { path: "/home/user/ghost/workspace/file.md" }),
    );
    expect(result).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
  });
});

// ---------------------------------------------------------------------------
// PreToolUse — MCP prefix stripping
// ---------------------------------------------------------------------------

describe("createPreToolUseHook — MCP tool name prefix stripping", () => {
  test("mcp__ghost__foo → stripped to foo for security lookup", async () => {
    let seenName: string | undefined;
    const policy: SecurityPolicy = {
      enforceToolOperation: (_op: string, name: string) => { seenName = name; },
      isPathAllowed: () => true,
      classifyCommandRisk: () => "low" as const,
      validateCommandExecution: () => "low" as const,
    } as unknown as SecurityPolicy;

    const hook = makePreHook({ security: policy, logger: NOOP_LOGGER });
    await hook(preInput("mcp__ghost__ghost_watchlist_get"));

    expect(seenName).toBe("ghost_watchlist_get");
  });

  test("tool name without prefix passes through unchanged", async () => {
    let seenName: string | undefined;
    const policy: SecurityPolicy = {
      enforceToolOperation: (_op: string, name: string) => { seenName = name; },
      isPathAllowed: () => true,
      classifyCommandRisk: () => "low" as const,
      validateCommandExecution: () => "low" as const,
    } as unknown as SecurityPolicy;

    const hook = makePreHook({ security: policy, logger: NOOP_LOGGER });
    await hook(preInput("read_file"));

    expect(seenName).toBe("read_file");
  });
});

// ---------------------------------------------------------------------------
// PostToolUse — non-PostToolUse event
// ---------------------------------------------------------------------------

describe("createPostToolUseHook — non-PostToolUse event", () => {
  test("returns empty object for PreToolUse event", async () => {
    const hook = makePostHook(makePostDeps());
    const result = await hook({ hook_event_name: "PreToolUse" } as unknown as Parameters<HookFn>[0]);
    expect(result).toEqual({});
  });

  test("returns empty object for unknown event", async () => {
    const hook = makePostHook(makePostDeps());
    const result = await hook({ hook_event_name: "SomethingElse" } as unknown as Parameters<HookFn>[0]);
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// PostToolUse — clean content
// ---------------------------------------------------------------------------

describe("createPostToolUseHook — clean content", () => {
  test("content is clean → returns empty (no updatedToolOutput)", async () => {
    const hook = makePostHook(makePostDeps({ leakDetector: makeLeakDetector({ clean: true }) }));

    const result = await hook(
      postInput({ content: [{ type: "text", text: "BTC price: $100k" }] }),
    );
    expect(result).toEqual({});
  });

  test("empty content array → returns empty", async () => {
    const hook = makePostHook(makePostDeps());
    const result = await hook(postInput({ content: [] }));
    expect(result).toEqual({});
  });

  test("undefined tool_response → returns empty", async () => {
    const hook = makePostHook(makePostDeps());
    const result = await hook(postInput(undefined));
    expect(result).toEqual({});
  });

  test("tool_response without content field → returns empty", async () => {
    const hook = makePostHook(makePostDeps());
    const result = await hook(postInput({ isError: false }));
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// PostToolUse — leak detected
// ---------------------------------------------------------------------------

describe("createPostToolUseHook — leak detection", () => {
  function makeLeakPostInput(text: string): Parameters<HookFn>[0] {
    return {
      hook_event_name: "PostToolUse" as const,
      tool_name: "mcp__ghost__read_file",
      tool_response: { content: [{ type: "text", text }] },
    } as Parameters<HookFn>[0];
  }

  test("content matches leak pattern → returns updatedToolOutput with scrubbed text", async () => {
    const dirty = "Found key: sk-ant-abc1234567890abcdefghijklmnopqrstuvwx in config";
    const scrubbed = "Found key: [REDACTED] in config";

    const hook = makePostHook(
      makePostDeps({ leakDetector: makeLeakDetector({ clean: false, redacted: scrubbed }) }),
    );

    const result = await hook(makeLeakPostInput(dirty));
    expect(result).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: {
          content: [{ type: "text", text: scrubbed }],
        },
      },
    });
  });

  test("multiple content items — only dirty items replaced", async () => {
    const secretText = "api_key=sk-ant-abc1234567890abcdefghijklmnopqrstuvwx";
    const cleanText = "BTC: $100,000";
    const scrubbedSecret = "api_key=[REDACTED]";

    const detector: LeakDetector = {
      scrub: (input: string) => {
        if (input.includes("sk-ant-")) {
          return { clean: false, patterns: ["anthropic"], redacted: scrubbedSecret };
        }
        return { clean: true, patterns: [], redacted: input };
      },
    } as unknown as LeakDetector;

    const hook = makePostHook({ leakDetector: detector, eventBus: makeEventBus(), logger: NOOP_LOGGER });

    const result = await hook({
      hook_event_name: "PostToolUse" as const,
      tool_name: "mcp__ghost__read_file",
      tool_response: {
        content: [
          { type: "text", text: secretText },
          { type: "text", text: cleanText },
        ],
      },
    } as Parameters<HookFn>[0]);

    expect(result).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: {
          content: [
            { type: "text", text: scrubbedSecret },
            { type: "text", text: cleanText },
          ],
        },
      },
    });
  });

  test("non-text content items are passed through unchanged", async () => {
    // Even if detector says dirty, non-text items should not be altered.
    const hook = makePostHook(
      makePostDeps({ leakDetector: makeLeakDetector({ clean: false, redacted: "[REDACTED]" }) }),
    );

    const result = await hook({
      hook_event_name: "PostToolUse" as const,
      tool_name: "mcp__ghost__read_file",
      tool_response: {
        content: [{ type: "image", data: "base64data" }],
      },
    } as Parameters<HookFn>[0]);

    // No text items → dirty flag never set → empty result
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// PostToolUse — mcpResult event bus publish
// ---------------------------------------------------------------------------

describe("createPostToolUseHook — mcpResult eventBus publish", () => {
  test("success response publishes mcpResult with success=true", async () => {
    const published: GhostEvent[] = [];
    const hook = makePostHook(
      makePostDeps({ eventBus: makeEventBus((e) => published.push(e)) }),
    );

    await hook(postInput({ content: [{ type: "text", text: "ok" }] }, "call-abc"));

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "mcp.tool_result",
      payload: {
        toolCallId: "call-abc",
        name: "ghost_watchlist_get",
        success: true,
      },
    });
  });

  test("error response publishes mcpResult with success=false", async () => {
    const published: GhostEvent[] = [];
    const hook = makePostHook(
      makePostDeps({ eventBus: makeEventBus((e) => published.push(e)) }),
    );

    await hook({
      hook_event_name: "PostToolUse" as const,
      tool_name: "mcp__ghost__ghost_place_order",
      tool_use_id: "call-xyz",
      tool_response: { content: [{ type: "text", text: "error" }], isError: true },
    } as Parameters<HookFn>[0]);

    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "mcp.tool_result",
      payload: {
        toolCallId: "call-xyz",
        name: "ghost_place_order",
        success: false,
      },
    });
  });

  test("durationSecs rounded from duration_ms", async () => {
    const published: GhostEvent[] = [];
    const hook = makePostHook(
      makePostDeps({ eventBus: makeEventBus((e) => published.push(e)) }),
    );

    await hook({
      hook_event_name: "PostToolUse" as const,
      tool_name: "mcp__ghost__ghost_watchlist_get",
      tool_use_id: "call-dur",
      duration_ms: 2700,
      tool_response: { content: [{ type: "text", text: "ok" }] },
    } as Parameters<HookFn>[0]);

    expect(published[0]).toMatchObject({
      payload: { durationSecs: 3 },
    });
  });
});
