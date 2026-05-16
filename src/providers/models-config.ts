/**
 * Custom providers registry backed by `~/.ghost/models.json`.
 *
 * Lets users define OpenAI-compatible endpoints (Ollama, vLLM, LM Studio,
 * proxies) without modifying Ghost code. The schema mirrors pi-mono's
 * coding-agent `models.json` so users can copy-paste between tools.
 *
 * MVP scope:
 *   - Custom providers with custom models (no OAuth, no shell-cmd key resolver).
 *   - Users cannot shadow a pi-ai built-in provider (reserved names rejected).
 *   - API key resolution supports literal strings only (env/shell deferred).
 *
 * See /docs/CUSTOM_MODELS.md for end-user usage.
 */

import { existsSync, readFileSync } from "node:fs";
import type { Api, KnownProvider, Model, OpenAICompletionsCompat } from "@mariozechner/pi-ai";
import { getProviders } from "@mariozechner/pi-ai";
import { z } from "zod";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Schema (Zod — matches Ghost style; pi-mono uses TypeBox/Ajv)
// ---------------------------------------------------------------------------

/**
 * Partial `OpenAICompletionsCompat` schema. Any unknown fields are preserved
 * via `.passthrough()` so users can specify advanced knobs we do not enumerate.
 */
const compatSchema = z
  .object({
    supportsStore: z.boolean().optional(),
    supportsDeveloperRole: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
    supportsUsageInStreaming: z.boolean().optional(),
    maxTokensField: z.enum(["max_completion_tokens", "max_tokens"]).optional(),
    requiresToolResultName: z.boolean().optional(),
    requiresAssistantAfterToolResult: z.boolean().optional(),
    requiresThinkingAsText: z.boolean().optional(),
    thinkingFormat: z.enum(["openai", "openrouter", "zai", "qwen", "qwen-chat-template"]).optional(),
    supportsStrictMode: z.boolean().optional(),
  })
  .passthrough();

const costSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
});

const modelDefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.enum(["text", "image"])).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  cost: costSchema.optional(),
  compat: compatSchema.optional(),
});

const providerConfigSchema = z.object({
  baseUrl: z.string().min(1),
  api: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  compat: compatSchema.optional(),
  models: z.array(modelDefSchema).min(1),
});

export const modelsConfigSchema = z.object({
  providers: z.record(z.string(), providerConfigSchema),
});

export type ModelsConfigFile = z.infer<typeof modelsConfigSchema>;
export type ModelDefInput = z.infer<typeof modelDefSchema>;
export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const DEFAULT_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;
const DEFAULT_API: Api = "openai-completions";
const DEFAULT_INPUT: readonly ("text" | "image")[] = ["text"];

/**
 * Matches `http(s)://<host>:11434(/...)?` anchored at the URL start so
 * substrings like `http://evil.test/cb?url=http://localhost:11434` don't
 * falsely trip Ollama compat. Used by both the reader (compat defaults) and
 * the writer (auto-stamp defaults on first write) so the two sides stay in
 * sync.
 */
export function isOllamaEndpoint(baseUrl: string): boolean {
  return /^https?:\/\/[^/:]+:11434(\/|$)/u.test(baseUrl);
}

/**
 * Provider names that must not be shadowed by a custom registry entry.
 *
 * Single source of truth — imported by the wizard's input validation so the
 * two paths (load-time enforcement + wizard acceptance) cannot drift if pi-ai
 * adds new built-ins.
 */
export function getReservedProviderNames(): ReadonlySet<string> {
  // Always include claude-cli + custom which Ghost surfaces in the wizard but
  // aren't in pi-ai's registry. `custom` remains valid as a wizard selection,
  // but users should pick a real provider name in models.json.
  const builtins = new Set<string>(getProviders());
  builtins.add("claude-cli");
  builtins.add("custom");
  return builtins;
}

/** Whether a provider name clashes with a reserved built-in. */
export function isReservedProviderName(name: string): boolean {
  return getReservedProviderNames().has(name);
}

