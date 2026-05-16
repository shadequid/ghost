/**
 * Unit tests for parseEvaluationOutput.
 *
 * Covers: clean JSON, model-quirk wrappers (think/thinking/reasoning/scratchpad
 * tags, code fences), malformed input, partial keys, and non-string elements.
 */

import { describe, test, expect } from "bun:test";
import { parseEvaluationOutput } from "../../../src/daemon/prompts/news-evaluation.js";

describe("parseEvaluationOutput", () => {
  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  test("parses a well-formed JSON array", () => {
    const raw = '["id-1","id-2","id-3"]';
    expect(parseEvaluationOutput(raw)).toEqual(["id-1", "id-2", "id-3"]);
  });

  test("parses a single-element array", () => {
    expect(parseEvaluationOutput('["abc"]')).toEqual(["abc"]);
  });

  test("parses an empty JSON array", () => {
    expect(parseEvaluationOutput("[]")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Model-quirk: reasoning / thinking tags (Qwen3, DeepSeek-R1)
  // -------------------------------------------------------------------------

  test("strips <think>…</think> block and parses the remaining array", () => {
    const raw = `<think>
I need to evaluate these articles carefully.
Crypto ones are id-1 and id-3.
</think>
["id-1","id-3"]`;
    expect(parseEvaluationOutput(raw)).toEqual(["id-1", "id-3"]);
  });

  test("strips <thinking>…</thinking> block", () => {
    const raw = `<thinking>Some internal monologue about relevance.</thinking>["id-2"]`;
    expect(parseEvaluationOutput(raw)).toEqual(["id-2"]);
  });

  test("strips <reasoning>…</reasoning> block", () => {
    const raw = `<reasoning>Reasoning here.</reasoning>\n["id-5","id-6"]`;
    expect(parseEvaluationOutput(raw)).toEqual(["id-5", "id-6"]);
  });

  test("strips <scratchpad>…</scratchpad> block", () => {
    const raw = `<scratchpad>notes</scratchpad>["id-7"]`;
    expect(parseEvaluationOutput(raw)).toEqual(["id-7"]);
  });

  // -------------------------------------------------------------------------
  // Model-quirk: markdown code fences
  // -------------------------------------------------------------------------

  test("strips ```json … ``` code fence", () => {
    const raw = "```json\n[\"id-a\",\"id-b\"]\n```";
    expect(parseEvaluationOutput(raw)).toEqual(["id-a", "id-b"]);
  });

  test("strips plain ``` … ``` code fence", () => {
    const raw = "```\n[\"id-c\"]\n```";
    expect(parseEvaluationOutput(raw)).toEqual(["id-c"]);
  });

  test("handles think block + code fence combined", () => {
    const raw = "<think>thinking</think>\n```json\n[\"x1\",\"x2\"]\n```";
    expect(parseEvaluationOutput(raw)).toEqual(["x1", "x2"]);
  });

  // -------------------------------------------------------------------------
  // Non-greedy: only first array matched when multiple arrays appear
  // -------------------------------------------------------------------------

  test("uses non-greedy match — returns only first JSON array in response", () => {
    const raw = '["id-1","id-2"] some text ["id-3","id-4"]';
    const result = parseEvaluationOutput(raw);
    // Must match first array only
    expect(result).toEqual(["id-1", "id-2"]);
    expect(result).not.toContain("id-3");
    expect(result).not.toContain("id-4");
  });

  // -------------------------------------------------------------------------
  // Malformed / empty input
  // -------------------------------------------------------------------------

  test("returns empty array for completely empty string", () => {
    expect(parseEvaluationOutput("")).toEqual([]);
  });

  test("returns empty array when there is no JSON array in the response", () => {
    expect(parseEvaluationOutput("The articles are relevant.")).toEqual([]);
  });

  test("returns empty array for malformed JSON", () => {
    expect(parseEvaluationOutput("[id-1, id-2]")).toEqual([]);
  });

  test("returns empty array for JSON object instead of array", () => {
    expect(parseEvaluationOutput('{"id": "id-1"}')).toEqual([]);
  });

  test("returns empty array for truncated JSON", () => {
    expect(parseEvaluationOutput('["id-1", "id-')).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Type filtering: non-string elements are excluded
  // -------------------------------------------------------------------------

  test("filters out non-string array elements, keeps strings", () => {
    // Raw JSON with mixed types — only strings should survive
    const raw = '["id-1", 42, null, true, "id-2", {"key": "val"}]';
    expect(parseEvaluationOutput(raw)).toEqual(["id-1", "id-2"]);
  });

  test("returns empty array when all elements are non-strings", () => {
    expect(parseEvaluationOutput("[1, 2, 3]")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Whitespace and surrounding text tolerance
  // -------------------------------------------------------------------------

  test("handles leading/trailing whitespace around the array", () => {
    expect(parseEvaluationOutput('  \n  ["id-x"]  \n  ')).toEqual(["id-x"]);
  });

  test("handles array embedded in natural language text", () => {
    const raw = 'Based on the criteria, the relevant articles are: ["id-1","id-3"]. Thank you.';
    expect(parseEvaluationOutput(raw)).toEqual(["id-1", "id-3"]);
  });
});
