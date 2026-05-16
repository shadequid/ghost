import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isOllamaEndpoint,
  isReservedProviderName,
  loadCustomModelRegistry,
  normalizeBaseUrl,
  PROVIDER_NAME_REGEX,
  shouldForceThinkingOff,
} from "../../src/providers/models-config.js";

let workDir: string;
let modelsJsonPath: string;

function writeModelsJson(content: unknown): void {
  writeFileSync(modelsJsonPath, JSON.stringify(content, null, 2));
}

beforeEach(() => {
  workDir = join(tmpdir(), `ghost-models-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workDir, { recursive: true });
  modelsJsonPath = join(workDir, "models.json");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("isOllamaEndpoint (anchored regex, shared with writer)", () => {
  test("matches localhost on port 11434", () => {
    expect(isOllamaEndpoint("http://localhost:11434")).toBe(true);
    expect(isOllamaEndpoint("http://localhost:11434/v1")).toBe(true);
    expect(isOllamaEndpoint("https://localhost:11434/api/generate")).toBe(true);
  });

  test("matches 127.0.0.1 on port 11434", () => {
    expect(isOllamaEndpoint("http://127.0.0.1:11434/v1")).toBe(true);
  });

  test("matches a remote Ollama host on port 11434", () => {
    expect(isOllamaEndpoint("http://ollama.internal:11434/v1")).toBe(true);
  });

  test("does NOT match port 11434 in a query string or path segment", () => {
    expect(isOllamaEndpoint("http://example.com/cb?url=http://localhost:11434/x")).toBe(false);
    expect(isOllamaEndpoint("https://evil.test/segment:11434fake/v1")).toBe(false);
    expect(isOllamaEndpoint("http://example.com:8080/localhost:11434")).toBe(false);
  });

  test("does NOT match hosts on other ports", () => {
    expect(isOllamaEndpoint("http://localhost:8080/v1")).toBe(false);
    expect(isOllamaEndpoint("https://api.openai.com/v1")).toBe(false);
  });
});

describe("isReservedProviderName (single source of truth)", () => {
  test("rejects pi-ai built-ins", () => {
    expect(isReservedProviderName("openai")).toBe(true);
    expect(isReservedProviderName("anthropic")).toBe(true);
    expect(isReservedProviderName("openrouter")).toBe(true);
  });

  test("rejects ghost-special reserved names", () => {
    expect(isReservedProviderName("claude-cli")).toBe(true);
    expect(isReservedProviderName("custom")).toBe(true);
  });

  test("accepts distinct custom names", () => {
    expect(isReservedProviderName("ollama")).toBe(false);
    expect(isReservedProviderName("vllm")).toBe(false);
    expect(isReservedProviderName("ollama-local")).toBe(false);
  });
});

describe("PROVIDER_NAME_REGEX (shared between wizard + loader)", () => {
  test("accepts lowercase alphanumerics + hyphens", () => {
    expect(PROVIDER_NAME_REGEX.test("ollama")).toBe(true);
    expect(PROVIDER_NAME_REGEX.test("ollama-local")).toBe(true);
    expect(PROVIDER_NAME_REGEX.test("vllm2")).toBe(true);
  });

  test("rejects uppercase, leading hyphens, empty", () => {
    expect(PROVIDER_NAME_REGEX.test("")).toBe(false);
    expect(PROVIDER_NAME_REGEX.test("Ollama")).toBe(false);
    expect(PROVIDER_NAME_REGEX.test("-ollama")).toBe(false);
    expect(PROVIDER_NAME_REGEX.test("ollama_local")).toBe(false);
  });
});

describe("normalizeBaseUrl", () => {
  test("appends /v1 when missing", () => {
    expect(normalizeBaseUrl("http://localhost:11434")).toBe("http://localhost:11434/v1");
  });

  test("leaves /v1 untouched", () => {
    expect(normalizeBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
  });

  test("accepts /v2 and other versioned paths without double-appending", () => {
    expect(normalizeBaseUrl("https://example.com/v2")).toBe("https://example.com/v2");
  });

  test("strips trailing slashes before appending", () => {
    expect(normalizeBaseUrl("http://localhost:8080/")).toBe("http://localhost:8080/v1");
  });
});

describe("loadCustomModelRegistry", () => {
  test("missing file returns empty registry with no load errors", () => {
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.list()).toEqual([]);
    expect(registry.loadErrors).toEqual([]);
    expect(registry.find("ollama", "qwen3:8b")).toBeUndefined();
  });

  test("loads a valid models.json with Ollama provider", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          api: "openai-completions",
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }, { id: "llama3.1:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.loadErrors).toEqual([]);
    expect(registry.list()).toEqual([
      { provider: "ollama", model: "qwen3:8b" },
      { provider: "ollama", model: "llama3.1:8b" },
    ]);
  });

  test("find returns fully hydrated Model with defaults applied", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "llama3.1:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const model = registry.find("ollama", "llama3.1:8b");
    expect(model).toBeDefined();
    expect(model!.id).toBe("llama3.1:8b");
    expect(model!.name).toBe("llama3.1:8b");
    expect(model!.provider).toBe("ollama");
    expect(model!.baseUrl).toBe("http://localhost:11434/v1");
    expect(model!.api).toBe("openai-completions");
    expect(model!.contextWindow).toBe(128000);
    expect(model!.maxTokens).toBe(16384);
    // Non-Qwen Ollama models default to reasoning:false — the Qwen thinking
    // auto-opt-in below is the only exception.
    expect(model!.reasoning).toBe(false);
    expect(model!.input).toEqual(["text"]);
    expect(model!.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  test("Qwen on Ollama auto-enables reasoning and qwen-chat-template thinking format", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }, { id: "qwen2.5-coder:7b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const qwen3 = registry.find("ollama", "qwen3:8b");
    const qwen25 = registry.find("ollama", "qwen2.5-coder:7b");
    // reasoning:true + no reasoningEffort at call-time = pi-ai sends
    // chat_template_kwargs:{enable_thinking:false} so Qwen skips <think> block.
    expect(qwen3!.reasoning).toBe(true);
    expect(qwen25!.reasoning).toBe(true);
    const c3 = qwen3!.compat as { thinkingFormat?: string } | undefined;
    const c25 = qwen25!.compat as { thinkingFormat?: string } | undefined;
    expect(c3?.thinkingFormat).toBe("qwen-chat-template");
    expect(c25?.thinkingFormat).toBe("qwen-chat-template");
  });

  test("Qwen auto-opt-in skips non-Ollama endpoints", () => {
    writeModelsJson({
      providers: {
        vllm: {
          baseUrl: "http://vllm.internal:8000/v1",
          apiKey: "EMPTY",
          models: [{ id: "qwen3:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const model = registry.find("vllm", "qwen3:8b");
    // vLLM has its own thinking-mode controls — don't inject qwen-chat-template blindly.
    expect(model!.reasoning).toBe(false);
    expect((model!.compat as { thinkingFormat?: string } | undefined)?.thinkingFormat).toBeUndefined();
  });

  test("user-set reasoning and thinkingFormat win over Qwen auto-opt-in", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          compat: { thinkingFormat: "qwen" },
          models: [{ id: "qwen3:8b", reasoning: false }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const model = registry.find("ollama", "qwen3:8b");
    expect(model!.reasoning).toBe(false);
    expect((model!.compat as { thinkingFormat?: string } | undefined)?.thinkingFormat).toBe("qwen");
  });

  test("respects user-supplied contextWindow and maxTokens", () => {
    writeModelsJson({
      providers: {
        vllm: {
          baseUrl: "http://vllm.internal:8000/v1",
          apiKey: "EMPTY",
          models: [{ id: "meta-llama/Llama-3.1-70B", contextWindow: 131072, maxTokens: 32000 }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const model = registry.find("vllm", "meta-llama/Llama-3.1-70B");
    expect(model).toBeDefined();
    expect(model!.contextWindow).toBe(131072);
    expect(model!.maxTokens).toBe(32000);
  });

  test("normalizes baseUrl by appending /v1 when missing", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434",
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.find("ollama", "qwen3:8b")?.baseUrl).toBe("http://localhost:11434/v1");
  });

  test("auto-detects Ollama compat hints when not set", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const compat = registry.find("ollama", "qwen3:8b")?.compat as
      | { supportsDeveloperRole?: boolean; supportsReasoningEffort?: boolean }
      | undefined;
    expect(compat?.supportsDeveloperRole).toBe(false);
    expect(compat?.supportsReasoningEffort).toBe(false);
  });

  test("user overrides win over auto-detected Ollama compat", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          compat: { supportsDeveloperRole: true },
          models: [{ id: "gpt-oss:20b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const compat = registry.find("ollama", "gpt-oss:20b")?.compat as
      | { supportsDeveloperRole?: boolean; supportsReasoningEffort?: boolean }
      | undefined;
    expect(compat?.supportsDeveloperRole).toBe(true);
    // Auto-default still applies for keys the user didn't set.
    expect(compat?.supportsReasoningEffort).toBe(false);
  });

  test("non-Ollama baseUrl does not auto-apply Ollama compat defaults", () => {
    writeModelsJson({
      providers: {
        vllm: {
          baseUrl: "http://vllm.internal:8000/v1",
          apiKey: "EMPTY",
          models: [{ id: "meta-llama/Llama-3.1-70B" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const model = registry.find("vllm", "meta-llama/Llama-3.1-70B");
    expect(model?.compat).toBeUndefined();
  });

  test("getApiKey returns literal apiKey when configured", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.getApiKey("ollama")).toBe("ollama");
    expect(registry.getApiKey("unknown")).toBeUndefined();
  });

  test("malformed JSON returns empty registry + populated loadError", () => {
    writeFileSync(modelsJsonPath, "not-json{{{{{");
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.list()).toEqual([]);
    expect(registry.loadErrors.length).toBe(1);
    expect(registry.loadErrors[0]).toContain("invalid JSON");
  });

  test("schema validation surfaces field-level issues", () => {
    writeModelsJson({
      providers: {
        ollama: {
          // missing baseUrl
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.list()).toEqual([]);
    expect(registry.loadErrors.length).toBe(1);
    expect(registry.loadErrors[0]).toContain("schema validation failed");
  });

  test("schema validation rejects missing models array", () => {
    writeModelsJson({
      providers: {
        ollama: { baseUrl: "http://localhost:11434/v1", apiKey: "ollama" },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.loadErrors.length).toBe(1);
    expect(registry.loadErrors[0]).toContain("schema validation failed");
  });

  test("rejects reserved provider names (pi-ai built-ins)", () => {
    writeModelsJson({
      providers: {
        openai: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "sneaky-override" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.find("openai", "sneaky-override")).toBeUndefined();
    expect(registry.loadErrors.length).toBe(1);
    expect(registry.loadErrors[0]).toContain("reserved built-in");
  });

  test("rejects reserved `custom` as a provider name", () => {
    writeModelsJson({
      providers: {
        custom: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "x",
          models: [{ id: "model" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.loadErrors[0]).toContain("reserved built-in");
  });

  test("rejects uppercase provider names", () => {
    writeModelsJson({
      providers: {
        MyProvider: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "x",
          models: [{ id: "model" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.list()).toEqual([]);
    expect(registry.loadErrors[0]).toContain("lowercase alphanumerics");
  });

  test("hasProvider reports registered custom providers", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.hasProvider("ollama")).toBe(true);
    expect(registry.hasProvider("vllm")).toBe(false);
  });

  test("loads multiple providers and preserves them independently", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }],
        },
        vllm: {
          baseUrl: "http://vllm.internal:8000/v1",
          apiKey: "EMPTY",
          models: [{ id: "meta-llama/Llama-3.1-70B", contextWindow: 131072 }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.loadErrors).toEqual([]);
    expect(registry.list()).toEqual([
      { provider: "ollama", model: "qwen3:8b" },
      { provider: "vllm", model: "meta-llama/Llama-3.1-70B" },
    ]);
  });

  // Model-level compat override must survive on Ollama, where
  // provider-level compat is always non-nullish due to auto-detect.
  test("model-level compat overrides provider-level on Ollama", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          // Provider declares qwen-chat-template for every model by default.
          compat: { thinkingFormat: "qwen-chat-template" },
          models: [
            // Model pins the legacy qwen pre-chat-template format.
            { id: "qwen3:8b", compat: { thinkingFormat: "qwen" } },
          ],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const model = registry.find("ollama", "qwen3:8b");
    expect(model).toBeDefined();
    expect((model!.compat as { thinkingFormat?: string }).thinkingFormat).toBe("qwen");
  });

  test("model-level compat merges with provider-level field-by-field on Ollama", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          // Provider sets supportsDeveloperRole only.
          compat: { supportsDeveloperRole: true },
          models: [
            // Model sets requiresToolResultName only.
            { id: "llama3.1:8b", compat: { requiresToolResultName: true } },
          ],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const model = registry.find("ollama", "llama3.1:8b");
    expect(model).toBeDefined();
    const compat = model!.compat as {
      supportsDeveloperRole?: boolean;
      requiresToolResultName?: boolean;
      supportsReasoningEffort?: boolean;
    };
    // Both provider-level and model-level fields survive.
    expect(compat.supportsDeveloperRole).toBe(true);
    expect(compat.requiresToolResultName).toBe(true);
    // Auto-detect fields still present.
    expect(compat.supportsReasoningEffort).toBe(false);
  });

  test("one invalid provider does not disqualify the rest", () => {
    writeModelsJson({
      providers: {
        openai: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "bad",
          models: [{ id: "shadow" }],
        },
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.find("ollama", "qwen3:8b")).toBeDefined();
    expect(registry.find("openai", "shadow")).toBeUndefined();
    expect(registry.loadErrors.length).toBe(1);
  });
});

// Exported predicate that runtime.buildAgentOptions uses to force
// thinkingLevel "off" for Qwen-on-Ollama, keeping the pi-ai contract intact.
// The regex must NOT match Alibaba DashScope cloud ids.
describe("shouldForceThinkingOff", () => {
  test("matches Qwen Ollama tags with a major-version digit", () => {
    expect(
      shouldForceThinkingOff({ id: "qwen3:8b", baseUrl: "http://localhost:11434/v1" }),
    ).toBe(true);
    expect(
      shouldForceThinkingOff({ id: "qwen2.5-coder:7b", baseUrl: "http://localhost:11434/v1" }),
    ).toBe(true);
    expect(
      shouldForceThinkingOff({ id: "qwen3:32b-chat", baseUrl: "http://127.0.0.1:11434/v1" }),
    ).toBe(true);
  });

  test("does NOT match DashScope cloud ids (no digit after `qwen`)", () => {
    // Even on an Ollama-looking base URL (LiteLLM proxy on :11434), these
    // DashScope ids never go through the chat-template path.
    expect(
      shouldForceThinkingOff({ id: "qwen-plus", baseUrl: "http://localhost:11434/v1" }),
    ).toBe(false);
    expect(
      shouldForceThinkingOff({ id: "qwen-max", baseUrl: "http://localhost:11434/v1" }),
    ).toBe(false);
    expect(
      shouldForceThinkingOff({ id: "qwen-coder", baseUrl: "http://localhost:11434/v1" }),
    ).toBe(false);
    expect(
      shouldForceThinkingOff({ id: "qwen-turbo", baseUrl: "http://localhost:11434/v1" }),
    ).toBe(false);
  });

  test("does NOT match Qwen on non-Ollama endpoints (vLLM, DashScope direct)", () => {
    expect(
      shouldForceThinkingOff({ id: "qwen3:8b", baseUrl: "http://vllm.internal:8000/v1" }),
    ).toBe(false);
    expect(
      shouldForceThinkingOff({
        id: "qwen3:8b",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      }),
    ).toBe(false);
  });

  test("does NOT match non-Qwen models on Ollama", () => {
    expect(
      shouldForceThinkingOff({ id: "llama3.1:8b", baseUrl: "http://localhost:11434/v1" }),
    ).toBe(false);
    expect(
      shouldForceThinkingOff({ id: "deepseek-r1:32b", baseUrl: "http://localhost:11434/v1" }),
    ).toBe(false);
  });
});

// The auto-opt-in model in the registry is the
// Ghost-side half of the contract. buildAgentOptions uses shouldForceThinkingOff
// to force `thinkingLevel: "off"` so pi-agent passes no reasoningEffort, and
// pi-ai's `!!reasoningEffort` coerces to `false` → `enable_thinking: false`.
describe("Qwen auto-opt-in end-to-end hand-off", () => {
  test("registered Qwen model reports as force-thinking-off target", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "qwen3:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const model = registry.find("ollama", "qwen3:8b");
    expect(model).toBeDefined();
    expect(model!.reasoning).toBe(true);
    expect((model!.compat as { thinkingFormat?: string }).thinkingFormat).toBe(
      "qwen-chat-template",
    );
    // Runtime picks this up to force thinkingLevel: "off".
    expect(
      shouldForceThinkingOff({ id: model!.id, baseUrl: model!.baseUrl ?? "" }),
    ).toBe(true);
  });

  test("non-Qwen Ollama model does NOT trigger thinking-off override", () => {
    writeModelsJson({
      providers: {
        ollama: {
          baseUrl: "http://localhost:11434/v1",
          apiKey: "ollama",
          models: [{ id: "llama3.1:8b" }],
        },
      },
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    const model = registry.find("ollama", "llama3.1:8b");
    expect(
      shouldForceThinkingOff({ id: model!.id, baseUrl: model!.baseUrl ?? "" }),
    ).toBe(false);
  });
});
