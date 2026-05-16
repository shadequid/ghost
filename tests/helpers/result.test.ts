import { describe, test, expect } from "bun:test";
import { ok, err, textResult, errorResult, getErrorMessage } from "../../src/helpers/result.js";

describe("ok", () => {
  test("creates success result", () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  test("works with objects", () => {
    const result = ok({ name: "test" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.name).toBe("test");
  });
});

describe("err", () => {
  test("creates error result", () => {
    const result = err("something failed");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("something failed");
  });
});

describe("textResult", () => {
  test("returns agent tool result with text content", () => {
    const result = textResult("hello");
    expect(result.content).toHaveLength(1);
    const block = result.content[0];
    expect(block.type).toBe("text");
    if (block.type === "text") expect(block.text).toBe("hello");
    expect(result.details).toEqual({});
  });
});

describe("errorResult", () => {
  test("prefixes with Error:", () => {
    const result = errorResult("not found");
    const block = result.content[0];
    expect(block.type).toBe("text");
    if (block.type === "text") expect(block.text).toBe("Error: not found");
  });
});

describe("getErrorMessage", () => {
  test("extracts Error message", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  test("converts string to string", () => {
    expect(getErrorMessage("raw string")).toBe("raw string");
  });

  test("converts number to string", () => {
    expect(getErrorMessage(404)).toBe("404");
  });

  test("converts null to string", () => {
    expect(getErrorMessage(null)).toBe("null");
  });

  test("converts undefined to string", () => {
    expect(getErrorMessage(undefined)).toBe("undefined");
  });
});
