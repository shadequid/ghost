import { describe, test, expect } from "bun:test";
import { parseLlmJsonObject, parseLlmJsonArray } from "../../src/helpers/parse-llm-json.js";

describe("parseLlmJsonObject", () => {
  test("parses pure JSON object directly", () => {
    expect(parseLlmJsonObject('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  test("parses pure JSON object with surrounding whitespace", () => {
    expect(parseLlmJsonObject('  \n{"a":1}\n  ')).toEqual({ a: 1 });
  });

  test("recovers from <think> reasoning tag wrapping", () => {
    const wrapped = '<think>Let me think...</think>{"x":42}';
    expect(parseLlmJsonObject(wrapped)).toEqual({ x: 42 });
  });

  test("recovers from <thinking> tag (DeepSeek-R1)", () => {
    expect(parseLlmJsonObject('<thinking>...</thinking>\n{"y":1}')).toEqual({ y: 1 });
  });

  test("recovers from markdown ```json fences", () => {
    expect(parseLlmJsonObject('```json\n{"k":"v"}\n```')).toEqual({ k: "v" });
  });

  test("recovers from prose surrounding the JSON", () => {
    expect(parseLlmJsonObject('Here is my answer:\n{"ok":true}\nHope this helps.')).toEqual({ ok: true });
  });

  test("returns undefined for empty input", () => {
    expect(parseLlmJsonObject("")).toBeUndefined();
    expect(parseLlmJsonObject("   ")).toBeUndefined();
  });

  test("returns undefined when no JSON object exists", () => {
    expect(parseLlmJsonObject("just prose, no braces here")).toBeUndefined();
  });

  test("returns undefined for malformed JSON", () => {
    expect(parseLlmJsonObject("{not valid json}")).toBeUndefined();
  });

  test("prose before JSON — non-greedy match picks the real envelope", () => {
    // LLM emits "{action} then here is the answer: {decision: fire}" — the
    // greedy span would merge both braces and fail. Non-greedy gets the first
    // valid object which in this case is the real one.
    expect(parseLlmJsonObject('Here is {my} answer: {"ok":true}')).toEqual({ ok: true });
  });

  test("JSON inside prose text — extracts embedded object", () => {
    const input = 'Sure! Here you go: {"decision":"fire","body":"text"} — done.';
    const result = parseLlmJsonObject(input) as Record<string, unknown>;
    expect(result).not.toBeUndefined();
    expect(result.decision).toBe("fire");
  });

  test("multiple JSON-like blocks — returns first valid parse", () => {
    // Non-greedy picks {"a":1} first; greedy fallback never needed here.
    expect(parseLlmJsonObject('{"a":1} then {"b":2}')).toEqual({ a: 1 });
  });

  test("deeply nested object — greedy fallback handles it when non-greedy closes too early", () => {
    const nested = '{"outer":{"inner":{"value":42}}}';
    expect(parseLlmJsonObject(nested)).toEqual({ outer: { inner: { value: 42 } } });
  });
});

describe("parseLlmJsonArray", () => {
  test("parses pure JSON array directly", () => {
    expect(parseLlmJsonArray('["a","b","c"]')).toEqual(["a", "b", "c"]);
  });

  test("recovers from reasoning tag wrapping", () => {
    expect(parseLlmJsonArray('<think>...</think>\n["x","y"]')).toEqual(["x", "y"]);
  });

  test("recovers from markdown fences", () => {
    expect(parseLlmJsonArray('```json\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });

  test("returns undefined when input is an object, not array", () => {
    expect(parseLlmJsonArray('{"a":1}')).toBeUndefined();
  });

  test("non-greedy match avoids spanning multiple arrays", () => {
    // `["a"] prose ["b"]` would fail JSON.parse if greedy.
    // Non-greedy picks `["a"]` as the first valid match.
    expect(parseLlmJsonArray('["a"] some prose ["b"]')).toEqual(["a"]);
  });

  test("returns undefined when no array exists", () => {
    expect(parseLlmJsonArray("just prose")).toBeUndefined();
  });

  test("returns undefined for empty input", () => {
    expect(parseLlmJsonArray("")).toBeUndefined();
  });
});
