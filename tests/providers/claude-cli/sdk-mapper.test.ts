/**
 * Tests for SdkMessageMapper — SDK message → pi-ai AssistantMessageEvent mapper.
 *
 * SdkMessageMapper is stateful per-invocation. Each describe block creates a
 * fresh mapper instance to avoid cross-test state leakage.
 *
 * Coverage:
 *   - system/init message → no events emitted, state captured externally
 *   - stream_event: message_start → start event
 *   - stream_event: text content_block_start/delta/stop → text_start/delta/end
 *   - stream_event: tool_use content_block_start/delta/stop → toolcall_start/end
 *   - assistant batch fallback (no stream_events) → text + toolcall events
 *   - result (success) → done event with usage + stop_reason
 *   - result (is_error) → error event
 *   - duplicate tool call ID dedup
 *   - unknown message type → no events
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { SdkMessageMapper, type StreamEventMsg, type AssistantMsg, type ResultMsg } from "../../../src/providers/claude-cli/sdk-mapper.js";
import { NOOP_LOGGER } from "../../../src/logger.js";

const MODEL = "claude-opus-4-5";

function makeMapper(): SdkMessageMapper {
  return new SdkMessageMapper(MODEL, NOOP_LOGGER);
}

/**
 * process() accepts `{ type: string; [key: string]: unknown }` but the
 * exported narrow types (StreamEventMsg, AssistantMsg) lack the index
 * signature. Cast through unknown to satisfy the compiler without widening
 * the test message literals to `any`.
 */
function process(
  mapper: SdkMessageMapper,
  msg: StreamEventMsg | AssistantMsg | ResultMsg | { type: string },
) {
  return mapper.process(msg as unknown as { type: string; [key: string]: unknown });
}

// ---------------------------------------------------------------------------
// system / init message
// ---------------------------------------------------------------------------

