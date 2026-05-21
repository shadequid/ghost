/**
 * Tests for extractAskBlocks — covers the current `<asks>` wrapper plus the
 * legacy `<ask_user_question>` form still emitted by older streams and some
 * LLM hallucinations.
 */

import { describe, test, expect } from "bun:test";
import { extractAskBlocks } from "../../web/src/lib/parseAskBlock.js";

describe("extractAskBlocks — current <asks> tag", () => {
  test("parses a single question block with options", () => {
    const input = [
      "<asks>",
      "  <question>",
      "    <title>Long or short?</title>",
      "    <options>",
      "      <option>long</option>",
      "      <option>short</option>",
      "    </options>",
      "  </question>",
      "</asks>",
    ].join("\n");
    const { stripped, blocks } = extractAskBlocks(input);
    expect(stripped).toBe("");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].questions).toEqual([
      { title: "Long or short?", options: ["long", "short"] },
    ]);
  });

  test("parses multiple questions and strips wrapper from content", () => {
    const input = "Lead-in prose.\n<asks><question><title>A?</title></question><question><title>B?</title></question></asks>\nTail.";
    const { stripped, blocks } = extractAskBlocks(input);
    expect(stripped).toBe("Lead-in prose.\n\nTail.");
    expect(blocks[0].questions).toEqual([
      { title: "A?" },
      { title: "B?" },
    ]);
  });
});

describe("extractAskBlocks — legacy <ask_user_question> tag", () => {
  test("parses the legacy wrapper identically to <asks>", () => {
    const input = [
      "<ask_user_question>",
      "  <question>",
      "    <title>Long or short?</title>",
      "    <options>",
      "      <option>long</option>",
      "      <option>short</option>",
      "    </options>",
      "  </question>",
      "</ask_user_question>",
    ].join("\n");
    const { stripped, blocks } = extractAskBlocks(input);
    expect(stripped).toBe("");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].questions).toEqual([
      { title: "Long or short?", options: ["long", "short"] },
    ]);
  });

  test("strips the legacy wrapper from surrounding prose", () => {
    const input = "Before.\n<ask_user_question><question><title>Size?</title></question></ask_user_question>\nAfter.";
    const { stripped, blocks } = extractAskBlocks(input);
    expect(stripped).toBe("Before.\n\nAfter.");
    expect(blocks[0].questions).toEqual([{ title: "Size?" }]);
  });

  test("supports both current and legacy blocks mixed in one stream", () => {
    const input = [
      "<asks><question><title>Q1?</title></question></asks>",
      "<ask_user_question><question><title>Q2?</title></question></ask_user_question>",
    ].join("\n");
    const { blocks } = extractAskBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].questions[0].title).toBe("Q1?");
    expect(blocks[1].questions[0].title).toBe("Q2?");
  });
});

describe("extractAskBlocks — symmetric tag matching", () => {
  test("rejects mismatched open/close tags (backref \\1)", () => {
    const input = "<asks><question><title>X?</title></question></ask_user_question>";
    const { stripped, blocks } = extractAskBlocks(input);
    expect(blocks).toHaveLength(0);
    expect(stripped).toContain("X?");
  });
});
