import { describe, test, expect } from "bun:test";
import { configSchema } from "../../src/config/schema.js";

describe("configSchema defaults", () => {
  test("parses empty object with sensible defaults", () => {
    const config = configSchema.parse({});
    expect(config.provider).toBe("openrouter");
    expect(config.model).toBe("anthropic/claude-sonnet-4");
    expect(config.gateway.port).toBe(15401);
    expect(config.autonomy.level).toBe("supervised");
    expect(config.memory.contextWindowTokens).toBe(65_536);
  });
});

describe("configSchema validation", () => {
  test("rejects invalid autonomy level enum", () => {
    expect(() =>
      configSchema.parse({ autonomy: { level: "godmode" } })
    ).toThrow();
  });

  test("coerces string number for gateway port", () => {
    const config = configSchema.parse({ gateway: { port: "9000" } });
    expect(config.gateway.port).toBe(9000);
    expect(typeof config.gateway.port).toBe("number");
  });

  test("accepts valid full override", () => {
    const config = configSchema.parse({
      provider: "openai",
      model: "gpt-4o",
      gateway: { port: 8080, host: "0.0.0.0" },
      autonomy: { level: "full" },
    });
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-4o");
    expect(config.gateway.host).toBe("0.0.0.0");
    expect(config.autonomy.level).toBe("full");
  });
});
