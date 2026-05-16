/**
 * Tests for ThinkingIndicator — TOOL_FRIENDLY_NAMES, formatLabel, inline style,
 * and config default for showToolCalls.
 *
 * Part of QA for bugfix/thinking-and-tools-display.
 */

import { describe, test, expect } from "bun:test";
import {
  TOOL_FRIENDLY_NAMES,
  formatLabel,
  wrapperStyle,
} from "../../web/src/components/chat/thinking-utils.js";
import { configSchema } from "../../src/config/schema.js";

// ---------------------------------------------------------------------------
// TOOL_FRIENDLY_NAMES completeness
// ---------------------------------------------------------------------------

describe("TOOL_FRIENDLY_NAMES", () => {
  const EXPECTED_TOOLS = [
    "get_price",
    "get_positions",
    "get_balance",
    "get_orders",
    "market_overview",
    "get_funding_rates",
    "get_indicators",
    "get_levels",
    "get_news",
    "get_trades",
    "place_order",
    "cancel_order",
    "close_position",
    "set_leverage",
    "set_sl_tp",
  ];

  test("maps all expected tool names", () => {
    for (const tool of EXPECTED_TOOLS) {
      expect(TOOL_FRIENDLY_NAMES[tool]).toBeDefined();
      expect(typeof TOOL_FRIENDLY_NAMES[tool]).toBe("string");
      expect(TOOL_FRIENDLY_NAMES[tool]!.length).toBeGreaterThan(0);
    }
  });

  test("has exactly the expected number of entries", () => {
    expect(Object.keys(TOOL_FRIENDLY_NAMES).length).toBe(EXPECTED_TOOLS.length);
  });

  test("every value is a non-empty string", () => {
    for (const value of Object.values(TOOL_FRIENDLY_NAMES)) {
      expect(typeof value).toBe("string");
      expect((value as string).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// formatLabel
// ---------------------------------------------------------------------------

describe("formatLabel", () => {
  test("returns friendly text for known tool in fetching phase", () => {
    const result = formatLabel("fetching", "get_price");
    expect(result).toContain("price");
    expect(result).not.toContain("get_price");
  });

  test("falls back to raw detail for unknown tool in fetching phase", () => {
    const result = formatLabel("fetching", "some_custom_tool");
    expect(result).toContain("some_custom_tool");
  });

  test("returns base label when phase is fetching but no detail", () => {
    const result = formatLabel("fetching");
    // Should return PHASE_LABELS.fetching without detail suffix
    expect(result).toBe("Fetching data");
  });

  test("returns base label for thinking phase (ignores detail)", () => {
    const result = formatLabel("thinking", "get_price");
    expect(result).toBe("Thinking");
  });

  test("returns base label for analyzing phase", () => {
    const result = formatLabel("analyzing");
    expect(result).toBe("Analyzing");
  });

  test("fetching with detail produces expected format", () => {
    const result = formatLabel("fetching", "get_balance");
    expect(result).toBe("Fetching data balance");
  });
});

// ---------------------------------------------------------------------------
// ThinkingIndicator renders inline (wrapperStyle checks)
// ---------------------------------------------------------------------------

describe("ThinkingIndicator inline rendering", () => {
  test("wrapperStyle uses inline-flex display", () => {
    expect(wrapperStyle.display).toBe("inline-flex");
  });

  test("wrapperStyle prevents text wrapping", () => {
    expect(wrapperStyle.whiteSpace).toBe("nowrap");
  });

  test("wrapperStyle has expected font family", () => {
    expect(wrapperStyle.fontFamily).toContain("JetBrains Mono");
  });

  test("wrapperStyle aligns items center", () => {
    expect(wrapperStyle.alignItems).toBe("center");
  });
});

// ---------------------------------------------------------------------------
// Config schema: showToolCalls derived from verbosity
// ---------------------------------------------------------------------------

describe("showToolCalls via verbosity", () => {
  test("verbosity defaults to 0 (showToolCalls off)", () => {
    const config = configSchema.parse({});
    expect(config.verbosity).toBe(0);
  });

  test("verbosity > 0 enables showToolCalls", () => {
    const config = configSchema.parse({ verbosity: 1 });
    expect(config.verbosity > 0).toBe(true);
  });
});
