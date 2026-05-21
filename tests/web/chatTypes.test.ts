/**
 * Tests for cleanDisplayText — verifies tool-leak stripping. Chart-tag
 * handling lives in the StreamingMarkdown component, not here.
 */

import { describe, test, expect } from "bun:test";
import { cleanDisplayText } from "../../web/src/lib/chatTypes.js";

describe("cleanDisplayText — tool-leak strips", () => {
  test("removes <tool_call> blocks", () => {
    const input = "Reading price <tool_call>{\"name\":\"ghost_get_price\"}</tool_call> done";
    expect(cleanDisplayText(input)).toBe("Reading price  done");
  });

  test("removes <tool_use> and <tool_result> blocks", () => {
    const input = "<tool_use>x</tool_use>hello<tool_result>y</tool_result>";
    expect(cleanDisplayText(input)).toBe("hello");
  });

  test("strips bracketed ghost_* tool announcements", () => {
    expect(cleanDisplayText("Placing [ghost_bracket_order symbol=BTC] now")).toBe(
      "Placing  now",
    );
    expect(cleanDisplayText("Placing [mcp__ghost__ghost_bracket_order] now")).toBe(
      "Placing  now",
    );
  });

  test("strips orphaned/partial tool tags", () => {
    expect(cleanDisplayText("<tool_call partial>leftover")).toBe("leftover");
  });

  test("leaves normal prose unchanged", () => {
    expect(cleanDisplayText("BTC looks bullish above $74k")).toBe(
      "BTC looks bullish above $74k",
    );
  });

  test("preserves <chart> tag for downstream rendering", () => {
    // The StreamingMarkdown component renders <chart> as an inline ChartWidget.
    // cleanDisplayText must not strip it — empty-bubble case is avoided because
    // <chart> now produces visible content in the bubble.
    const input = '<chart symbol="BTC" interval="4h" />';
    expect(cleanDisplayText(input)).toBe('<chart symbol="BTC" interval="4h" />');
  });

  test("preserves <chart> tag alongside tool-leak stripping", () => {
    const input =
      '<tool_call>fetching</tool_call>BTC bullish <chart symbol="BTC" />';
    expect(cleanDisplayText(input)).toBe('BTC bullish <chart symbol="BTC" />');
  });
});

describe("cleanDisplayText — legacy ask wrapper rename", () => {
  test("rewrites <ask_user_question> open/close to <asks>", () => {
    const input = "<ask_user_question><question><title>Long or short?</title></question></ask_user_question>";
    expect(cleanDisplayText(input)).toBe(
      "<asks><question><title>Long or short?</title></question></asks>",
    );
  });

  test("preserves attributes on the legacy wrapper", () => {
    const input = '<ask_user_question id="x"><question><title>Q?</title></question></ask_user_question>';
    expect(cleanDisplayText(input)).toBe(
      '<asks id="x"><question><title>Q?</title></question></asks>',
    );
  });

  test("leaves the canonical <asks> tag untouched", () => {
    const input = "<asks><question><title>Size?</title></question></asks>";
    expect(cleanDisplayText(input)).toBe(input);
  });

  test("handles legacy wrapper alongside surrounding prose", () => {
    const input = "Lead-in.\n<ask_user_question><question><title>Q?</title></question></ask_user_question>";
    expect(cleanDisplayText(input)).toBe(
      "Lead-in.\n<asks><question><title>Q?</title></question></asks>",
    );
  });

  test("does not rewrite unpaired legacy tags (symmetric match)", () => {
    const input = "stray <ask_user_question> open with no close";
    expect(cleanDisplayText(input)).toBe(input);
  });
});
