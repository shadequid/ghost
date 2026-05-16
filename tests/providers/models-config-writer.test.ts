import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  readModelsConfig,
  upsertCustomProvider,
} from "../../src/providers/models-config-writer.js";
import { loadCustomModelRegistry } from "../../src/providers/models-config.js";

let workDir: string;
let modelsJsonPath: string;

beforeEach(() => {
  workDir = join(tmpdir(), `ghost-models-writer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(workDir, { recursive: true });
  modelsJsonPath = join(workDir, "sub", "models.json");
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe("readModelsConfig", () => {
  test("returns kind=missing when file absent", () => {
    const result = readModelsConfig(modelsJsonPath);
    expect(result.kind).toBe("missing");
  });

  test("returns kind=malformed on broken JSON (caller decides policy)", () => {
    mkdirSync(join(workDir, "sub"), { recursive: true });
    writeFileSync(modelsJsonPath, "not-json");
    const result = readModelsConfig(modelsJsonPath);
    expect(result.kind).toBe("malformed");
    if (result.kind === "malformed") {
      expect(result.reason).toContain("invalid JSON");
    }
  });

  test("returns kind=malformed on schema failure (not missing)", () => {
    mkdirSync(join(workDir, "sub"), { recursive: true });
    writeFileSync(
      modelsJsonPath,
      JSON.stringify({
        providers: {
          ollama: {
            // missing baseUrl — violates schema
            apiKey: "ollama",
            models: [{ id: "qwen3:8b" }],
          },
        },
      }),
    );
    const result = readModelsConfig(modelsJsonPath);
    expect(result.kind).toBe("malformed");
    if (result.kind === "malformed") {
      expect(result.reason).toContain("schema validation failed");
    }
  });

  test("returns kind=ok with parsed config on a valid file", () => {
    mkdirSync(join(workDir, "sub"), { recursive: true });
    writeFileSync(
      modelsJsonPath,
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
    const result = readModelsConfig(modelsJsonPath);
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.data.providers.ollama?.models?.[0]?.id).toBe("qwen3:8b");
    }
  });
});

describe("upsertCustomProvider", () => {
  test("creates file (and parent directories) when missing", () => {
    expect(existsSync(modelsJsonPath)).toBe(false);
    const result = upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });
    expect(existsSync(modelsJsonPath)).toBe(true);
    expect(result.providers.ollama?.baseUrl).toBe("http://localhost:11434/v1");
    expect(result.providers.ollama?.apiKey).toBe("ollama");
    expect(result.providers.ollama?.models[0]?.id).toBe("qwen3:8b");
  });

  test("auto-applies Ollama compat defaults on first write", () => {
    const result = upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });
    expect(result.providers.ollama?.compat).toEqual({
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    });
  });

  test("does not auto-apply Ollama compat for non-Ollama endpoints", () => {
    const result = upsertCustomProvider(modelsJsonPath, {
      providerName: "vllm",
      baseUrl: "http://vllm.internal:8000/v1",
      modelId: "meta-llama/Llama-3.1-70B",
      apiKey: "EMPTY",
    });
    expect(result.providers.vllm?.compat).toBeUndefined();
  });

  test("preserves unrelated providers when upserting", () => {
    mkdirSync(join(workDir, "sub"), { recursive: true });
    writeFileSync(
      modelsJsonPath,
      JSON.stringify({
        providers: {
          vllm: {
            baseUrl: "http://vllm.internal:8000/v1",
            apiKey: "EMPTY",
            models: [{ id: "meta-llama/Llama-3.1-70B" }],
          },
        },
      }),
    );

    const result = upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });

    expect(result.providers.vllm?.models[0]?.id).toBe("meta-llama/Llama-3.1-70B");
    expect(result.providers.ollama?.models[0]?.id).toBe("qwen3:8b");
  });

  test("appends a new model to an existing provider", () => {
    upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });
    const result = upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "llama3.1:8b",
      apiKey: "ollama",
    });
    const ids = result.providers.ollama?.models.map((m) => m.id);
    expect(ids).toEqual(["qwen3:8b", "llama3.1:8b"]);
  });

  test("upsert on same model id replaces without duplicating", () => {
    upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });
    const result = upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      modelName: "Qwen 3 8B",
      apiKey: "ollama",
    });
    expect(result.providers.ollama?.models.length).toBe(1);
    expect(result.providers.ollama?.models[0]?.name).toBe("Qwen 3 8B");
  });

  test("preserves existing apiKey when not supplied on subsequent upsert", () => {
    upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });
    const result = upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "llama3.1:8b",
    });
    expect(result.providers.ollama?.apiKey).toBe("ollama");
  });

  test("persisted file is valid for the registry reader", () => {
    upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });
    const registry = loadCustomModelRegistry(modelsJsonPath);
    expect(registry.loadErrors).toEqual([]);
    expect(registry.find("ollama", "qwen3:8b")?.baseUrl).toBe("http://localhost:11434/v1");
  });

  test("output ends with a trailing newline (POSIX-friendly)", () => {
    upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });
    const content = readFileSync(modelsJsonPath, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
  });

  test("persists file with 0o600 permissions on create", () => {
    upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      apiKey: "sk-secret-sample",
    });
    const mode = statSync(modelsJsonPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("persists file with 0o600 permissions on subsequent upsert", () => {
    upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });
    upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "llama3.1:8b",
    });
    const mode = statSync(modelsJsonPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("throws on malformed file instead of clobbering it", () => {
    mkdirSync(join(workDir, "sub"), { recursive: true });
    writeFileSync(modelsJsonPath, "{ not valid json");
    expect(() =>
      upsertCustomProvider(modelsJsonPath, {
        providerName: "ollama",
        baseUrl: "http://localhost:11434/v1",
        modelId: "qwen3:8b",
        apiKey: "ollama",
      }),
    ).toThrow(/Refusing to overwrite malformed models\.json/);
    // Untouched on disk — original bytes remain.
    expect(readFileSync(modelsJsonPath, "utf-8")).toBe("{ not valid json");
  });

  test("throws on schema-invalid file (preserves hand-edited providers)", () => {
    mkdirSync(join(workDir, "sub"), { recursive: true });
    const original = JSON.stringify({
      providers: {
        // missing required baseUrl on purpose
        vllm: { apiKey: "x", models: [{ id: "m" }] },
      },
    });
    writeFileSync(modelsJsonPath, original);
    expect(() =>
      upsertCustomProvider(modelsJsonPath, {
        providerName: "ollama",
        baseUrl: "http://localhost:11434/v1",
        modelId: "qwen3:8b",
        apiKey: "ollama",
      }),
    ).toThrow(/Refusing to overwrite malformed models\.json/);
    expect(readFileSync(modelsJsonPath, "utf-8")).toBe(original);
  });

  test("cleans up tmp file on successful write (atomic rename)", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    upsertCustomProvider(modelsJsonPath, {
      providerName: "ollama",
      baseUrl: "http://localhost:11434/v1",
      modelId: "qwen3:8b",
      apiKey: "ollama",
    });
    // No .tmp files remain on disk after a successful write.
    const siblings = fs.readdirSync(dirname(modelsJsonPath));
    expect(siblings.some((name) => name.includes(".tmp"))).toBe(false);
  });
});