/** Provider-name regex shared between wizard validation and load-time enforcement. */
export const PROVIDER_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/u;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface CustomProviderEntry {
  readonly provider: string;
  readonly model: string;
}

export interface CustomModelRegistry {
  /** Resolve a custom model by `provider` + `modelId`. */
  find(provider: string, modelId: string): Model<Api> | undefined;
  /** Literal API key configured in models.json (or `undefined` if none). */
  getApiKey(provider: string): string | undefined;
  /** Whether a provider is declared in models.json. */
  hasProvider(provider: string): boolean;
  /** List of all `{provider, model}` pairs for `ghost providers` CLI. */
  list(): CustomProviderEntry[];
  /** Diagnostic errors surfaced by `ghost doctor`. Empty if registry loaded cleanly. */
  loadErrors: readonly string[];
}

export interface LoadOptions {
  readonly logger?: Logger;
}

/**
 * Inert registry for call sites that genuinely need a registry instance but
 * have no custom-provider configuration — typically tests. Prefer this over
 * `as never` / ad-hoc stubs so the contract stays uniform.
 *
 * Production code must pass `runtime.customModelRegistry` so Ollama / vLLM /
 * LM Studio apiKeys resolve. Passing this constant from production would
 * silently regress custom-provider support.
 */
export const EMPTY_CUSTOM_MODEL_REGISTRY: CustomModelRegistry = {
  find: () => undefined,
  getApiKey: () => undefined,
  hasProvider: () => false,
  list: () => [],
  loadErrors: [],
};

/**
 * Load `~/.ghost/models.json` into an immutable registry.
 *
 * Graceful by design:
 *   - Missing file returns an empty registry with no errors.
 *   - Malformed JSON / schema errors return an empty registry plus `loadErrors`
 *     so `ghost doctor` can surface them.
 *
 * The registry is read-only after construction; callers that want refresh
 * semantics should rebuild via `loadCustomModelRegistry`.
 */
