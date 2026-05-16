/**
 * Claude CLI model factory and known-model registry.
 */

import type { Api, Model } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Model registry
// ---------------------------------------------------------------------------

const KNOWN_MODELS: Record<string, { name: string; contextWindow: number; maxTokens: number; reasoning: boolean }> = {
  "claude-opus-4-7": { name: "Claude Opus 4.7", contextWindow: 1_000_000, maxTokens: 128_000, reasoning: false },
  "claude-sonnet-4-6": { name: "Claude Sonnet 4.6", contextWindow: 200_000, maxTokens: 16_384, reasoning: true },
  "claude-opus-4-6": { name: "Claude Opus 4.6", contextWindow: 200_000, maxTokens: 16_384, reasoning: true },
  "claude-haiku-4-5": { name: "Claude Haiku 4.5", contextWindow: 200_000, maxTokens: 8_192, reasoning: false },
  // Shortcuts retained for backwards compat — users with `"model": "sonnet"` in config.json still resolve.
  // Not surfaced in `getClaudeCliModels()` picker list.
  "sonnet": { name: "Claude Sonnet (latest)", contextWindow: 200_000, maxTokens: 16_384, reasoning: true },
  "opus": { name: "Claude Opus (latest)", contextWindow: 200_000, maxTokens: 16_384, reasoning: true },
  "haiku": { name: "Claude Haiku (latest)", contextWindow: 200_000, maxTokens: 8_192, reasoning: false },
};

const DEFAULT_SPECS = { contextWindow: 200_000, maxTokens: 16_384, reasoning: true };

export function createClaudeCliModel(modelId: string): Model<Api> {
  const known = KNOWN_MODELS[modelId];
  return {
    id: modelId,
    name: known?.name ?? `Claude Code (${modelId})`,
    api: "claude-cli" as Api,
    provider: "claude-cli",
    baseUrl: "",
    reasoning: known?.reasoning ?? DEFAULT_SPECS.reasoning,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: known?.contextWindow ?? DEFAULT_SPECS.contextWindow,
    maxTokens: known?.maxTokens ?? DEFAULT_SPECS.maxTokens,
  };
}

export function getClaudeCliModels(): Array<{ id: string; name: string }> {
  return [
    { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
  ];
}
