import { getProviders, getModels } from "@mariozechner/pi-ai";
import type { KnownProvider } from "@mariozechner/pi-ai";
import { getClaudeCliModels } from "../providers/claude-cli/models.js";
import { filterModelCatalog } from "../providers/model-catalog.js";

export interface ProviderInfo {
  id: string;
  label: string;
  description: string;
  tier: number;
  tierLabel: string;
  apiKeyUrl?: string;
  supportsOAuth: boolean;
}

const OAUTH_PROVIDERS = new Set(["anthropic", "openai-codex", "github-copilot", "google-gemini-cli", "google-antigravity"]);

const PROVIDER_META: Record<string, { label: string; description: string; tier: number; apiKeyUrl?: string }> = {
  "openrouter": { label: "OpenRouter", description: "200+ models, 1 API key (recommended)", tier: 0, apiKeyUrl: "https://openrouter.ai/keys" },
  "anthropic": { label: "Anthropic", description: "Claude Sonnet & Opus (direct)", tier: 0, apiKeyUrl: "https://console.anthropic.com/settings/keys" },
  "openai": { label: "OpenAI", description: "GPT-4o, GPT-5 (direct)", tier: 0, apiKeyUrl: "https://platform.openai.com/api-keys" },
  "openai-codex": { label: "OpenAI Codex", description: "ChatGPT subscription (OAuth, no API key)", tier: 0 },
  "claude-cli": { label: "Claude Code", description: "Use Claude Code subscription (no API key)", tier: 0 },
  "google": { label: "Google Gemini", description: "Gemini 2.0 Flash & Pro", tier: 0, apiKeyUrl: "https://aistudio.google.com/app/apikey" },
  "google-gemini-cli": { label: "Google Gemini CLI", description: "Gemini via CLI auth", tier: 0 },
  "xai": { label: "xAI", description: "Grok 3 & 4", tier: 0, apiKeyUrl: "https://console.x.ai" },
  "mistral": { label: "Mistral", description: "Large & Codestral", tier: 0, apiKeyUrl: "https://console.mistral.ai/api-keys" },
  "groq": { label: "Groq", description: "Ultra-fast LPU inference", tier: 1, apiKeyUrl: "https://console.groq.com/keys" },
  "cerebras": { label: "Cerebras", description: "Fast inference", tier: 1 },
  "amazon-bedrock": { label: "Amazon Bedrock", description: "AWS managed models", tier: 2 },
  "google-vertex": { label: "Google Vertex", description: "GCP managed models", tier: 2 },
  "azure-openai-responses": { label: "Azure OpenAI", description: "Azure managed models", tier: 2 },
  "github-copilot": { label: "GitHub Copilot", description: "Copilot subscription (OAuth)", tier: 3 },
  "google-antigravity": { label: "Antigravity", description: "Free models via Google Cloud", tier: 3 },
  "minimax": { label: "MiniMax", description: "International endpoint", tier: 3 },
  "minimax-cn": { label: "MiniMax CN", description: "China endpoint", tier: 3 },
  "kimi-coding": { label: "Kimi Coding", description: "Coding-optimized", tier: 3 },
  "huggingface": { label: "HuggingFace", description: "Open-source models", tier: 3 },
  "opencode": { label: "OpenCode", description: "Code-focused AI", tier: 3 },
  "opencode-go": { label: "OpenCode Go", description: "Subsidized code AI", tier: 3 },
  "zai": { label: "Z.AI", description: "Coding endpoint", tier: 3 },
  "vercel-ai-gateway": { label: "Vercel AI Gateway", description: "Vercel managed", tier: 3 },
};

const TIER_LABELS: Record<number, string> = {
  0: "⭐ Recommended",
  1: "⚡ Fast Inference",
  2: "☁️  Cloud / Enterprise",
  3: "🔬 Specialized",
  4: "🔧 Custom",
};

export function getProviderList(): ProviderInfo[] {
  const knownProviders = getProviders();
  const list: ProviderInfo[] = [];

  for (const id of knownProviders) {
    const meta = PROVIDER_META[id];
    if (meta) {
      list.push({
        id,
        label: meta.label,
        description: meta.description,
        tier: meta.tier,
        tierLabel: TIER_LABELS[meta.tier] ?? "Other",
        apiKeyUrl: meta.apiKeyUrl,
        supportsOAuth: OAUTH_PROVIDERS.has(id),
      });
    } else {
      list.push({
        id,
        label: id,
        description: "",
        tier: 3,
        tierLabel: TIER_LABELS[3] ?? "Other",
        supportsOAuth: OAUTH_PROVIDERS.has(id),
      });
    }
  }

  // Add claude-cli option (not in pi-ai registry)
  list.push({
    id: "claude-cli",
    label: "Claude Code",
    description: "Use Claude Code subscription (no API key)",
    tier: 0,
    tierLabel: TIER_LABELS[0] ?? "Other",
    supportsOAuth: false,
  });

  // Add custom option
  list.push({
    id: "custom",
    label: "Custom",
    description: "Bring your own OpenAI-compatible endpoint (Ollama, vLLM, LM Studio)",
    tier: 4,
    tierLabel: TIER_LABELS[4] ?? "Other",
    supportsOAuth: false,
  });

  // Preferred providers shown first in explicit order
  const PREFERRED_ORDER = [
    "anthropic",
    "openai",
    "openai-codex",
    "google",
    "google-gemini-cli",
    "google-antigravity",
  ];

  list.sort((a, b) => {
    const aIdx = PREFERRED_ORDER.indexOf(a.id);
    const bIdx = PREFERRED_ORDER.indexOf(b.id);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.tier - b.tier || a.label.localeCompare(b.label);
  });

  return list;
}

export function getModelList(providerId: string): Array<{ id: string; name: string }> {
  // Claude CLI — fixed model list (not in pi-ai registry); bypasses filter.
  if (providerId === "claude-cli") {
    return getClaudeCliModels();
  }

  try {
    const raw = getModels(providerId as KnownProvider).map((m) => ({ id: m.id, name: m.name || m.id }));
    return filterModelCatalog(providerId, raw);
  } catch {
    return [];
  }
}
