import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import {
  MemoryConsolidator,
  estimateTokens,
  formatMessagesForConsolidation,
} from "../../src/memory/consolidator.js";
import { MemoryStore } from "../../src/memory/store.js";
import { Session } from "../../src/session/session.js";
import type { UserMessage, AssistantMessage, ToolCall, TextContent } from "@mariozechner/pi-ai";
import type { Runner } from "../../src/agent/runner.js";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let workspace: string;
let store: MemoryStore;

function userMsg(content: string): UserMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function assistantMsg(text: string, toolCalls: ToolCall[] = []): AssistantMessage {
  const content: (TextContent | ToolCall)[] = [{ type: "text", text }];
  content.push(...toolCalls);
  return {
    role: "assistant",
    content,
    api: "openai" as never,
    provider: "openai" as never,
    model: "gpt-4",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function makeRunner(responseText = ""): Runner {
  return { call: mock(async () => responseText) } as unknown as Runner;
}

beforeEach(() => {
  workspace = join(tmpdir(), `ghost-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workspace, { recursive: true });
  store = new MemoryStore(workspace);
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("estimateTokens()", () => {
  test("uses tiktoken cl100k_base encoding", () => {
    // tiktoken produces accurate token counts, not char/4 approximations
    expect(estimateTokens("hello")).toBeGreaterThan(0);
    expect(estimateTokens("")).toBe(0);
    // "hello world" is 2 tokens in cl100k_base
    expect(estimateTokens("hello world")).toBe(2);
  });
});

describe("formatMessagesForConsolidation()", () => {
  test("formats user messages", () => {
    const result = formatMessagesForConsolidation([userMsg("hello world")]);
    expect(result).toContain("USER: hello world");
  });

  test("formats assistant messages with tools", () => {
    const tc: ToolCall = { type: "toolCall", id: "tc1", name: "shell", arguments: {} };
    const result = formatMessagesForConsolidation([assistantMsg("running", [tc])]);
    expect(result).toContain("ASSISTANT");
    expect(result).toContain("[tools: shell]");
    expect(result).toContain("running");
  });

  test("truncates long tool results", () => {
    const longResult = {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "shell",
      content: [{ type: "text", text: "x".repeat(1000) }],
      isError: false,
      timestamp: Date.now(),
    };
    const result = formatMessagesForConsolidation([longResult]);
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(1000);
  });
});

describe("MemoryConsolidator", () => {
  describe("pickConsolidationBoundary (via maybeConsolidate)", () => {
    test("does nothing when within budget", async () => {
      const runner = makeRunner();
      const consolidator = new MemoryConsolidator({
        store,
        runner,
        contextWindowTokens: 100_000,
        maxCompletionTokens: 4096,
      });

      const session = new Session({ key: "test" });
      session.addMessage(userMsg("hello"));
      session.addMessage(assistantMsg("hi"));

      await consolidator.maybeConsolidate(session, "", []);
      expect(session.lastConsolidated).toBe(0);
      // runner not called when within budget
      expect((runner.call as ReturnType<typeof mock>)).not.toHaveBeenCalled();
    });
  });

  describe("consolidateChunk via runner", () => {
    test("calls runner.call with consolidation systemPrompt", async () => {
      const runner = makeRunner();
      const consolidator = new MemoryConsolidator({
        store,
        runner,
        contextWindowTokens: 4000,
        maxCompletionTokens: 100,
        maxConsolidationRounds: 1,
      });

      const session = new Session({ key: "test" });
      for (let i = 0; i < 50; i++) {
        session.addMessage(userMsg(`message ${i} with some longer content to take up tokens`));
        session.addMessage(assistantMsg(`response ${i} with some longer content too`));
      }

      await consolidator.maybeConsolidate(session, "", []);

      expect((runner.call as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
      const callArg = (runner.call as ReturnType<typeof mock>).mock.calls[0][0] as {
        systemPrompt: string;
        message: string;
      };
      expect(callArg.systemPrompt).toContain("save_memory");
      expect(callArg.message).toContain("MEMORY.md");
    });

    test("advances session.lastConsolidated after consolidation when LLM writes memory", async () => {
      // Simulate LLM calling save_memory by writing to the store.
      const savingRunner = {
        call: mock(async () => {
          await store.writeLongTerm("# Facts\n- test memory");
          return "";
        }),
      } as unknown as Runner;
      const consolidator = new MemoryConsolidator({
        store,
        runner: savingRunner,
        contextWindowTokens: 4000,
        maxCompletionTokens: 100,
        maxConsolidationRounds: 1,
      });

      const session = new Session({ key: "test" });
      for (let i = 0; i < 50; i++) {
        session.addMessage(userMsg(`message ${i} with some longer content to take up tokens`));
        session.addMessage(assistantMsg(`response ${i} with some longer content too`));
      }

      expect(session.lastConsolidated).toBe(0);
      await consolidator.maybeConsolidate(session, "", []);
      expect(session.lastConsolidated).toBeGreaterThan(0);
    });

    test("archiveMessages delegates to runner.call", async () => {
      const runner = makeRunner();
      const consolidator = new MemoryConsolidator({ store, runner });

      const chunk = [userMsg("hello"), assistantMsg("hi")];
      await consolidator.archiveMessages(chunk);

      expect((runner.call as ReturnType<typeof mock>)).toHaveBeenCalledTimes(1);
    });
  });

  describe("lastConsolidated gated on save_memory", () => {
    test("does NOT advance lastConsolidated when LLM does not call save_memory", async () => {
      // Runner returns empty string — no save_memory called, store unchanged.
      const runner = makeRunner("");
      const consolidator = new MemoryConsolidator({
        store,
        runner,
        contextWindowTokens: 4000,
        maxCompletionTokens: 100,
        maxConsolidationRounds: 1,
      });

      const session = new Session({ key: "test" });
      for (let i = 0; i < 50; i++) {
        session.addMessage(userMsg(`message ${i} with some longer content to take up tokens`));
        session.addMessage(assistantMsg(`response ${i} with some longer content too`));
      }

      expect(session.lastConsolidated).toBe(0);
      await consolidator.maybeConsolidate(session, "", []);
      // Memory file was never written, so lastConsolidated must stay at 0.
      expect(session.lastConsolidated).toBe(0);
    });

    test("advances lastConsolidated when LLM writes to memory store", async () => {
      // Runner side-effects: writes to the store, simulating save_memory being called.
      const runner = {
        call: mock(async () => {
          await store.writeLongTerm("# Facts\n- something happened");
          return "";
        }),
      } as unknown as Runner;

      const consolidator = new MemoryConsolidator({
        store,
        runner,
        contextWindowTokens: 4000,
        maxCompletionTokens: 100,
        maxConsolidationRounds: 1,
      });

      const session = new Session({ key: "test" });
      for (let i = 0; i < 50; i++) {
        session.addMessage(userMsg(`message ${i} with some longer content to take up tokens`));
        session.addMessage(assistantMsg(`response ${i} with some longer content too`));
      }

      expect(session.lastConsolidated).toBe(0);
      await consolidator.maybeConsolidate(session, "", []);
      expect(session.lastConsolidated).toBeGreaterThan(0);
    });
  });
});
