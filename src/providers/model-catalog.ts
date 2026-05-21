/**
 * Curated overlay of pi-ai's raw model catalog. Hides retired, deprecated,
 * and redundant-snapshot model IDs from every user-facing picker in Ghost.
 *
 * Maintenance: when bumping @earendil-works/pi-ai, re-verify each provider's
 * retired list against its official deprecation page. Add a
 * `// verified: YYYY-MM-DD` comment next to each provider block so future
 * contributors know when it was last checked. Aggregator and no-schedule
 * entries stay empty unless new upstream deprecation pages emerge.
 */

/**
 * Matches trailing dated snapshot suffixes across providers:
 * - Anthropic YYYYMMDD:   `claude-opus-4-5-20251101`
 * - OpenAI   YYYY-MM-DD:  `gpt-4o-2024-05-13`
 * - Mistral  YYMM:         `mistral-large-2411`
 * - DeepSeek MMDD:         `deepseek-r1-0528` (intentional; see below)
 *
 * Anchored to `$` so it only matches at end of ID. Non-date suffixes like
 * `-non-reasoning`, `-it`, `-12b`, `-4-6` are NOT matched.
 *
 * The Mistral `-\d{4}` branch also matches DeepSeek MMDD checkpoints. This is
 * intentional: `filterModelCatalog` only dedups a dated suffix when the bare
 * alias is ALSO in the list. Users who want a specific checkpoint type it in
 * `config.json` manually — the filter only restricts picker surface.
 */
const DATED_SNAPSHOT_RE = /(-20\d{6}|-20\d{2}-\d{2}-\d{2}|-\d{4})$/;

/** Returns ID with a trailing dated-snapshot suffix removed, or the original ID if no suffix matches. */
export function stripDatedSuffix(id: string): string {
  return id.replace(DATED_SNAPSHOT_RE, "");
}

/**
 * Strips the cosmetic trailing ` (latest)` tag from a display name. pi-ai
 * decorates Anthropic alias entries with "(latest)" in the `name` field
 * (e.g. "Claude Haiku 4.5 (latest)"); Mistral does the same for its
 * `-latest` IDs. The tag is redundant in Ghost's picker — the model ID
 * either IS the current alias or isn't.
 *
 * Only matches the parenthesized form. IDs like `gpt-5-chat-latest`
 * (whose real name is "GPT-5 Chat Latest" without parens) are preserved —
 * "Latest" there is part of the model's canonical identity.
 */
export function stripLatestLabel(name: string): string {
  return name.replace(/\s*\(latest\)\s*$/iu, "");
}

export interface RetiredModelEntry {
  /**
   * ISO date the provider stops serving this model. For alias entries (e.g.
   * `claude-opus-4-0` that points to a deprecated snapshot), this is the
   * underlying snapshot's retirement date.
   */
  retireDate?: string;
  /** Suggested current ID on the same provider. */
  replacement?: string;
  /** Optional human note (e.g. "alias of retired snapshot"). */
  reason?: string;
}

