import { describe, test, expect, beforeEach } from "bun:test";
import { Type } from "@mariozechner/pi-ai";
import type { TSchema } from "@mariozechner/pi-ai";
import { ToolRegistry } from "../../src/tools/registry.js";
import { NOOP_LOGGER } from "../../src/logger.js";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

function makeTool(name: string, description = "A test tool"): AgentTool<TSchema> {
  return {
    name,
    label: name,
    description,
    parameters: Type.Object({ value: Type.String() }) as TSchema,
    execute: async (): Promise<AgentToolResult<Record<never, never>>> => ({
      content: [{ type: "text", text: "ok" }],
      details: {},
    }),
  };
}

function makeFailingTool(name: string): AgentTool<TSchema> {
  return {
    name,
    label: name,
    description: "fails",
    parameters: Type.Object({}) as TSchema,
    execute: async () => { throw new Error("tool broke"); },
  };
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry(NOOP_LOGGER);
  });

  test("register and get a tool", () => {
    const tool = makeTool("echo");
    registry.register(tool);
    expect(registry.get("echo")).toBe(tool);
  });

  test("get returns undefined for unknown tool", () => {
    expect(registry.get("unknown")).toBeUndefined();
  });

  test("all returns all registered tools", () => {
    registry.register(makeTool("a"));
    registry.register(makeTool("b"));
    expect(registry.all()).toHaveLength(2);
  });

  test("names returns all tool names", () => {
    registry.register(makeTool("foo"));
    registry.register(makeTool("bar"));
    expect(registry.names()).toContain("foo");
    expect(registry.names()).toContain("bar");
  });

  test("has returns true for registered tools", () => {
    registry.register(makeTool("test"));
    expect(registry.has("test")).toBe(true);
    expect(registry.has("missing")).toBe(false);
  });

  test("unregister removes a tool", () => {
    registry.register(makeTool("temp"));
    expect(registry.has("temp")).toBe(true);
    registry.unregister("temp");
    expect(registry.has("temp")).toBe(false);
    expect(registry.get("temp")).toBeUndefined();
  });

  test("unregister is no-op for unknown tool", () => {
    expect(() => registry.unregister("ghost")).not.toThrow();
  });

  test("execute calls tool and returns result", async () => {
    registry.register(makeTool("echo"));
    const result = await registry.execute("echo", "call-1", { value: "hi" });
    expect(result.content[0]).toEqual({ type: "text", text: "ok" });
  });

  test("execute returns error result for unknown tool", async () => {
    const result = await registry.execute("missing", "call-1", {});
    expect(result.content[0]).toHaveProperty("type", "text");
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("not found");
  });

  test("execute wraps tool errors with retry hint", async () => {
    registry.register(makeFailingTool("bad"));
    const result = await registry.execute("bad", "call-1", {});
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("tool broke");
    expect(text).toContain("try a different approach");
  });

  test("execute truncates results exceeding 16000 chars", async () => {
    const longTool: AgentTool<TSchema> = {
      name: "long",
      label: "long",
      description: "returns long text",
      parameters: Type.Object({}) as TSchema,
      execute: async () => ({
        content: [{ type: "text" as const, text: "x".repeat(20_000) }],
        details: {},
      }),
    };
    registry.register(longTool);
    const result = await registry.execute("long", "call-1", {});
    const text = (result.content[0] as { text: string }).text;
    expect(text.length).toBeLessThanOrEqual(16_100);
    expect(text).toContain("truncated");
  });

  // ---------------------------------------------------------------------------
  // taskAgentTools allowlist — guards the BUG-0163 regression. The background
  // Runner must never see exec / write_file / edit_file or write trading
  // tools, even when those are registered on the same shared registry that
  // the orchestrator uses.
  // ---------------------------------------------------------------------------

  describe("taskAgentTools allowlist (BUG-0163)", () => {
    test("excludes write/exec generic tools that are registered", () => {
      registry.register(makeTool("read_file"));
      registry.register(makeTool("list_dir"));
      registry.register(makeTool("web_fetch"));
      registry.register(makeTool("web_search"));
      registry.register(makeTool("save_memory"));
      registry.register(makeTool("cron"));
      registry.register(makeTool("write_file"));
      registry.register(makeTool("edit_file"));
      registry.register(makeTool("exec"));

      const names = registry.taskAgentTools().map((t) => t.name).sort();

      expect(names).toEqual([
        "cron",
        "list_dir",
        "read_file",
        "save_memory",
        "web_fetch",
        "web_search",
      ]);
      expect(names).not.toContain("exec");
      expect(names).not.toContain("write_file");
      expect(names).not.toContain("edit_file");
    });

    test("excludes write trading tools, includes read trading tools", () => {
      // Reads
      registry.register(makeTool("ghost_get_positions"));
      registry.register(makeTool("ghost_get_balance"));
      registry.register(makeTool("ghost_get_price"));
      registry.register(makeTool("ghost_market_overview"));
      // Writes — must be filtered out
      registry.register(makeTool("ghost_place_order"));
      registry.register(makeTool("ghost_cancel_order"));
      registry.register(makeTool("ghost_set_sl_tp"));
      registry.register(makeTool("ghost_emergency_close"));
      registry.register(makeTool("ghost_watchlist_add"));
      registry.register(makeTool("ghost_alert_set"));

      const names = new Set(registry.taskAgentTools().map((t) => t.name));

      expect(names.has("ghost_get_positions")).toBe(true);
      expect(names.has("ghost_get_balance")).toBe(true);
      expect(names.has("ghost_get_price")).toBe(true);
      expect(names.has("ghost_market_overview")).toBe(true);

      expect(names.has("ghost_place_order")).toBe(false);
      expect(names.has("ghost_cancel_order")).toBe(false);
      expect(names.has("ghost_set_sl_tp")).toBe(false);
      expect(names.has("ghost_emergency_close")).toBe(false);
      expect(names.has("ghost_watchlist_add")).toBe(false);
      expect(names.has("ghost_alert_set")).toBe(false);
    });

    test("filter is name-based — unknown tools default to excluded", () => {
      registry.register(makeTool("totally_new_write_tool"));
      registry.register(makeTool("read_file"));

      const names = registry.taskAgentTools().map((t) => t.name);

      expect(names).toContain("read_file");
      expect(names).not.toContain("totally_new_write_tool");
    });
  });
});
