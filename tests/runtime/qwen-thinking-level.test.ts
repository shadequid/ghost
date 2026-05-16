import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRuntime } from "../../src/runtime.js";
import { NOOP_LOGGER } from "../../src/logger.js";

/**
 * Verify the end-to-end "force thinking off for Qwen-on-Ollama"
 * override lands in the agent state, not just in the model descriptor.
 *
 * The earlier fix only stamped `reasoning: true` + `thinkingFormat:
 * "qwen-chat-template"` on the model, but pi-agent still forwarded Ghost's
 * default `thinkingLevel: "low"` into pi-ai — which flipped pi-ai's
 * `!!reasoningEffort` back to `true` and left thinking enabled. This test
 * seals the gap: the agent state's thinkingLevel must be `"off"` when a
 * Qwen-on-Ollama model is selected, even if config.agent.thinkingLevel is
 * the default `"low"`.
 */

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "ghost-qwen-thinking-"));
}

describe("Qwen-on-Ollama forces thinkingLevel=off in agent state", () => {
  const tempDirs: string[] = [];
  let savedGhostHome: string | undefined;

  afterEach(() => {
    if (savedGhostHome === undefined) delete process.env["GHOST_HOME"];
    else process.env["GHOST_HOME"] = savedGhostHome;
    savedGhostHome = undefined;
    for (const dir of tempDirs) {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  test("Qwen-on-Ollama with default thinkingLevel='low' yields state.thinkingLevel='off'", async () => {
    const home = makeTempHome();
    tempDirs.push(home);
    savedGhostHome = process.env["GHOST_HOME"];
    process.env["GHOST_HOME"] = home;

    // Register Qwen-on-Ollama via models.json + config points at it.
    writeFileSync(
      join(home, "models.json"),
      JSON.stringify({
        providers: {
          ollama: {
            baseUrl: "http://localhost:11434/v1",
            apiKey: "ollama",
            models: [{ id: "qwen3:8b" }],
          },
        },
      }),
    );

    const configPath = join(home, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: "ollama",
        model: "qwen3:8b",
        // Leave agent.thinkingLevel at its default "low" — the exact
        // scenario that made the model-side override a no-op before this fix.
      }),
    );

    const runtime = await createRuntime({ configPath, logger: NOOP_LOGGER });
    try {
      // Config still reads "low" — we don't mutate user intent.
      expect(runtime.config.agent.thinkingLevel).toBe("low");
      // But the agent state is forced to "off" so pi-agent sends no
      // reasoningEffort, which lets pi-ai ship enable_thinking: false.
      expect(runtime.agent.state.thinkingLevel).toBe("off");
      // And the model itself carries the qwen-chat-template opt-in.
      expect(runtime.agent.state.model.id).toBe("qwen3:8b");
      expect(runtime.agent.state.model.reasoning).toBe(true);
      const compat = runtime.agent.state.model.compat as
        | { thinkingFormat?: string }
        | undefined;
      expect(compat?.thinkingFormat).toBe("qwen-chat-template");
    } finally {
      runtime.db.close();
    }
  });

  test("non-Qwen Ollama model keeps user's configured thinkingLevel", async () => {
    const home = makeTempHome();
    tempDirs.push(home);
    savedGhostHome = process.env["GHOST_HOME"];
    process.env["GHOST_HOME"] = home;

    writeFileSync(
      join(home, "models.json"),
      JSON.stringify({
        providers: {
          ollama: {
            baseUrl: "http://localhost:11434/v1",
            apiKey: "ollama",
            models: [{ id: "llama3.1:8b" }],
          },
        },
      }),
    );

    const configPath = join(home, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: "ollama",
        model: "llama3.1:8b",
        agent: { thinkingLevel: "medium" },
      }),
    );

    const runtime = await createRuntime({ configPath, logger: NOOP_LOGGER });
    try {
      expect(runtime.config.agent.thinkingLevel).toBe("medium");
      // No override — user's choice passes through.
      expect(runtime.agent.state.thinkingLevel).toBe("medium");
    } finally {
      runtime.db.close();
    }
  });

  test("explicit user thinkingLevel='high' is still overridden for Qwen-on-Ollama", async () => {
    // This documents the override precedence: the auto-opt-in intentionally
    // overrides even explicit user selections because pi-ai's contract
    // makes any non-off level send `enable_thinking: true`. Users who want
    // thinking ON for Qwen must opt out by setting reasoning:false in their
    // models.json model entry (which disables the auto-opt-in path).
    const home = makeTempHome();
    tempDirs.push(home);
    savedGhostHome = process.env["GHOST_HOME"];
    process.env["GHOST_HOME"] = home;

    writeFileSync(
      join(home, "models.json"),
      JSON.stringify({
        providers: {
          ollama: {
            baseUrl: "http://localhost:11434/v1",
            apiKey: "ollama",
            models: [{ id: "qwen2.5-coder:7b" }],
          },
        },
      }),
    );

    const configPath = join(home, "config.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        provider: "ollama",
        model: "qwen2.5-coder:7b",
        agent: { thinkingLevel: "high" },
      }),
    );

    const runtime = await createRuntime({ configPath, logger: NOOP_LOGGER });
    try {
      expect(runtime.config.agent.thinkingLevel).toBe("high");
      expect(runtime.agent.state.thinkingLevel).toBe("off");
    } finally {
      runtime.db.close();
    }
  });
});
