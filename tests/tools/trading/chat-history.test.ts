import { describe, test, expect } from "bun:test";
import type { Message, UserMessage, AssistantMessage } from "@mariozechner/pi-ai";
import { createChatHistoryTool } from "../../../src/tools/trading/chat-history.js";
import type { SessionManager } from "../../../src/session/manager.js";

// Minimal stubs — avoid importing Session/SessionManager to keep tests isolated

function userMsg(content: string, timestamp = Date.now()): UserMessage {
  return { role: "user", content, timestamp };
}

function assistantMsg(text: string, timestamp = Date.now()): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai" as never,
    provider: "openai" as never,
    model: "gpt-4",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp,
  };
}

/** Build a fake SessionManager that returns a stub session with controlled history. */
function makeSessionManager(messages: Message[]): SessionManager {
  return {
    getOrCreate: () => ({
      getHistory: () => messages,
    }),
  } as unknown as SessionManager;
}

/** Execute the tool and extract the text content from the result. */
async function runTool(
  messages: Message[],
  params: Record<string, unknown> = { messages: 100 },
): Promise<string> {
  const tool = createChatHistoryTool(makeSessionManager(messages));
  const result = await tool.execute("tool-call-1", params as never);
  const part = result.content[0] as { type: string; text: string };
  return part.text;
}

const NOW = Date.now();
const ONE_HOUR = 60 * 60 * 1000;

describe("ghost_chat_history tool", () => {
  test("empty session returns no-match message", async () => {
    const text = await runTool([]);
    expect(text).toBe("No matching messages in chat history.");
  });

  test("returns recent messages in chronological order", async () => {
    // 5 messages; tool with default params should return up to 30 — all 5 here
    const msgs: Message[] = [
      userMsg("msg1", NOW - 4 * ONE_HOUR),
      assistantMsg("reply1", NOW - 3 * ONE_HOUR),
      userMsg("msg2", NOW - 2 * ONE_HOUR),
      assistantMsg("reply2", NOW - ONE_HOUR),
      userMsg("msg3", NOW),
    ];
    const text = await runTool(msgs);
    // Chronological: msg1 should appear before msg3
    const idx1 = text.indexOf("msg1");
    const idx3 = text.indexOf("msg3");
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx3).toBeGreaterThanOrEqual(0);
    expect(idx1).toBeLessThan(idx3);
    // Separator present
    expect(text).toContain("---");
  });

  test("roleFilter: 'user' returns only user messages", async () => {
    const msgs: Message[] = [
      userMsg("user-only", NOW - ONE_HOUR),
      assistantMsg("assistant-only", NOW),
    ];
    const text = await runTool(msgs, { messages: 100, roleFilter: "user" });
    expect(text).toContain("user-only");
    expect(text).not.toContain("assistant-only");
  });

  test("symbolFilter drops messages without the symbol substring (case-insensitive)", async () => {
    const msgs: Message[] = [
      userMsg("I'm holding btc long", NOW - 2 * ONE_HOUR),
      userMsg("nothing about the other coin", NOW - ONE_HOUR),
      assistantMsg("BTC looks good", NOW),
    ];
    const text = await runTool(msgs, { messages: 100, symbolFilter: "BTC" });
    expect(text).toContain("btc long");
    expect(text).toContain("BTC looks good");
    expect(text).not.toContain("nothing about the other coin");
  });

  test("messages: 2 caps result at 2 most recent matching messages", async () => {
    const msgs: Message[] = [
      userMsg("old1", NOW - 4 * ONE_HOUR),
      userMsg("old2", NOW - 3 * ONE_HOUR),
      userMsg("old3", NOW - 2 * ONE_HOUR),
      userMsg("recent1", NOW - ONE_HOUR),
      userMsg("recent2", NOW),
    ];
    const text = await runTool(msgs, { messages: 2 });
    expect(text).toContain("recent1");
    expect(text).toContain("recent2");
    // older ones should not appear
    expect(text).not.toContain("old1");
    expect(text).not.toContain("old2");
    expect(text).not.toContain("old3");
  });

  test("long content is truncated to 500 chars with ellipsis suffix", async () => {
    const longText = "x".repeat(600);
    const msgs: Message[] = [userMsg(longText, NOW)];
    const text = await runTool(msgs);
    // The 500-char truncated content + "..." must appear; raw 600-char string must not
    expect(text).toContain("x".repeat(500) + "...");
    expect(text).not.toContain("x".repeat(501));
  });
});
