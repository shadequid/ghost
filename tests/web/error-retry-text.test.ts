/**
 * Tests for `errorRetryText` — given a messages array and the index of an
 * error bubble, return the most-recent preceding user message's content
 * (or undefined if none). Used by `AgentChat.tsx` to wire an inline
 * `↻ Retry` link inside the error bubble itself.
 */

import { describe, test, expect } from "bun:test";
import type { ChatMessage } from "../../web/src/lib/chatTypes.js";
import { errorRetryText } from "../../web/src/lib/error-retry-text.js";

function mkUser(id: string, content: string): ChatMessage {
  return {
    id,
    role: "user",
    content,
    timestamp: new Date(),
  };
}

function mkAssistant(id: string, content: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: new Date(),
  };
}

function mkError(id: string, content: string): ChatMessage {
  return {
    id,
    role: "assistant",
    content,
    timestamp: new Date(),
    type: "error",
  };
}

describe("errorRetryText", () => {
  test("finds the immediate preceding user message", () => {
    const messages: ChatMessage[] = [
      mkUser("u1", "hello"),
      mkError("e1", "boom"),
    ];
    expect(errorRetryText(messages, 1)).toBe("hello");
  });

  test("walks past assistant messages to reach the user message", () => {
    const messages: ChatMessage[] = [
      mkUser("u1", "explain X"),
      mkAssistant("a1", "X is..."),
      mkUser("u2", "now do Y"),
      mkAssistant("a2", "doing Y..."),
      mkError("e1", "boom"),
    ];
    expect(errorRetryText(messages, 4)).toBe("now do Y");
  });

  test("returns undefined when no preceding user message exists", () => {
    const messages: ChatMessage[] = [mkError("e1", "boom")];
    expect(errorRetryText(messages, 0)).toBeUndefined();
  });

  test("returns undefined for a non-error index", () => {
    const messages: ChatMessage[] = [mkUser("u1", "hi"), mkAssistant("a1", "yo")];
    expect(errorRetryText(messages, 1)).toBeUndefined();
  });

  test("handles index out of range gracefully", () => {
    const messages: ChatMessage[] = [mkUser("u1", "hi"), mkError("e1", "boom")];
    expect(errorRetryText(messages, 99)).toBeUndefined();
    expect(errorRetryText(messages, -1)).toBeUndefined();
  });

  test("ignores other error bubbles when searching backwards", () => {
    const messages: ChatMessage[] = [
      mkUser("u1", "first ask"),
      mkError("e1", "first boom"),
      mkError("e2", "second boom"),
    ];
    expect(errorRetryText(messages, 2)).toBe("first ask");
  });
});
