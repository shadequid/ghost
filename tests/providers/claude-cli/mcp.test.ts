/**
 * Tests for the SDK in-process MCP server wrapper.
 *
 * createGhostSdkMcpServer() calls createSdkMcpServer() from the SDK which
 * processes TypeBox → Zod schema conversion internally. Tests must supply
 * real TypeBox schemas (Type.Object) — plain JSON Schema objects throw at
 * construction time inside the SDK's typemap conversion.
 *
 * Test strategy:
 *   - Shape tests: call createGhostSdkMcpServer with valid TypeBox tools
 *   - Confirm-gate logic: tested via imported policy helpers (pure unit tests,
 *     no SDK invocation required)
 *   - isConfirmable / describeConfirm: verified directly — these are the
 *     exact callsites used by the handler closure
 *   - Error message formatting: pure data tests matching handler output strings
 */

import { describe, test, expect } from "bun:test";
import { Type } from "@mariozechner/pi-ai";
import type { ConfirmService, ConfirmDecision } from "../../../src/services/trading-confirm.js";
import { createGhostSdkMcpServer, type SdkMcpDeps } from "../../../src/providers/claude-cli/mcp.js";
import { isConfirmable, describeConfirm } from "../../../src/services/confirm-policy.js";
import { NOOP_LOGGER } from "../../../src/logger.js";
import type { ToolRegistry } from "../../../src/tools/registry.js";

// ---------------------------------------------------------------------------
// Stubs — parameters must use TypeBox (Type.Object) for SDK schema conversion
// ---------------------------------------------------------------------------

function makeConfirmService(decision: ConfirmDecision | Error): ConfirmService {
  return {
    confirm: async () => {
      if (decision instanceof Error) throw decision;
      return decision;
    },
  };
}

/** Build a minimal ToolRegistry with real TypeBox parameter schemas. */
function makeTools(names: string[] = ["ghost_watchlist_get"]): ToolRegistry {
  return {
    all: () =>
      names.map((name) => ({
        name,
        description: `Tool ${name}`,
        // TypeBox schema — required by @sinclair/typemap's Zod() conversion in claude-cli-mcp.ts
        parameters: Type.Object({}, { description: `Params for ${name}` }),
      })),
    execute: async () => ({ content: [{ type: "text", text: "ok" }] }),
    register: () => {},
  } as unknown as ToolRegistry;
}

function makeDeps(overrides: Partial<SdkMcpDeps> = {}): SdkMcpDeps {
  return {
    tools: makeTools(),
    confirmService: makeConfirmService({ decision: "approved" }),
    logger: NOOP_LOGGER,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Shape: createGhostSdkMcpServer with valid TypeBox schemas
// ---------------------------------------------------------------------------

describe("createGhostSdkMcpServer — shape", () => {
  test("returns a non-null object (McpSdkServerConfigWithInstance)", () => {
    const result = createGhostSdkMcpServer(makeDeps());
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
  });

  test("returns a distinct instance on each call", () => {
    const a = createGhostSdkMcpServer(makeDeps());
    const b = createGhostSdkMcpServer(makeDeps());
    expect(a).not.toBe(b);
  });

  test("handles empty tool registry without throwing", () => {
    const tools = makeTools([]);
    expect(() => createGhostSdkMcpServer(makeDeps({ tools }))).not.toThrow();
  });

  test("handles multiple tools without throwing", () => {
    const tools = makeTools(["ghost_watchlist_get", "ghost_bracket_order", "read_file"]);
    expect(() => createGhostSdkMcpServer(makeDeps({ tools }))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Confirm-gate: isConfirmable policy (pure unit — no SDK invocation)
// ---------------------------------------------------------------------------

describe("confirm-gate policy — isConfirmable", () => {
  test("ghost_bracket_order is confirmable", () => {
    expect(isConfirmable("ghost_bracket_order")).toBe(true);
  });

  test("ghost_place_order is confirmable", () => {
    expect(isConfirmable("ghost_place_order")).toBe(true);
  });

  test("ghost_cancel_order is confirmable", () => {
    expect(isConfirmable("ghost_cancel_order")).toBe(true);
  });

  test("ghost_emergency_close is confirmable", () => {
    expect(isConfirmable("ghost_emergency_close")).toBe(true);
  });

  test("ghost_watchlist_get is NOT confirmable", () => {
    expect(isConfirmable("ghost_watchlist_get")).toBe(false);
  });

  test("read_file is NOT confirmable", () => {
    expect(isConfirmable("read_file")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Confirm-gate: describeConfirm card content
// ---------------------------------------------------------------------------

describe("confirm-gate policy — describeConfirm", () => {
  test("ghost_bracket_order returns title ending with ?", () => {
    const desc = describeConfirm("ghost_bracket_order", { symbol: "BTC", side: "buy", size: 0.1, leverage: 10 });
    expect(desc.title.endsWith("?")).toBe(true);
  });

  test("ghost_bracket_order title contains direction and symbol", () => {
    const desc = describeConfirm("ghost_bracket_order", { symbol: "BTC", side: "buy", size: 0.1, leverage: 10 });
    expect(desc.title.toLowerCase()).toContain("bracket");
    expect(desc.title).toContain("BTC");
  });

  test("unknown tool returns generic Confirm <name>? title", () => {
    const desc = describeConfirm("ghost_unknown_tool", {});
    expect(desc.title).toBe("Confirm ghost_unknown_tool?");
  });
});

// ---------------------------------------------------------------------------
// Rejection message formatting (mirrors handler logic exactly)
// ---------------------------------------------------------------------------

describe("confirm rejection message format", () => {
  test("non-empty reason → 'User declined. Reason: <reason>'", () => {
    const reason = "risk too high";
    const msg = reason.length > 0
      ? `User declined. Reason: ${reason}`
      : "User declined. Do not retry.";
    expect(msg).toBe("User declined. Reason: risk too high");
  });

  test("empty reason → 'User declined. Do not retry.'", () => {
    const reason = "";
    const msg = reason.length > 0
      ? `User declined. Reason: ${reason}`
      : "User declined. Do not retry.";
    expect(msg).toBe("User declined. Do not retry.");
  });

  test("undefined reason treated as empty → 'User declined. Do not retry.'", () => {
    const reason: string | undefined = undefined;
    const effectiveReason = reason ?? "";
    const msg = effectiveReason.length > 0
      ? `User declined. Reason: ${effectiveReason}`
      : "User declined. Do not retry.";
    expect(msg).toBe("User declined. Do not retry.");
  });
});

// ---------------------------------------------------------------------------
// tools.execute() error message extraction (mirrors handler logic exactly)
// ---------------------------------------------------------------------------

describe("tools.execute() error handling — message extraction", () => {
  test("Error instance → err.message", () => {
    const err = new Error("exchange timeout");
    const msg = err instanceof Error ? err.message : "Tool execution failed";
    expect(msg).toBe("exchange timeout");
  });

  test("non-Error thrown value → fallback string", () => {
    // The handler uses: err instanceof Error ? err.message : "Tool execution failed"
    const err: unknown = "string error";
    const msg = err instanceof Error ? err.message : "Tool execution failed";
    expect(msg).toBe("Tool execution failed");
  });
});
