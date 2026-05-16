import { getProviderList, getModelList } from "./providers.js";
import { loadCustomModelRegistry } from "../providers/models-config.js";
import { getModelsConfigPath } from "../config/paths.js";

/** A provider does NOT require an API key if it uses OAuth or CLI-based auth. */
function requiresApiKey(provider: { id: string; supportsOAuth: boolean }): boolean {
  if (provider.id === "claude-cli") return false;
  if (provider.supportsOAuth) return false;
  return true;
}

interface ProviderRow {
  id: string;
  label: string;
  description: string;
  requiresApiKey: boolean;
  supportsOAuth: boolean;
  apiKeyUrl: string | null;
  /** True when the provider was loaded from ~/.ghost/models.json. */
  custom?: boolean;
}

export function listProviders(): void {
  const builtIn: ProviderRow[] = getProviderList().map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    requiresApiKey: requiresApiKey(p),
    supportsOAuth: p.supportsOAuth,
    apiKeyUrl: p.apiKeyUrl ?? null,
  }));

  // Inject custom providers from ~/.ghost/models.json so `ghost providers`
  // reflects the same set of providers Ghost will actually resolve.
  const customRegistry = loadCustomModelRegistry(getModelsConfigPath());
  const customNames = new Set(customRegistry.list().map((e) => e.provider));
  const custom: ProviderRow[] = Array.from(customNames).map((name) => ({
    id: name,
    label: name,
    description: "Custom provider (from ~/.ghost/models.json)",
    requiresApiKey: true,
    supportsOAuth: false,
    apiKeyUrl: null,
    custom: true,
  }));

  console.log(JSON.stringify([...builtIn, ...custom], null, 2));
}

export function listModels(providerId: string): void {
  // Resolve against custom registry first so users can inspect what's declared
  // in their models.json even for providers pi-ai doesn't know about.
  const customRegistry = loadCustomModelRegistry(getModelsConfigPath());
  const customModels = customRegistry
    .list()
    .filter((e) => e.provider === providerId)
    .map((e) => ({ id: e.model, name: e.model }));
  if (customModels.length > 0) {
    console.log(JSON.stringify({ provider: providerId, models: customModels, source: "custom" }, null, 2));
    return;
  }

  const providers = getProviderList();
  const provider = providers.find((p) => p.id === providerId);
  if (!provider) {
    console.error(`Unknown provider: ${providerId}`);
    const validIds = [...providers.map((p) => p.id), ...customRegistry.list().map((e) => e.provider)];
    console.error(`Valid providers: ${Array.from(new Set(validIds)).join(", ")}`);
    process.exit(1);
  }

  const models = getModelList(providerId);
  if (models.length === 0) {
    console.log(JSON.stringify({ provider: providerId, models: [], note: "No predefined models. Use any model ID." }));
    return;
  }

  const output = models.map((m) => ({
    id: m.id,
    name: m.name,
  }));
  console.log(JSON.stringify({ provider: providerId, models: output }, null, 2));
}