const RETIRED_MODELS: Readonly<Record<string, Readonly<Record<string, RetiredModelEntry>>>> = {
  // verified: 2026-04-24 — https://platform.claude.com/docs/en/docs/about-claude/model-deprecations
  anthropic: {
    "claude-3-haiku-20240307": { retireDate: "2026-04-20", replacement: "claude-haiku-4-5-20251001" },
    "claude-3-sonnet-20240229": { retireDate: "2025-07-21", replacement: "claude-sonnet-4-6" },
    "claude-3-opus-20240229": { retireDate: "2026-01-05", replacement: "claude-opus-4-7" },
    "claude-3-5-sonnet-20240620": { retireDate: "2025-10-28", replacement: "claude-sonnet-4-6" },
    "claude-3-5-sonnet-20241022": { retireDate: "2025-10-28", replacement: "claude-sonnet-4-6" },
    "claude-3-5-haiku-20241022": { retireDate: "2026-02-19", replacement: "claude-haiku-4-5-20251001" },
    "claude-3-5-haiku-latest": { retireDate: "2026-02-19", replacement: "claude-haiku-4-5", reason: "alias of retired snapshot" },
    "claude-3-7-sonnet-20250219": { retireDate: "2026-02-19", replacement: "claude-sonnet-4-6" },
    "claude-opus-4-20250514": { retireDate: "2026-06-15", replacement: "claude-opus-4-7" },
    "claude-opus-4-0": { retireDate: "2026-06-15", replacement: "claude-opus-4-7", reason: "alias of deprecated snapshot" },
    "claude-sonnet-4-20250514": { retireDate: "2026-06-15", replacement: "claude-sonnet-4-6" },
    "claude-sonnet-4-0": { retireDate: "2026-06-15", replacement: "claude-sonnet-4-6", reason: "alias of deprecated snapshot" },
  },
  // verified: 2026-04-24 — https://developers.openai.com/api/docs/deprecations
  openai: {
    "gpt-4-turbo": { retireDate: "2026-10-23", replacement: "gpt-4.1" },
    "gpt-4.1-nano": { retireDate: "2026-10-23", replacement: "gpt-5-nano" },
    "gpt-4o-2024-05-13": { retireDate: "2026-10-23", replacement: "gpt-4.1" },
  },
  // verified: 2026-04-24 — https://developers.openai.com/codex/models
  // No public EOL date: GPT-5.1 variants were pulled from ChatGPT backend on 2026-03-11
  // (already retired, not sunset-scheduled). gpt-5.2-codex is similarly absent from the
  // current supported list without a documented removal date.
  "openai-codex": {
    "gpt-5.1": { replacement: "gpt-5.4" },
    "gpt-5.1-codex-max": { replacement: "gpt-5.4" },
    "gpt-5.1-codex-mini": { replacement: "gpt-5.4-mini" },
    "gpt-5.2-codex": { replacement: "gpt-5.3-codex" },
  },
  // verified: 2026-04-24 — https://ai.google.dev/gemini-api/docs/deprecations + /models
  google: {
    "gemini-1.5-flash": { retireDate: "2025-09-29", replacement: "gemini-2.5-flash" },
    "gemini-1.5-flash-8b": { retireDate: "2025-09-29", replacement: "gemini-2.5-flash-lite" },
    "gemini-1.5-pro": { retireDate: "2025-09-29", replacement: "gemini-2.5-pro" },
    "gemini-2.0-flash": { replacement: "gemini-2.5-flash" },
    "gemini-2.0-flash-lite": { replacement: "gemini-2.5-flash-lite" },
    "gemini-2.5-flash-preview-04-17": { retireDate: "2025-07-15", replacement: "gemini-2.5-flash" },
    "gemini-2.5-flash-preview-05-20": { retireDate: "2025-11-18", replacement: "gemini-2.5-flash" },
    "gemini-2.5-flash-preview-09-2025": { retireDate: "2026-03-31", replacement: "gemini-3.1-flash-lite-preview" },
    "gemini-2.5-flash-lite-preview-06-17": { retireDate: "2025-11-18" },
    "gemini-2.5-flash-lite-preview-09-2025": { retireDate: "2026-03-31", replacement: "gemini-3.1-flash-lite-preview" },
    "gemini-2.5-pro-preview-05-06": { retireDate: "2025-06-26", replacement: "gemini-2.5-pro" },
    "gemini-2.5-pro-preview-06-05": { retireDate: "2025-12-02", replacement: "gemini-2.5-pro" },
    "gemini-3-pro-preview": { retireDate: "2026-03-09", replacement: "gemini-3.1-pro-preview" },
  },
  // verified: 2026-04-24 — subset of google.
  "google-gemini-cli": {
    "gemini-2.0-flash": { replacement: "gemini-2.5-flash" },
    "gemini-3-pro-preview": { retireDate: "2026-03-09", replacement: "gemini-3.1-pro-preview" },
  },
  // verified: 2026-04-24 — https://docs.mistral.ai/getting-started/models/models_overview/
  mistral: {
    "mistral-large-2411": { retireDate: "2026-05-31", replacement: "mistral-large-latest" },
    "devstral-small-2507": { retireDate: "2026-05-31", replacement: "devstral-2512" },
    "devstral-medium-2507": { retireDate: "2026-05-31", replacement: "devstral-2512" },
    "labs-devstral-small-2512": { retireDate: "2026-03-31", replacement: "devstral-2512" },
    "open-mixtral-8x7b": { retireDate: "2025-03-30", replacement: "mistral-small-latest" },
  },
  // verified: 2026-04-24 — https://inference-docs.cerebras.ai/models/llama-31-8b
  cerebras: {
    "llama3.1-8b": { retireDate: "2026-05-27" },
  },
  // verified: 2026-04-24 — https://console.groq.com/docs/deprecations
  groq: {
    "deepseek-r1-distill-llama-70b": { retireDate: "2025-10-02", replacement: "llama-3.3-70b-versatile" },
    "gemma2-9b-it": { retireDate: "2025-10-08", replacement: "llama-3.1-8b-instant" },
    "llama3-70b-8192": { retireDate: "2025-08-30", replacement: "llama-3.3-70b-versatile" },
    "llama3-8b-8192": { retireDate: "2025-08-30", replacement: "llama-3.1-8b-instant" },
    "meta-llama/llama-4-maverick-17b-128e-instruct": { retireDate: "2026-03-09", replacement: "openai/gpt-oss-120b" },
    "mistral-saba-24b": { retireDate: "2025-07-30", replacement: "qwen/qwen3-32b" },
    "moonshotai/kimi-k2-instruct": { retireDate: "2025-10-10", replacement: "openai/gpt-oss-120b" },
    "moonshotai/kimi-k2-instruct-0905": { retireDate: "2026-04-15", replacement: "openai/gpt-oss-120b" },
    "qwen-qwq-32b": { retireDate: "2025-07-14", replacement: "qwen/qwen3-32b" },
  },
  // verified: 2026-04-24 — https://docs.aws.amazon.com/bedrock/latest/userguide/model-lifecycle.html
  "amazon-bedrock": {
    "anthropic.claude-3-haiku-20240307-v1:0": { retireDate: "2026-09-10" },
    "anthropic.claude-3-5-sonnet-20240620-v1:0": { retireDate: "2026-07-30" },
    "anthropic.claude-3-5-sonnet-20241022-v2:0": { retireDate: "2026-07-30" },
    "anthropic.claude-3-7-sonnet-20250219-v1:0": { retireDate: "2026-04-28" },
    "anthropic.claude-3-5-haiku-20241022-v1:0": { retireDate: "2026-06-19" },
    "anthropic.claude-opus-4-20250514-v1:0": { retireDate: "2026-05-31" },
    "us.anthropic.claude-opus-4-20250514-v1:0": { retireDate: "2026-05-31" },
    "anthropic.claude-sonnet-4-20250514-v1:0": { retireDate: "2026-10-14" },
    "eu.anthropic.claude-sonnet-4-20250514-v1:0": { retireDate: "2026-10-14" },
    "global.anthropic.claude-sonnet-4-20250514-v1:0": { retireDate: "2026-10-14" },
    "us.anthropic.claude-sonnet-4-20250514-v1:0": { retireDate: "2026-10-14" },
    "meta.llama3-1-405b-instruct-v1:0": { retireDate: "2026-07-07" },
    "meta.llama3-2-1b-instruct-v1:0": { retireDate: "2026-07-07" },
    "meta.llama3-2-3b-instruct-v1:0": { retireDate: "2026-07-07" },
    "meta.llama3-2-11b-instruct-v1:0": { retireDate: "2026-07-07" },
    "meta.llama3-2-90b-instruct-v1:0": { retireDate: "2026-07-07" },
    "amazon.nova-premier-v1:0": { retireDate: "2026-09-14" },
  },
  // verified: 2026-04-24 — mirrors openai (Azure serves same model set)
  "azure-openai-responses": {
    "gpt-4-turbo": { retireDate: "2026-10-23", replacement: "gpt-4.1" },
    "gpt-4.1-nano": { retireDate: "2026-10-23", replacement: "gpt-5-nano" },
    "gpt-4o-2024-05-13": { retireDate: "2026-10-23", replacement: "gpt-4.1" },
  },
  // verified: 2026-04-24 — docs.cloud.google.com/vertex-ai/generative-ai/docs/{learn/model-versions, models/gemini/2-0-flash}
  // Editorial: 2.5-flash / 2.5-flash-lite / 2.5-pro (Oct 2026 retirement) kept visible — >90d runway + still production-recommended.
  "google-vertex": {
    "gemini-1.5-flash": { retireDate: "2025-09-29", replacement: "gemini-2.5-flash" },
    "gemini-1.5-flash-8b": { retireDate: "2025-09-29", replacement: "gemini-2.5-flash-lite" },
    "gemini-1.5-pro": { retireDate: "2025-09-29", replacement: "gemini-2.5-pro" },
    "gemini-2.0-flash": { retireDate: "2026-06-01", replacement: "gemini-2.5-flash" },
    "gemini-2.0-flash-lite": { retireDate: "2026-06-01", replacement: "gemini-2.5-flash-lite" },
    "gemini-2.5-flash-lite-preview-09-2025": { retireDate: "2026-03-31", replacement: "gemini-3.1-flash-lite-preview" },
    "gemini-3-pro-preview": { retireDate: "2026-03-09", replacement: "gemini-3.1-pro-preview" },
  },
  // verified: 2026-04-24 — https://docs.github.com/en/copilot/reference/ai-models/supported-models
  // No public EOL date for gpt-5 / gpt-5.1 entries: Copilot dropped them from the supported
  // list without a documented removal date. gemini-3-pro-preview has an upstream retirement
  // date we track.
  "github-copilot": {
    "gpt-5": { replacement: "gpt-5.2" },
    "gpt-5.1": { replacement: "gpt-5.2" },
    "gpt-5.1-codex": { replacement: "gpt-5.2-codex" },
    "gpt-5.1-codex-max": { replacement: "gpt-5.2-codex" },
    "gpt-5.1-codex-mini": { replacement: "gpt-5.2-codex" },
    "gemini-3-pro-preview": { retireDate: "2026-03-09", replacement: "gemini-3.1-pro-preview" },
  },
  // verified: 2026-04-24 — Z.AI deprecation notice 2026-04-20
  zai: {
    "glm-5": { retireDate: "2026-04-20", replacement: "glm-5.1" },
  },
  // Providers with empty catalog by design (aggregators, no-schedule, or current-gen-only).
  // Leaving entries here as explicit opt-in would require adding them to RETIRED_MODELS; absence is enough.
};

export function filterModelCatalog(
  providerId: string,
  models: readonly { id: string; name: string }[],
): { id: string; name: string }[] {
  const retired = RETIRED_MODELS[providerId] ?? {};
  // Pass 1: drop IDs listed in the retired catalog.
  const afterRetired = models.filter((m) => !(m.id in retired));

  // Pass 2: drop dated snapshots when a bare alias is present in the same list.
  // Snapshot dedup is provider-agnostic: works by string shape, not per-provider rules.
  const idSet = new Set(afterRetired.map((m) => m.id));
  const afterDedup = afterRetired.filter((m) => {
    const stripped = stripDatedSuffix(m.id);
    if (stripped === m.id) return true;            // no date suffix
    return !idSet.has(stripped);                   // keep only if bare alias absent
  });

  // Pass 3: strip cosmetic " (latest)" suffix from display names.
  return afterDedup.map((m) => ({ id: m.id, name: stripLatestLabel(m.name) }));
}

export function getRetiredEntry(
  providerId: string,
  modelId: string,
): RetiredModelEntry | undefined {
  return RETIRED_MODELS[providerId]?.[modelId];
}
