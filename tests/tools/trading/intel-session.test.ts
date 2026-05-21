import { describe, test, expect } from "bun:test";
import { createSessionInfoTool } from "../../../src/tools/trading/intel-session";
import { Session } from "../../../src/session/session";
import type { UserMessage, AssistantMessage, TextContent } from "@earendil-works/pi-ai";

function makeSessionManager(session: Session) {
  return { getOrCreate: () => session } as any;
}

function userMsg(content: string, ts: number = Date.now()): UserMessage {
  return { role: "user", content, timestamp: ts };
}

function assistantMsg(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text } as TextContent],
    api: "openai" as never,
    provider: "openai" as never,
    model: "gpt-4",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("ghost_session_info reads lastActiveAt (user messages only)", () => {
  test("hoursSinceLastActive reflects time since last user message", async () => {
    const twoHoursAgo = Date.now() - 7_200_000;
    const session = new Session({ key: "main" });
    // Seed a user message 2 hours ago
    session.addMessage(userMsg("hello", twoHoursAgo));
    // Manually adjust lastActiveAt to match the ts we passed (since addMessage uses new Date())
    (session as any).lastActiveAt = new Date(twoHoursAgo);

    const tool = createSessionInfoTool(makeSessionManager(session));
    const out = await (tool as any).execute({});
    const parsed = JSON.parse(out.content[0].text);

    expect(parsed.hoursSinceLastActive).toBeGreaterThanOrEqual(2);
  });

  test("hoursSinceLastActive is null when no user message has been added", async () => {
    const session = new Session({ key: "main" });
    // Only add an assistant message — should NOT update lastActiveAt
    session.addMessage(assistantMsg("hello from agent"));

    const tool = createSessionInfoTool(makeSessionManager(session));
    const out = await (tool as any).execute({});
    const parsed = JSON.parse(out.content[0].text);

    expect(parsed.hoursSinceLastActive).toBeNull();
  });

  test("hoursSinceLastActive is 0 for a just-created session with a user message", async () => {
    const session = new Session({ key: "main" });
    session.addMessage(userMsg("hi"));

    const tool = createSessionInfoTool(makeSessionManager(session));
    const out = await (tool as any).execute({});
    const parsed = JSON.parse(out.content[0].text);

    // Just added a user message → effectively 0 hours
    expect(parsed.hoursSinceLastActive).toBe(0);
  });

  test("assistant messages do NOT update hoursSinceLastActive", async () => {
    const twoHoursAgo = Date.now() - 7_200_000;
    const session = new Session({ key: "main", lastActiveAt: new Date(twoHoursAgo) });
    // Add only assistant messages after the initial user active time
    session.addMessage(assistantMsg("background cron delivery"));
    session.addMessage(assistantMsg("another background message"));

    const tool = createSessionInfoTool(makeSessionManager(session));
    const out = await (tool as any).execute({});
    const parsed = JSON.parse(out.content[0].text);

    // lastActiveAt still reflects 2h ago, not the recent assistant messages
    expect(parsed.hoursSinceLastActive).toBeGreaterThanOrEqual(2);
  });

  test("messageCount reflects total messages in session", async () => {
    const session = new Session({ key: "main" });
    session.addMessage(userMsg("one"));
    session.addMessage(assistantMsg("two"));
    session.addMessage(userMsg("three"));

    const tool = createSessionInfoTool(makeSessionManager(session));
    const out = await (tool as any).execute({});
    const parsed = JSON.parse(out.content[0].text);

    expect(parsed.messageCount).toBe(3);
  });
});