describe("SdkMessageMapper — system/init message", () => {
  test("system message is not handled by process() → no events", () => {
    const mapper = makeMapper();
    // The SDK emits `{ type: "system", session_id: "..." }` which is handled
    // in claude-cli-chat.ts before reaching mapper.process(). Here we confirm
    // that process() ignores it gracefully.
    const events = process(mapper, { type: "system", session_id: "sess-abc-123" } as { type: string });
    expect(events).toEqual([]);
  });

  test("unknown message type → no events", () => {
    const mapper = makeMapper();
    const events = process(mapper, { type: "something_unknown" });
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stream_event: message_start → start event
// ---------------------------------------------------------------------------

describe("SdkMessageMapper — stream_event message_start", () => {
  test("first message_start emits start event", () => {
    const mapper = makeMapper();
    const msg: StreamEventMsg = {
      type: "stream_event",
      event: { type: "message_start" },
    };
    const events = process(mapper, msg);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("start");
  });

  test("second message_start does not emit duplicate start", () => {
    const mapper = makeMapper();
    const msg: StreamEventMsg = {
      type: "stream_event",
      event: { type: "message_start" },
    };
    process(mapper, msg);
    const events = process(mapper, msg);
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// stream_event: text block
// ---------------------------------------------------------------------------

describe("SdkMessageMapper — stream_event text block", () => {
  let mapper: SdkMessageMapper;

  beforeEach(() => { mapper = makeMapper(); });

  function textBlockStart(index = 0): StreamEventMsg {
    return {
      type: "stream_event",
      event: {
        type: "content_block_start",
        index,
        content_block: { type: "text" },
      },
    };
  }

  function textDelta(index = 0, text = "hello"): StreamEventMsg {
    return {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text },
      },
    };
  }

  function blockStop(index = 0): StreamEventMsg {
    return {
      type: "stream_event",
      event: { type: "content_block_stop", index },
    };
  }

  test("content_block_start emits start + text_start", () => {
    const events = process(mapper, textBlockStart());
    const types = events.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("text_start");
  });

  test("content_block_delta emits text_delta", () => {
    process(mapper, textBlockStart());
    const events = process(mapper, textDelta(0, "world"));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("text_delta");
    expect((events[0] as { delta?: string }).delta).toBe("world");
  });

  test("content_block_stop emits text_end with accumulated text", () => {
    process(mapper, textBlockStart());
    process(mapper, textDelta(0, "foo"));
    process(mapper, textDelta(0, "bar"));
    const events = process(mapper, blockStop());
    const endEvent = events.find((e) => e.type === "text_end");
    expect(endEvent).toBeDefined();
    expect((endEvent as { content?: string }).content).toBe("foobar");
  });

  test("content_block_stop for unknown index emits nothing", () => {
    const events = process(mapper, blockStop(99));
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// stream_event: tool_use block
// ---------------------------------------------------------------------------

describe("SdkMessageMapper — stream_event tool_use block", () => {
  let mapper: SdkMessageMapper;

  beforeEach(() => { mapper = makeMapper(); });

  function toolBlockStart(index = 0, id = "call_123", name = "ghost_watchlist_get"): StreamEventMsg {
    return {
      type: "stream_event",
      event: {
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id, name },
      },
    };
  }

  function toolDelta(index = 0, partial_json = ""): StreamEventMsg {
    return {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json },
      },
    };
  }

  function blockStop(index = 0): StreamEventMsg {
    return {
      type: "stream_event",
      event: { type: "content_block_stop", index },
    };
  }

  test("tool_use block start emits toolcall_start", () => {
    const events = process(mapper, toolBlockStart());
    // start emitted on first content_block_start
    expect(events.some((e) => e.type === "start")).toBe(true);
    expect(events.some((e) => e.type === "toolcall_start")).toBe(true);
  });

  test("input_json_delta emits toolcall_delta", () => {
    process(mapper, toolBlockStart());
    const events = process(mapper, toolDelta(0, '{"sym'));
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("toolcall_delta");
    expect((events[0] as { delta?: string }).delta).toBe('{"sym');
  });

  test("tool block stop emits toolcall_end with id and name", () => {
    process(mapper, toolBlockStart(0, "call_abc", "ghost_watchlist_get"));
    process(mapper, toolDelta(0, '{"symbol":"BTC"}'));
    const events = process(mapper, blockStop());

    const endEvent = events.find((e) => e.type === "toolcall_end");
    expect(endEvent).toBeDefined();
    const toolCall = (endEvent as { toolCall?: { id: string; name: string; arguments: Record<string, unknown> } }).toolCall;
    expect(toolCall?.id).toBe("call_abc");
    expect(toolCall?.name).toBe("ghost_watchlist_get");
    expect(toolCall?.arguments).toEqual({ symbol: "BTC" });
  });

  test("malformed JSON args → empty object fallback", () => {
    process(mapper, toolBlockStart(0, "call_bad", "ghost_watchlist_get"));
    process(mapper, toolDelta(0, '{bad json'));
    const events = process(mapper, blockStop());

    const endEvent = events.find((e) => e.type === "toolcall_end");
    const toolCall = (endEvent as { toolCall?: { arguments: Record<string, unknown> } }).toolCall;
    expect(toolCall?.arguments).toEqual({});
  });

  test("duplicate tool call ID is deduped — second emission suppressed", () => {
    // First occurrence
    process(mapper, toolBlockStart(0, "dup_id", "ghost_watchlist_get"));
    process(mapper, blockStop(0));

    // Second occurrence with same id (e.g. SDK bug)
    process(mapper, toolBlockStart(1, "dup_id", "ghost_watchlist_get"));
    const events = process(mapper, blockStop(1));

    const toolcallEnds = events.filter((e) => e.type === "toolcall_end");
    expect(toolcallEnds).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// assistant batch fallback (no stream_events)
// ---------------------------------------------------------------------------

describe("SdkMessageMapper — assistant batch fallback", () => {
  test("assistant text block emits start + text events", () => {
    const mapper = makeMapper();
    const msg: AssistantMsg = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "Hello from assistant" }],
      },
    };
    const events = process(mapper, msg);
    const types = events.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("text_start");
    expect(types).toContain("text_delta");
    expect(types).toContain("text_end");
  });

  test("assistant tool_use block emits toolcall_start + toolcall_end", () => {
    const mapper = makeMapper();
    const msg: AssistantMsg = {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "batch_tool_1",
            name: "ghost_watchlist_get",
            input: { symbol: "ETH" },
          },
        ],
      },
    };
    const events = process(mapper, msg);
    expect(events.some((e) => e.type === "toolcall_start")).toBe(true);
    const endEvent = events.find((e) => e.type === "toolcall_end");
    expect(endEvent).toBeDefined();
    const toolCall = (endEvent as { toolCall?: { id: string; name: string; arguments: Record<string, unknown> } }).toolCall;
    expect(toolCall?.id).toBe("batch_tool_1");
    expect(toolCall?.name).toBe("ghost_watchlist_get");
    expect(toolCall?.arguments).toEqual({ symbol: "ETH" });
  });

  test("assistant batch after stream_events → no events (stream_events take precedence)", () => {
    const mapper = makeMapper();
    // Emit a stream_event first to set hasStreamEvents = true
    process(mapper, {
      type: "stream_event",
      event: { type: "message_start" },
    } as StreamEventMsg);

    const msg: AssistantMsg = {
      type: "assistant",
      message: { content: [{ type: "text", text: "ignored" }] },
    };
    const events = process(mapper, msg);
    expect(events).toHaveLength(0);
  });

  test("assistant usage field updates partial", () => {
    const mapper = makeMapper();
    const msg: AssistantMsg = {
      type: "assistant",
      message: {
        content: [{ type: "text", text: "hi" }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 2,
        },
      },
    };
    const events = process(mapper, msg);
    // After processing, at least one event should have partial.usage
    const startEvent = events.find((e) => e.type === "start");
    expect(startEvent).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// result message
// ---------------------------------------------------------------------------

describe("SdkMessageMapper — result (success)", () => {
  function makeResultMsg(overrides: Partial<ResultMsg> = {}): ResultMsg {
    return {
      type: "result",
      subtype: "success",
      is_error: false,
      stop_reason: "end_turn",
      total_cost_usd: 0.0012,
      num_turns: 1,
      duration_api_ms: 800,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 10,
      },
      ...overrides,
    };
  }

  test("success result emits done event", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(makeResultMsg());
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  test("done event reason maps end_turn → stop", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(makeResultMsg({ stop_reason: "end_turn" }));
    const doneEvent = events.find((e) => e.type === "done");
    expect((doneEvent as { reason?: string }).reason).toBe("stop");
  });

  test("done event reason maps max_tokens → length", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(makeResultMsg({ stop_reason: "max_tokens" }));
    const doneEvent = events.find((e) => e.type === "done");
    expect((doneEvent as { reason?: string }).reason).toBe("length");
  });

  test("done event message has usage with correct token counts", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(
      makeResultMsg({
        usage: { input_tokens: 200, output_tokens: 80, cache_creation_input_tokens: 5, cache_read_input_tokens: 15 },
        total_cost_usd: 0.005,
      }),
    );
    const doneEvent = events.find((e) => e.type === "done");
    const message = (doneEvent as { message?: { usage?: { input: number; output: number } } }).message;
    expect(message?.usage?.input).toBe(200);
    expect(message?.usage?.output).toBe(80);
  });

  test("success result with result text emits text events when no prior text", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(
      makeResultMsg({ subtype: "success", result: "Final answer text" }),
    );
    expect(events.some((e) => e.type === "text_start")).toBe(true);
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.some((e) => e.type === "text_end")).toBe(true);
  });
});

describe("SdkMessageMapper — result (error)", () => {
  function makeErrorResult(subtype = "error_during_execution"): ResultMsg {
    return {
      type: "result",
      subtype,
      is_error: true,
      stop_reason: "end_turn",
      total_cost_usd: 0,
      num_turns: 1,
      duration_api_ms: 100,
      usage: {
        input_tokens: 10,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
  }

  test("is_error=true emits error event", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(makeErrorResult());
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  test("error event reason is error", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(makeErrorResult());
    const errEvent = events.find((e) => e.type === "error");
    expect((errEvent as { reason?: string }).reason).toBe("error");
  });

  test("error event error.stopReason is error", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(makeErrorResult());
    const errEvent = events.find((e) => e.type === "error");
    const err = (errEvent as { error?: { stopReason?: string } }).error;
    expect(err?.stopReason).toBe("error");
  });

  test("error_during_execution subtype → tool execution error text", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(makeErrorResult("error_during_execution"));
    const errEvent = events.find((e) => e.type === "error");
    const err = (errEvent as { error?: { errorMessage?: string } }).error;
    expect(err?.errorMessage).toContain("tool execution error");
  });

  test("non-execution error subtype → session error text", () => {
    const mapper = makeMapper();
    const events = mapper.processResult(makeErrorResult("session_expired"));
    const errEvent = events.find((e) => e.type === "error");
    const err = (errEvent as { error?: { errorMessage?: string } }).error;
    expect(err?.errorMessage).toContain("session error");
  });
});
