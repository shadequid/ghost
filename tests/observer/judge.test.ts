import { describe, expect, test } from "bun:test";
import { parseJudgeResponse } from "../../src/observer/judge.js";

describe("parseJudgeResponse", () => {
  test("happy path: fire", () => {
    const r = parseJudgeResponse(
      JSON.stringify({
        decision: "fire",
        primaryEventType: "tp_hit",
        primarySymbol: "BTC",
        body: "BTC long hit TP +$120. Nice take.",
        notify: true,
        reason: "TP win, congratulate briefly.",
      }),
    );
    expect(r.decision).toBe("fire");
    expect(r.primaryEventType).toBe("tp_hit");
    expect(r.body).toContain("BTC");
  });

  test("happy path: silent with reason", () => {
    const r = parseJudgeResponse(
      JSON.stringify({
        decision: "silent",
        primaryEventType: null,
        primarySymbol: null,
        body: null,
        notify: false,
        reason: "pnl_snapshot only, no meaningful move",
      }),
    );
    expect(r.decision).toBe("silent");
    expect(r.reason).toContain("no meaningful");
  });

  test("strips markdown fence wrap", () => {
    const r = parseJudgeResponse(
      "```json\n" +
        JSON.stringify({
          decision: "fire",
          primaryEventType: "position_closed",
          primarySymbol: "ETH",
          body: "ETH closed +$80.",
          notify: false,
          reason: "small win",
        }) +
        "\n```",
    );
    expect(r.decision).toBe("fire");
    expect(r.primarySymbol).toBe("ETH");
  });

  test("empty input → silent with reason", () => {
    const r = parseJudgeResponse("");
    expect(r.decision).toBe("silent");
    expect(r.reason).toBe("empty_response");
  });

  test("malformed JSON → silent with parse_error", () => {
    const r = parseJudgeResponse("not even json");
    expect(r.decision).toBe("silent");
    expect(r.reason).toBe("parse_error");
  });

  test("fire missing body → silent fire_missing_fields", () => {
    const r = parseJudgeResponse(
      JSON.stringify({
        decision: "fire",
        primaryEventType: "tp_hit",
        primarySymbol: "BTC",
        body: null,
        notify: true,
        reason: null,
      }),
    );
    expect(r.decision).toBe("silent");
    expect(r.reason).toBe("fire_missing_fields");
  });

  test("silent missing reason → silent with silent_missing_reason", () => {
    const r = parseJudgeResponse(
      JSON.stringify({
        decision: "silent",
        primaryEventType: null,
        primarySymbol: null,
        body: null,
        notify: false,
        reason: null,
      }),
    );
    expect(r.decision).toBe("silent");
    expect(r.reason).toBe("silent_missing_reason");
  });

  test("invalid event type → silent schema_error", () => {
    const r = parseJudgeResponse(
      JSON.stringify({
        decision: "fire",
        primaryEventType: "nonsense_event",
        primarySymbol: "BTC",
        body: "x",
        notify: true,
        reason: "x",
      }),
    );
    expect(r.decision).toBe("silent");
    expect(r.reason).toBe("schema_error");
  });
});
