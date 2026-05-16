import { describe, test, expect } from "bun:test";
import { shouldHandoff, formatHandoffPrompt, extractUserPrompt } from "../../../src/providers/claude-cli/handoff.js";

describe("shouldHandoff", () => {
  test("returns true when handoff is null (no knowledge of CLI state)", () => {
    expect(shouldHandoff(null, "hash1", 1)).toBe(true);
    expect(shouldHandoff(null, "hash1", 5)).toBe(true);
    expect(shouldHandoff(null, "hash1", 0)).toBe(true);
  });

  test("returns false when hash matches and count >=", () => {
    const handoff = { systemPromptHash: "abc", syncedCount: 5 };
    expect(shouldHandoff(handoff, "abc", 7)).toBe(false);
  });

  test("returns true when system prompt hash changed", () => {
    const handoff = { systemPromptHash: "old", syncedCount: 5 };
    expect(shouldHandoff(handoff, "new", 7)).toBe(true);
  });

  test("returns true when context shrunk (consolidation)", () => {
    const handoff = { systemPromptHash: "abc", syncedCount: 10 };
    expect(shouldHandoff(handoff, "abc", 5)).toBe(true);
  });

  test("returns false when count equals syncedCount (no new messages yet)", () => {
    const handoff = { systemPromptHash: "abc", syncedCount: 5 };
    expect(shouldHandoff(handoff, "abc", 5)).toBe(false);
  });
});

describe("formatHandoffPrompt", () => {
  test("returns user prompt when no history", () => {
    const messages = [{ role: "user", content: "hello" }];
    expect(formatHandoffPrompt(messages)).toBe("hello");
  });

  test("formats history with session_context tags", () => {
    const messages = [
      { role: "user", content: "first question" },
      { role: "assistant", content: [{ type: "text", text: "first answer" }] },
      { role: "user", content: "second question" },
    ];
    const result = formatHandoffPrompt(messages);
    expect(result).toContain("<session_context>");
    expect(result).toContain("[User]\nfirst question");
    expect(result).toContain("[Ghost]\nfirst answer");
    expect(result).toContain("</session_context>");
    expect(result).toEndWith("second question");
  });

  test("skips tool_use and tool_result content blocks", () => {
    const messages = [
      { role: "user", content: "check balance" },
      { role: "assistant", content: [{ type: "toolCall", id: "1", name: "ghost_get_balance", arguments: {} }] },
      { role: "toolResult", content: [{ type: "text", text: "$1000" }] },
      { role: "assistant", content: [{ type: "text", text: "Your balance is $1000" }] },
      { role: "user", content: "thanks" },
    ];
    const result = formatHandoffPrompt(messages);
    expect(result).toContain("[User]\ncheck balance");
    expect(result).toContain("[Ghost]\nYour balance is $1000");
    expect(result).not.toContain("ghost_get_balance");
    expect(result).not.toContain("toolResult");
    // Verify raw tool output content is excluded (only the assistant summary should appear)
    const beforeContext = result.split("</session_context>")[0];
    expect(beforeContext.match(/\$1000/g)?.length).toBe(1); // only in assistant summary, not tool result
    expect(result).toEndWith("thanks");
  });

  test("skips messages with no text content", () => {
    const messages = [
      { role: "user", content: "do something" },
      { role: "assistant", content: [{ type: "toolCall", id: "1", name: "tool", arguments: {} }] },
      { role: "user", content: "what happened" },
    ];
    const result = formatHandoffPrompt(messages);
    expect(result).toContain("[User]\ndo something");
    expect(result).not.toContain("[Ghost]");
    expect(result).toEndWith("what happened");
  });

  test("handles string content in assistant messages", () => {
    const messages = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello back" },
      { role: "user", content: "bye" },
    ];
    const result = formatHandoffPrompt(messages);
    expect(result).toContain("[Ghost]\nhello back");
  });
});

describe("extractUserPrompt", () => {
  test("extracts string content from last user message", () => {
    const messages = [
      { role: "user", content: "first" },
      { role: "assistant", content: "response" },
      { role: "user", content: "second" },
    ];
    expect(extractUserPrompt(messages)).toBe("second");
  });

  test("extracts text from content block array", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] },
    ];
    expect(extractUserPrompt(messages)).toBe("hello\nworld");
  });

  test("returns empty string when no user messages", () => {
    const messages = [
      { role: "assistant", content: "solo response" },
    ];
    expect(extractUserPrompt(messages)).toBe("");
  });

  test("returns empty string for empty array", () => {
    expect(extractUserPrompt([])).toBe("");
  });

  test("skips non-text content blocks", () => {
    const messages = [
      { role: "user", content: [{ type: "image", mimeType: "image/png" }, { type: "text", text: "describe this" }] },
    ];
    expect(extractUserPrompt(messages)).toBe("describe this");
  });
});
