import { describe, test, expect } from "bun:test";
import {
  GhostError,
  ConfigError,
  SecurityError,
  MemoryError,
  ToolError,
  ProviderError,
  ChannelError,
} from "../../src/core/errors.js";

describe("GhostError", () => {
  test("is an instance of Error", () => {
    const err = new GhostError("test message", "TEST_CODE");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(GhostError);
    expect(err.message).toBe("test message");
    expect(err.code).toBe("TEST_CODE");
    expect(err.name).toBe("GhostError");
  });
});

describe("ConfigError", () => {
  test("instanceof GhostError with correct name and code", () => {
    const err = new ConfigError("bad config", "CONFIG_INVALID");
    expect(err).toBeInstanceOf(GhostError);
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.name).toBe("ConfigError");
    expect(err.code).toBe("CONFIG_INVALID");
  });
});

describe("SecurityError", () => {
  test("instanceof GhostError with correct name and code", () => {
    const err = new SecurityError("not allowed", "SECURITY_DENIED");
    expect(err).toBeInstanceOf(GhostError);
    expect(err).toBeInstanceOf(SecurityError);
    expect(err.name).toBe("SecurityError");
    expect(err.code).toBe("SECURITY_DENIED");
  });
});

describe("MemoryError", () => {
  test("instanceof GhostError with correct name and code", () => {
    const err = new MemoryError("store failed", "MEMORY_STORE_FAILED");
    expect(err).toBeInstanceOf(GhostError);
    expect(err).toBeInstanceOf(MemoryError);
    expect(err.name).toBe("MemoryError");
    expect(err.code).toBe("MEMORY_STORE_FAILED");
  });
});

describe("ToolError", () => {
  test("instanceof GhostError with correct name and code", () => {
    const err = new ToolError("tool failed", "TOOL_EXEC_FAILED");
    expect(err).toBeInstanceOf(GhostError);
    expect(err).toBeInstanceOf(ToolError);
    expect(err.name).toBe("ToolError");
    expect(err.code).toBe("TOOL_EXEC_FAILED");
  });
});

describe("ProviderError", () => {
  test("instanceof GhostError with correct name and code", () => {
    const err = new ProviderError("api error", "PROVIDER_API_ERROR");
    expect(err).toBeInstanceOf(GhostError);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.name).toBe("ProviderError");
    expect(err.code).toBe("PROVIDER_API_ERROR");
  });
});

describe("ChannelError", () => {
  test("instanceof GhostError with correct name and code", () => {
    const err = new ChannelError("send failed", "CHANNEL_SEND_FAILED");
    expect(err).toBeInstanceOf(GhostError);
    expect(err).toBeInstanceOf(ChannelError);
    expect(err.name).toBe("ChannelError");
    expect(err.code).toBe("CHANNEL_SEND_FAILED");
  });
});
