import { describe, expect, test } from "bun:test";
import { createRootLogger } from "../src/logger.js";

describe("createRootLogger", () => {
  test("default verbosity 0 sets level to info", () => {
    const logger = createRootLogger(0);
    expect(logger.level).toBe("info");
  });

  test("verbosity 1 sets level to debug", () => {
    const logger = createRootLogger(1);
    expect(logger.level).toBe("debug");
  });

  test("verbosity 2 sets level to trace", () => {
    const logger = createRootLogger(2);
    expect(logger.level).toBe("trace");
  });

  test("LOG_LEVEL env var overrides default when verbosity is 0", () => {
    const original = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    try {
      const logger = createRootLogger(0);
      expect(logger.level).toBe("warn");
    } finally {
      if (original === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = original;
    }
  });

  test("verbosity flag takes precedence over LOG_LEVEL", () => {
    const original = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "warn";
    try {
      const logger = createRootLogger(1);
      expect(logger.level).toBe("debug");
    } finally {
      if (original === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = original;
    }
  });

  test("invalid LOG_LEVEL falls back to info", () => {
    const original = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "banana";
    try {
      const logger = createRootLogger(0);
      expect(logger.level).toBe("info");
    } finally {
      if (original === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = original;
    }
  });

  test("child logger inherits level and adds module field", () => {
    const root = createRootLogger(0);
    const child = root.child({ module: "news" });
    expect(child.level).toBe("info");
    expect((child as unknown as { bindings: () => Record<string, unknown> }).bindings().module).toBe("news");
  });
});

describe("createRootLogger — stdout only", () => {
  // After the earlier revert, pino writes to stdout only. The OS service
  // supervisor (launchd StandardOutPath / schtasks `>>` / systemd
  // StandardOutput=append:) owns the log file.
  test("does not throw when called with verbosity only", () => {
    expect(() => createRootLogger(0)).not.toThrow();
  });
});