export function loadCustomModelRegistry(
  path: string,
  options: LoadOptions = {},
): CustomModelRegistry {
  const logger = options.logger;

  if (!existsSync(path)) {
    return createRegistry([], new Map(), []);
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    const message = `models.json: failed to read (${describeError(err)}): ${path}`;
    logger?.warn({ err, path }, "models.json unreadable");
    return createRegistry([], new Map(), [message]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = `models.json: invalid JSON (${describeError(err)}): ${path}`;
    logger?.warn({ err, path }, "models.json not valid JSON");
    return createRegistry([], new Map(), [message]);
  }

  const result = modelsConfigSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("\n");
    const message = `models.json: schema validation failed:\n${details}\nFile: ${path}`;
    logger?.warn({ issues: result.error.issues, path }, "models.json schema invalid");
    return createRegistry([], new Map(), [message]);
  }

  const reserved = getReservedProviderNames();
  const errors: string[] = [];
  const models: Model<Api>[] = [];
  const apiKeys = new Map<string, string>();

  for (const [providerName, providerConfig] of Object.entries(result.data.providers)) {
    if (reserved.has(providerName)) {
      errors.push(
        `models.json: provider "${providerName}" collides with a reserved built-in. Pick a distinct name.`,
      );
      continue;
    }

    if (!isValidProviderName(providerName)) {
      errors.push(
        `models.json: provider name "${providerName}" must be lowercase alphanumerics + hyphens.`,
      );
      continue;
    }

    const baseUrl = normalizeBaseUrl(providerConfig.baseUrl);
    const api = (providerConfig.api ?? DEFAULT_API) as Api;
    const providerCompat = mergeAutoDetectedCompat(baseUrl, providerConfig.compat);

    if (providerConfig.apiKey) {
      apiKeys.set(providerName, providerConfig.apiKey);
    }

    for (const modelDef of providerConfig.models) {
      // Merge provider-level and model-level compat — model-level wins
      // field-by-field. Previous `ctx.compat ?? def.compat` silently
      // dropped per-model overrides on Ollama because mergeAutoDetectedCompat
      // always returns a non-nullish object there, so `??` never consulted the
      // model-level entry.
      const effectiveCompat = mergeCompat(providerCompat, modelDef.compat);
      models.push(buildModel(providerName, modelDef, { baseUrl, api, compat: effectiveCompat }));
    }
  }

  return createRegistry(models, apiKeys, errors);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRegistry(
  models: Model<Api>[],
  apiKeys: Map<string, string>,
  loadErrors: string[],
): CustomModelRegistry {
  const frozen = Object.freeze(loadErrors.slice());
  return {
    find(provider, modelId) {
      return models.find((m) => m.provider === provider && m.id === modelId);
    },
    getApiKey(provider) {
      return apiKeys.get(provider);
    },
    hasProvider(provider) {
      return apiKeys.has(provider) || models.some((m) => m.provider === provider);
    },
    list() {
      return models.map((m) => ({ provider: m.provider, model: m.id }));
    },
    loadErrors: frozen,
  };
}

interface ModelContext {
  readonly baseUrl: string;
  readonly api: Api;
  readonly compat?: Model<Api>["compat"];
}

function buildModel(
  providerName: string,
  def: ModelDefInput,
  ctx: ModelContext,
): Model<Api> {
  const needsQwenThinkingOff = shouldForceThinkingOff({ id: def.id, baseUrl: ctx.baseUrl });

  // Fragile cross-package contract warning.
  //
  // The line below (`reasoning: true` + no `reasoningEffort` at call-time)
  // is load-bearing and relies on pi-ai's current behavior in
  // `packages/ai/src/providers/openai-completions.ts:407-412`:
  //
  //   } else if (compat.thinkingFormat === "qwen-chat-template" && model.reasoning) {
  //       (params as any).chat_template_kwargs = { enable_thinking: !!options?.reasoningEffort };
  //   }
  //
  // We want `enable_thinking: false`, so we need `!!options?.reasoningEffort`
  // to coerce to `false`. That only happens when `reasoningEffort` is
  // `undefined` — i.e. the caller passes `thinkingLevel === "off"` down to
  // pi-agent (see `runtime.ts:buildAgentOptions`, which force-overrides to
  // "off" for Qwen-on-Ollama models via `shouldForceThinkingOff`).
  //
  // If pi-ai changes the `!!reasoningEffort` semantics (e.g. to
  // `!reasoningEffort || reasoningEffort === "off"`), this fix silently
  // inverts and Qwen thinking stays ON on every default install. There is
  // no outbound-payload test in Ghost guarding this contract because
  // capturing the HTTP body is intrusive to add.
  //
  // If you upgrade pi-ai, re-read that file and confirm the branch still
  // sends `enable_thinking: !!reasoningEffort`. A `grep "enable_thinking"`
  // in node_modules after the bump is a cheap sanity check.
  const reasoning = def.reasoning ?? (needsQwenThinkingOff ? true : false);
  const compat = mergeQwenCompat(ctx.compat, needsQwenThinkingOff);

  return {
    id: def.id,
    name: def.name ?? def.id,
    api: ctx.api,
    provider: providerName as KnownProvider,
    baseUrl: ctx.baseUrl,
    reasoning,
    input: (def.input ?? DEFAULT_INPUT) as ("text" | "image")[],
    cost: def.cost ?? { ...DEFAULT_COST },
    contextWindow: def.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: def.maxTokens ?? DEFAULT_MAX_TOKENS,
    compat,
  };
}

/**
 * True for model ids like `qwen3:8b`, `qwen2.5-coder:7b`, `qwen:32b-chat`.
 *
 * The digit after `qwen` is **required** (not `\d?`) so that
 * Alibaba DashScope cloud ids (`qwen-plus`, `qwen-max`, `qwen-coder`,
 * `qwen-turbo`) don't match. Those use the DashScope Messages API, not the
 * Ollama chat-template path, so `chat_template_kwargs` would be rejected.
 *
 * The `isOllamaEndpoint` port-11434 check is the primary guard — but if a
 * user proxies DashScope on port 11434 (e.g. LiteLLM bound to Ollama's port
 * for local-compat), the id check is the last line of defense. We accept a
 * small scope trade-off: `qwen:latest` (no major-version digit) no longer
 * matches. That tag isn't in common Ollama use; users who need it can set
 * `reasoning: true` + `compat.thinkingFormat: "qwen-chat-template"`
 * explicitly in `models.json`.
 */
function isQwenModelId(id: string): boolean {
  return /^qwen\d(\.\d+)?[-:]/iu.test(id);
}

/**
 * Detect a Qwen model served over a local Ollama endpoint so Ghost can
 * force `thinkingLevel: "off"` at agent-options build time.
 *
 * Used by both `buildModel` (to auto-stamp `reasoning: true` +
 * `thinkingFormat: "qwen-chat-template"`) and by `runtime.buildAgentOptions`
 * (to override `config.agent.thinkingLevel` for the single matching call).
 * Keeping one predicate keeps the two sides in lockstep — if either check
 * fires, the other must also, otherwise the pi-ai contract drops back to
 * `enable_thinking: true`.
 */
export function shouldForceThinkingOff(model: {
  id: string;
  baseUrl: string;
}): boolean {
  return isQwenModelId(model.id) && isOllamaEndpoint(model.baseUrl);
}

/**
 * Merge two `compat` objects with model-level fields winning over
 * provider-level — previously the code used
 * `ctx.compat ?? def.compat` which silently dropped per-model overrides on
 * Ollama because `mergeAutoDetectedCompat` always returns a non-nullish
 * object there.
 *
 * Mirrors pi-mono's `mergeCompat` helper in
 * `packages/coding-agent/src/core/model-registry.ts:168`.
 */
function mergeCompat(
  base: Model<Api>["compat"] | undefined,
  override: Model<Api>["compat"] | undefined,
): Model<Api>["compat"] | undefined {
  if (!override) return base;
  if (!base) return override;
  return { ...(base as OpenAICompletionsCompat), ...(override as OpenAICompletionsCompat) } as Model<Api>["compat"];
}

/**
 * When serving Qwen via Ollama, inject `thinkingFormat: "qwen-chat-template"`
 * so pi-ai emits `chat_template_kwargs: { enable_thinking: false }`. User-set
 * fields always win.
 */
function mergeQwenCompat(
  existing: Model<Api>["compat"] | undefined,
  enable: boolean,
): Model<Api>["compat"] | undefined {
  if (!enable) return existing;
  const base = (existing ?? {}) as OpenAICompletionsCompat;
  if (base.thinkingFormat) return existing;
  return { ...base, thinkingFormat: "qwen-chat-template" } as Model<Api>["compat"];
}

/**
 * Append `/v1` if missing — matches OpenAI SDK expectation and pi-mono behavior.
 * Trailing slashes are preserved after normalization.
 */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.replace(/\/+$/u, "");
  if (/\/v\d+$/u.test(trimmed)) return trimmed;
  return `${trimmed}/v1`;
}

/**
 * When the user didn't specify compat hints, default Ollama-on-localhost to
 * disable `developer` role + `reasoning_effort` — otherwise pi-ai sends
 * requests Ollama rejects. Users can override any field.
 */
function mergeAutoDetectedCompat(
  baseUrl: string,
  userCompat: z.infer<typeof compatSchema> | undefined,
): Model<Api>["compat"] | undefined {
  if (!isOllamaEndpoint(baseUrl)) {
    return userCompat as Model<Api>["compat"] | undefined;
  }
  const defaults: Partial<OpenAICompletionsCompat> = {
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
  };
  const merged = { ...defaults, ...(userCompat ?? {}) };
  return merged as Model<Api>["compat"];
}

function isValidProviderName(name: string): boolean {
  return PROVIDER_NAME_REGEX.test(name);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
