import { describe, test, expect } from "bun:test";
import { parsePinoLine, LEVEL_MAP } from "../../../src/commands/logs/parse.js";
import pino from "pino";
import { PassThrough } from "node:stream";

/**
 * Captures a pino log line by creating a transient logger writing to a
 * buffer-backed stream.
 */
function capturePinoLine(fn: (log: pino.Logger) => void): string {
  const stream = new PassThrough();
  const lines: string[] = [];
  stream.on("data", (chunk) => {
    lines.push(chunk.toString("utf8"));
  });

  const log = pino({ level: "trace" }, stream);
  fn(log);

  // Flush the stream by closing it (synchronously in test)
  stream.destroy();

  return lines.join("").trim();
}

describe("parsePinoLine", () => {
  test("parses info level correctly", () => {
    const raw = capturePinoLine((log) => {
      log.info("hello");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.level).toBe("info");
    expect(parsed?.msg).toBe("hello");
    expect(typeof parsed?.time).toBe("number");
    expect(parsed?.time).toBeGreaterThan(0);
  });

  test("parses error level correctly", () => {
    const raw = capturePinoLine((log) => {
      log.error("boom");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.level).toBe("error");
    expect(parsed?.msg).toBe("boom");
  });

  test("parses warn level correctly", () => {
    const raw = capturePinoLine((log) => {
      log.warn("caution");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.level).toBe("warn");
    expect(parsed?.msg).toBe("caution");
  });

  test("parses debug level correctly", () => {
    const raw = capturePinoLine((log) => {
      log.debug("details");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.level).toBe("debug");
    expect(parsed?.msg).toBe("details");
  });

  test("parses trace level correctly", () => {
    const raw = capturePinoLine((log) => {
      log.trace("trace msg");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.level).toBe("trace");
    expect(parsed?.msg).toBe("trace msg");
  });

  test("parses fatal level correctly", () => {
    const raw = capturePinoLine((log) => {
      log.fatal("fatal");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.level).toBe("fatal");
    expect(parsed?.msg).toBe("fatal");
  });

  test("extracts name from child logger", () => {
    const raw = capturePinoLine((log) => {
      const child = log.child({ name: "daemon" });
      child.info("msg");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.name).toBe("daemon");
  });

  test("falls back to `module` field when pino `name` is absent", () => {
    const raw = '{"level":30,"time":1714000000000,"module":"jobs","job":"news-fetch","msg":"hi"}';
    const parsed = parsePinoLine(raw);
    expect(parsed?.name).toBe("jobs");
    // `module` itself must NOT leak into extras — it has been promoted to `name`.
    expect(parsed?.extras?.module).toBeUndefined();
    expect(parsed?.extras?.job).toBe("news-fetch");
  });

  test("prefers pino `name` over `module` when both are present", () => {
    const raw = '{"level":30,"time":1,"name":"primary","module":"secondary","msg":"x"}';
    const parsed = parsePinoLine(raw);
    expect(parsed?.name).toBe("primary");
  });

  test("captures extras from non-reserved keys", () => {
    const raw = capturePinoLine((log) => {
      log.info({ foo: "bar", baz: 42 }, "msg");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.extras?.foo).toBe("bar");
    expect(parsed?.extras?.baz).toBe(42);
  });

  test("excludes reserved keys from extras", () => {
    const raw = capturePinoLine((log) => {
      (log as any).info(
        {
          foo: "bar",
          level: 999, // reserved, should not appear in extras
          pid: 9999,  // reserved
        },
        "msg"
      );
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.extras?.foo).toBe("bar");
    expect(parsed?.extras?.level).toBeUndefined();
    expect(parsed?.extras?.pid).toBeUndefined();
  });

  test("returns raw line in parsed output", () => {
    const raw = capturePinoLine((log) => {
      log.info("test");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.raw).toBe(raw);
  });

  test("handles malformed JSON by returning null", () => {
    const parsed = parsePinoLine("not json at all");
    expect(parsed).toBeNull();
  });

  test("handles non-object JSON by returning null", () => {
    const parsed = parsePinoLine('"a string"');
    expect(parsed).toBeNull();
  });

  test("handles array JSON by returning null", () => {
    const parsed = parsePinoLine("[1, 2, 3]");
    expect(parsed).toBeNull();
  });

  test("handles unknown numeric level", () => {
    const raw = JSON.stringify({ level: 99, msg: "unknown level" });
    const parsed = parsePinoLine(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.level).toBeUndefined();
    expect(parsed?.msg).toBe("unknown level");
  });

  test("handles missing msg field", () => {
    const raw = JSON.stringify({ level: 30 });
    const parsed = parsePinoLine(raw);
    expect(parsed?.msg).toBe("");
  });

  test("handles missing time field", () => {
    const raw = JSON.stringify({ level: 30, msg: "no time" });
    const parsed = parsePinoLine(raw);
    expect(parsed?.time).toBeUndefined();
  });

  test("handles complex extras structure", () => {
    const raw = capturePinoLine((log) => {
      log.info(
        { user: { id: 123, name: "test" }, tags: ["a", "b"] },
        "msg"
      );
    });
    const parsed = parsePinoLine(raw);
    expect((parsed?.extras?.user as any)?.id).toBe(123);
    expect(Array.isArray(parsed?.extras?.tags)).toBe(true);
  });

  test("stores raw line for fallback rendering", () => {
    const raw = capturePinoLine((log) => {
      log.info("msg");
    });
    const parsed = parsePinoLine(raw);
    expect(parsed?.raw).toBe(raw);
    expect(parsed?.raw.length).toBeGreaterThan(0);
  });
});
