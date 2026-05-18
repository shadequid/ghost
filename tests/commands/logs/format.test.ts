import { describe, test, expect } from "bun:test";
import {
  formatPretty,
  formatPlain,
  formatJsonLine,
  formatRawLine,
} from "../../../src/commands/logs/format.js";
import type { ParsedLine } from "../../../src/commands/logs/parse.js";

describe("format", () => {
  const mockParsed: ParsedLine = {
    time: 1714000000000, // 2024-04-25 19:06:40 UTC
    level: "info",
    name: "test-logger",
    msg: "hello world",
    raw: '{"level":30,"time":1714000000000,"msg":"hello world"}',
  };

  test("formatPretty with rich=true includes ANSI codes", () => {
    const result = formatPretty(mockParsed, { rich: true });
    expect(result).toContain("\x1b[");
    expect(result).toContain("hello world");
  });

  test("formatPretty renders module-style name in brackets", () => {
    const result = formatPretty(mockParsed, { rich: false });
    expect(result).toContain("[test-logger]");
  });

  test("formatPretty appends extras as key=value pairs", () => {
    const result = formatPretty(
      { ...mockParsed, extras: { job: "news-fetch", count: 67 } },
      { rich: false },
    );
    expect(result).toContain("job=news-fetch");
    expect(result).toContain("count=67");
  });

  test("formatPretty quotes extras values that contain whitespace", () => {
    const result = formatPretty(
      { ...mockParsed, extras: { reason: "fetch failed" } },
      { rich: false },
    );
    expect(result).toContain('reason="fetch failed"');
  });

  test("formatPretty returns <unserializable> for circular refs (no crash)", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const result = formatPretty(
      { ...mockParsed, extras: { obj: circular } },
      { rich: false },
    );
    expect(result).toContain("obj=<unserializable>");
  });

  test("formatPretty returns <unserializable> for BigInt extras (no crash)", () => {
    const result = formatPretty(
      { ...mockParsed, extras: { big: BigInt(9007199254740993) } },
      { rich: false },
    );
    expect(result).toContain("big=<unserializable>");
  });

  test("formatPretty JSON-encodes object extras and truncates large payloads", () => {
    const big = "x".repeat(300);
    const result = formatPretty(
      { ...mockParsed, extras: { payload: { nested: big } } },
      { rich: false },
    );
    expect(result).toContain("payload=");
    expect(result).toContain("…");
    // Truncation cap is 200 chars on the JSON encoding.
    expect(result.length).toBeLessThan(600);
  });

  test("formatPlain mirrors pretty: bracketed name + key=value extras", () => {
    const result = formatPlain({
      ...mockParsed,
      extras: { source: "binance", connected: true },
    });
    expect(result).toContain("[test-logger]");
    expect(result).toContain("source=binance");
    expect(result).toContain("connected=true");
    expect(result).not.toContain("\x1b[");
  });

  test("formatPretty with rich=false has no ANSI codes", () => {
    const result = formatPretty(mockParsed, { rich: false });
    expect(result).not.toContain("\x1b[");
    expect(result).toContain("hello world");
  });

  test("formatPretty error level uses red color code", () => {
    const errorParsed: ParsedLine = {
      ...mockParsed,
      level: "error",
    };
    const result = formatPretty(errorParsed, { rich: true });
    expect(result).toContain("\x1b[31m"); // red
  });

  test("formatPretty fatal level uses red color code", () => {
    const fatalParsed: ParsedLine = {
      ...mockParsed,
      level: "fatal",
    };
    const result = formatPretty(fatalParsed, { rich: true });
    expect(result).toContain("\x1b[31m"); // red
  });

  test("formatPretty warn level uses yellow color code", () => {
    const warnParsed: ParsedLine = {
      ...mockParsed,
      level: "warn",
    };
    const result = formatPretty(warnParsed, { rich: true });
    expect(result).toContain("\x1b[33m"); // yellow
  });

  test("formatPretty debug level uses muted color code", () => {
    const debugParsed: ParsedLine = {
      ...mockParsed,
      level: "debug",
    };
    const result = formatPretty(debugParsed, { rich: true });
    expect(result).toContain("\x1b[90m"); // muted
  });

  test("formatPretty trace level uses muted color code", () => {
    const traceParsed: ParsedLine = {
      ...mockParsed,
      level: "trace",
    };
    const result = formatPretty(traceParsed, { rich: true });
    expect(result).toContain("\x1b[90m"); // muted
  });

  test("formatPretty info level uses cyan color code", () => {
    const infoParsed: ParsedLine = {
      ...mockParsed,
      level: "info",
    };
    const result = formatPretty(infoParsed, { rich: true });
    expect(result).toContain("\x1b[36m"); // cyan
  });

  test("formatPretty includes name in magenta", () => {
    const result = formatPretty(mockParsed, { rich: true });
    expect(result).toContain("\x1b[35m"); // magenta (name)
    expect(result).toContain("test-logger");
  });

  test("formatPretty formats time as HH:MM:SS.mmm", () => {
    const result = formatPretty(mockParsed, { rich: true });
    // Should include time in HH:MM:SS.mmm format
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3}/);
  });

  test("formatPlain includes ISO timestamp", () => {
    const result = formatPlain(mockParsed);
    // Check that it contains an ISO-like format (may vary by timezone)
    expect(result).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("formatPlain includes level", () => {
    const result = formatPlain(mockParsed);
    expect(result).toContain("info");
  });

  test("formatPlain includes name", () => {
    const result = formatPlain(mockParsed);
    expect(result).toContain("test-logger");
  });

  test("formatPlain includes message", () => {
    const result = formatPlain(mockParsed);
    expect(result).toContain("hello world");
  });

  test("formatPlain has no ANSI codes", () => {
    const result = formatPlain(mockParsed);
    expect(result).not.toContain("\x1b[");
  });

  test("formatJsonLine includes log type", () => {
    const result = formatJsonLine(mockParsed);
    const json = JSON.parse(result);
    expect(json.type).toBe("log");
  });

  test("formatJsonLine spreads extras into top level", () => {
    const withExtras: ParsedLine = {
      ...mockParsed,
      extras: { foo: "bar", baz: 42 },
    };
    const result = formatJsonLine(withExtras);
    const json = JSON.parse(result);
    expect(json.foo).toBe("bar");
    expect(json.baz).toBe(42);
  });

  test("formatJsonLine includes time, level, name, msg", () => {
    const result = formatJsonLine(mockParsed);
    const json = JSON.parse(result);
    expect(json.time).toBe(mockParsed.time);
    expect(json.level).toBe("info");
    expect(json.name).toBe("test-logger");
    expect(json.msg).toBe("hello world");
  });

  test("formatJsonLine omits raw field", () => {
    const result = formatJsonLine(mockParsed);
    const json = JSON.parse(result);
    expect(json.raw).toBeUndefined();
  });

  test("formatRawLine returns input unchanged", () => {
    const input = "any raw line of text";
    const result = formatRawLine(input);
    expect(result).toBe(input);
  });

  test("formatPretty with missing level defaults to info color", () => {
    const noLevel: ParsedLine = {
      ...mockParsed,
      level: undefined,
    };
    const result = formatPretty(noLevel, { rich: true });
    expect(result).toContain("\x1b[36m"); // cyan (info default)
  });

  test("formatPretty with missing time omits timestamp", () => {
    const noTime: ParsedLine = {
      ...mockParsed,
      time: undefined,
    };
    const result = formatPretty(noTime, { rich: true });
    // Should not have a timestamp pattern
    expect(result).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test("formatPlain with missing name omits it", () => {
    const noName: ParsedLine = {
      ...mockParsed,
      name: undefined,
    };
    const result = formatPlain(noName);
    expect(result).not.toContain("test-logger");
  });

  test("formatJsonLine with no extras has no extra fields", () => {
    const result = formatJsonLine(mockParsed);
    const json = JSON.parse(result);
    expect(Object.keys(json)).toEqual(["type", "time", "level", "name", "msg"]);
  });

  test("formatPretty falls back to raw when msg missing", () => {
    const noMsg: ParsedLine = {
      ...mockParsed,
      msg: "",
      raw: "raw fallback content",
    };
    const result = formatPretty(noMsg, { rich: true });
    expect(result).toContain("raw fallback content");
  });
});
