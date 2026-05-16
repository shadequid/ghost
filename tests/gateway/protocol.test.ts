import { describe, test, expect } from "bun:test";
import { parseClientFrame, makeOk, makeError, makeEvent } from "../../src/gateway/protocol.js";

describe("parseClientFrame", () => {
  test("parses connect frame", () => {
    const frame = parseClientFrame({ type: "connect", token: "abc" });
    expect(frame).toEqual({ type: "connect", token: "abc" });
  });

  test("parses connect frame without token", () => {
    const frame = parseClientFrame({ type: "connect" });
    expect(frame).toEqual({ type: "connect", token: undefined });
  });

  test("parses request frame", () => {
    const frame = parseClientFrame({ type: "req", id: "1", method: "health", payload: {} });
    expect(frame).toEqual({ type: "req", id: "1", method: "health", payload: {} });
  });

  test("returns null for invalid frame", () => {
    expect(parseClientFrame(null)).toBeNull();
    expect(parseClientFrame("string")).toBeNull();
    expect(parseClientFrame({ type: "req" })).toBeNull();
    expect(parseClientFrame({ type: "req", id: 123, method: "x" })).toBeNull();
    expect(parseClientFrame({ type: "unknown" })).toBeNull();
  });
});

describe("frame builders", () => {
  test("makeOk", () => {
    expect(makeOk("1", { status: "ok" })).toEqual({ type: "res", id: "1", ok: true, payload: { status: "ok" } });
  });

  test("makeError", () => {
    expect(makeError("1", "NOT_FOUND", "nope")).toEqual({
      type: "res", id: "1", ok: false, error: { code: "NOT_FOUND", message: "nope" },
    });
  });

  test("makeEvent", () => {
    expect(makeEvent("health.changed", { status: "ok" }, 5)).toEqual({
      type: "event", event: "health.changed", payload: { status: "ok" }, seq: 5,
    });
  });
});
