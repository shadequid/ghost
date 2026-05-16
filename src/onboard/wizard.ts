import {
  intro,
  select,
  text,
  spinner,
  log,
  isCancel,
  cancel,
} from "@clack/prompts";
import { existsSync } from "node:fs";
import { printBanner } from "./banner.js";
import { getProviderList, getModelList } from "./providers.js";
import { OAuthManager } from "../auth/oauth.js";
import { SecretStore } from "../config/secrets.js";
import { CredentialStore } from "../config/credentials.js";
import { loadConfig, saveConfig } from "../config/loader.js";
import { configSchema, paperSchema, type Config } from "../config/schema.js";
import {
  getGhostDir,
  getConfigPath,
  getSecretKeyPath,
  getCredentialsPath,
  getModelsConfigPath,
} from "../config/paths.js";
import type { Logger } from "pino";
import type { DaemonOptions } from "../daemon/index.js";
import { finalizeOnboard } from "./finalize.js";
import { upsertCustomProvider } from "../providers/models-config-writer.js";
import {
  isReservedProviderName,
  loadCustomModelRegistry,
  PROVIDER_NAME_REGEX,
} from "../providers/models-config.js";
import { applyUpdateModeChanges } from "./wizard-update-config.js";

/** Validate a custom provider name for models.json. */
function validateCustomProviderName(name: string): string | undefined {
  if (!name) return "Provider name is required.";
  if (!PROVIDER_NAME_REGEX.test(name)) {
    return "Use lowercase letters, numbers, and hyphens only.";
  }
  if (isReservedProviderName(name)) {
    return `"${name}" is reserved — pick a distinct name (e.g. ollama-local).`;
  }
  return undefined;
}

/** Is the base URL pointing at a localhost endpoint? Used to auto-pick apiKey defaults. */
function isLocalBaseUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/u.test(url);
}

/** Validate Claude CLI binary exists and is authenticated. */
async function validateClaudeCli(binaryPath: string): Promise<{
  ok: boolean;
  version?: string;
  authStatus?: string;
  error?: string;
}> {
  const which = Bun.spawnSync({ cmd: ["which", binaryPath] });
  if (which.exitCode !== 0) {
    return { ok: false, error: `Claude Code not found at "${binaryPath}". Install: curl -fsSL https://claude.ai/install.sh | bash` };
  }

  const versionProc = Bun.spawnSync({ cmd: [binaryPath, "--version"] });
  const version = versionProc.stdout.toString().trim();

  const authProc = Bun.spawnSync({ cmd: [binaryPath, "auth", "status", "--json"] });
  if (authProc.exitCode !== 0) {
    return { ok: false, version, error: "Not authenticated. Run: claude login" };
  }

  try {
    const auth = JSON.parse(authProc.stdout.toString());
    const authenticated = auth.authenticated ?? auth.loggedIn ?? false;
    if (!authenticated) {
      return { ok: false, version, error: "Not authenticated. Run: claude login" };
    }
    return { ok: true, version, authStatus: auth.plan ?? auth.subscription ?? "authenticated" };
  } catch {
    return { ok: true, version, authStatus: "authenticated" };
  }
}

/** Options for non-interactive (headless) onboarding via CLI flags. */
export interface HeadlessOptions {
  readonly provider: string;
  readonly model: string;
  readonly apiKey?: string;
}

type WizardOptions = Omit<DaemonOptions, "configPath"> & {
  headless?: HeadlessOptions;
};

// Note: WizardOptions.logger is required (inherited from DaemonOptions).

/** A provider does NOT require an API key if it uses OAuth or CLI-based auth. */
function providerRequiresApiKey(providerId: string, supportsOAuth: boolean): boolean {
  if (providerId === "claude-cli") return false;
  if (supportsOAuth) return false;
  return true;
}

/**
 * Non-interactive onboard path — validates inputs, saves config, starts daemon.
 * Returns early; callers should not continue to the interactive wizard.
 *
 * Exported for testability — tests exercise custom-provider acceptance
 * without spinning up the interactive wizard path.
 */
export async function runHeadless(
  headless: HeadlessOptions,
  daemonOptions: Omit<WizardOptions, "headless">,
): Promise<void> {
  const configPath = getConfigPath();
  const secretStore = new SecretStore(getSecretKeyPath());
  const credentials = new CredentialStore(
    getCredentialsPath(),
    secretStore,
    daemonOptions.logger.child({ module: "credentials" }),
  );

  // Validate provider. Consult both the pi-ai built-in list AND the custom
  // registry from ~/.ghost/models.json so CI / scripted provisioning can
  // target Ollama / vLLM / LM Studio entries the user (or a previous
  // `ghost onboard` run) already defined.
  const providers = getProviderList();
  const providerInfo = providers.find((p) => p.id === headless.provider);

  if (!providerInfo) {
    const registry = loadCustomModelRegistry(getModelsConfigPath(), {
      logger: daemonOptions.logger.child({ module: "models-config" }),
    });
    if (registry.hasProvider(headless.provider)) {
      // Custom provider — models.json owns the apiKey, so skip OAuth +
      // credential-store branches entirely. We still validate the model id
      // is non-empty and persist config.
      const modelTrimmed = headless.model.trim();
      if (!modelTrimmed) {
        console.error("[ghost] Model ID cannot be empty.");
        process.exit(1);
      }
      const customConfig: Config = configSchema.parse({});
      customConfig.provider = headless.provider;
      customConfig.model = modelTrimmed;
      customConfig.secrets.encrypt = true;
      if (daemonOptions.paper) customConfig.paper = daemonOptions.paper;
      saveConfig(customConfig, configPath);

      console.log(`[ghost] Custom provider: ${headless.provider} (from models.json)`);
      console.log(`[ghost] Model:    ${modelTrimmed}`);
      if (daemonOptions?.paper) {
        console.log(
          `[ghost] Mode:     Paper trading (${daemonOptions.paper.initialBalance ?? 10000} USDC)`,
        );
      }
      console.log(`[ghost] Config saved to ${configPath}`);
      console.log(
        "[ghost] Config saved. Run 'ghost onboard --service' to register the auto-start service, or 'ghost daemon' to start manually.",
      );
      console.log("[ghost] Onboard complete!");
      return;
    }
    const validIds = Array.from(
      new Set<string>([
        ...providers.map((p) => p.id),
        ...registry.list().map((e) => e.provider),
      ]),
    ).join(", ");
    console.error(`Unknown provider "${headless.provider}". Valid providers: ${validIds}`);
    process.exit(1);
  }

  // Resolve API key: env var first (avoids exposure in `ps aux`), then CLI flag
  const apiKey = headless.apiKey ?? process.env["GHOST_API_KEY"] ?? "";

  // Handle auth: OAuth providers get browser login, API key providers need a key
  if (providerInfo.supportsOAuth && !apiKey) {
    // OAuth flow — prints URL for browser login, waits for callback
    console.log(`[ghost] ${providerInfo.label} uses OAuth. Starting browser login...`);
    const oauth = new OAuthManager(credentials);
    try {
      await oauth.login(headless.provider, {
        onAuth: async (info) => {
          console.log(`[ghost] Opening browser for authentication...`);
          // Auto-open URL in the user's default browser
          const { exec } = await import("node:child_process");
          const platform = process.platform;
          const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
          exec(`${cmd} "${info.url}"`);
          if (info.instructions) console.log(`[ghost] ${info.instructions}`);
        },
        onPrompt: async (prompt) => {
          const rl = await import("node:readline");
          const iface = rl.createInterface({ input: process.stdin, output: process.stdout });
          return new Promise<string>((resolve) => {
            iface.question(`[ghost] ${prompt.message}: `, (answer) => {
              iface.close();
              resolve(answer);
            });
          });
        },
        onProgress: (msg) => { console.log(`[ghost] ${msg}`); },
      });
      console.log(`[ghost] OAuth authentication complete`);
    } catch (err) {
      console.error(`[ghost] OAuth authentication failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[ghost] Try again or provide an API key with GHOST_API_KEY env var.`);
      process.exit(1);
    }
  } else {
    // OAuth provider with explicit API key: skip OAuth, use the key directly.
    // Non-OAuth provider: validate API key is present.
    const needsKey = providerRequiresApiKey(headless.provider, providerInfo.supportsOAuth);
    if (needsKey && !apiKey) {
      console.error(
        `Provider "${headless.provider}" requires an API key. Set GHOST_API_KEY env var or pass --api-key <key>.`,
      );
      process.exit(1);
    }
  }

  // Validate model ID
  const model = headless.model.trim();
  if (!model) {
    console.error("[ghost] Model ID cannot be empty.");
    process.exit(1);
  }

  // Build config from schema defaults
  const config: Config = configSchema.parse({});
  config.provider = headless.provider;
  config.model = model;
  config.secrets.encrypt = true;
  // Persist paper trading config so the daemon reads it from config.json
  // (the service starts `ghost daemon` with no flags).
  if (daemonOptions.paper) {
    config.paper = daemonOptions.paper;
  }

  // Store API key
  if (apiKey) {
    await credentials.set("api_key", apiKey);
  }

  saveConfig(config, configPath);

  console.log(`[ghost] Provider: ${providerInfo.label} (${headless.provider})`);
  console.log(`[ghost] Model:    ${model}`);
  if (daemonOptions?.paper) {
    console.log(`[ghost] Mode:     Paper trading (${daemonOptions.paper.initialBalance ?? 10000} USDC)`);
  }
  console.log(`[ghost] Config saved to ${configPath}`);

  // Service registration is interactive-only. In headless mode, print a hint.
  console.log("[ghost] Config saved. Run 'ghost onboard --service' to register the auto-start service, or 'ghost daemon' to start manually.");
  console.log("[ghost] Onboard complete!");
}


export async function runWizard(daemonOptions: WizardOptions): Promise<void> {
  // Headless path — skip all interactive prompts when flags are provided
  if (daemonOptions.headless) {
    const { headless, ...rest } = daemonOptions;
    await runHeadless(headless, rest);
    return;
  }

  printBanner();

  const configPath = getConfigPath();

  // Shared credential infrastructure — created once, reused throughout wizard
  const secretStore = new SecretStore(getSecretKeyPath());
  const credentials = new CredentialStore(
    getCredentialsPath(),
    secretStore,
    daemonOptions.logger.child({ module: "credentials" }),
  );

  // Start from schema defaults — assign values as wizard progresses
  let config: Config = configSchema.parse({});

  let mode = "full";
  if (existsSync(configPath)) {
    const modeAnswer = await select({
      message: "Existing config found. What would you like to do?",
      options: [
        { value: "full", label: "Full onboard (overwrite config)" },
        { value: "update", label: "Update provider/model only" },
        { value: "cancel", label: "Cancel" },
      ],
    });
    if (isCancel(modeAnswer) || modeAnswer === "cancel") {
      cancel("Setup cancelled.");
      process.exit(0);
    }
    mode = modeAnswer as string;
  }

  intro("Welcome to Ghost — the fastest, smallest AI assistant.\nThis wizard will configure your agent in under 60 seconds.");

  // Step 1/6: Trading mode — only asked for full onboard.
  // Skipped when --paper CLI flag was already supplied.
  if (mode === "full" && !daemonOptions.paper) {
    const tradingMode = await select({
      message: "Step 1/6 — Select trading mode",
      options: [
        { value: "paper", label: "Paper trading (simulated, safe to explore)", hint: "10,000 USDC starting balance" },
        { value: "live",  label: "Live trading (real funds on Hyperliquid)" },
      ],
      initialValue: "paper",
    });
    if (isCancel(tradingMode)) { cancel("Setup cancelled."); process.exit(0); }
    if (tradingMode === "paper") {
      daemonOptions.paper = paperSchema.parse({ enabled: true });
    }
    // tradingMode === "live" → leave daemonOptions.paper undefined.
  }

  // Step 2/6: Provider
  const providers = getProviderList();

  const providerOptions = providers.map((p) => ({
    value: p.id,
    label: p.label,
    hint: p.description,
  }));

  const providerId = await select({
    message: "Step 2/6 — Select your AI provider",
    options: providerOptions,
  });
  if (isCancel(providerId)) { cancel("Setup cancelled."); process.exit(0); }

  // If custom: ask for base URL
  let customUrl = "";
  let authMethod = "apikey";
  // Custom providers populate these and persist to ~/.ghost/models.json on save.
  let customProviderName = "";
  let customApiKey = "";

  // Claude CLI: validate binary + auth, select model
  if (providerId === "claude-cli") {
    const s1 = spinner();
    s1.start("Validating Claude Code...");
    const validation = await validateClaudeCli("claude");

    if (!validation.ok) {
      s1.stop(`✗ ${validation.error}`);
      cancel("Fix the issue above and try again.");
      process.exit(1);
    }

    s1.stop(`✓ Claude Code ${validation.version ?? ""} (${validation.authStatus})`);
    authMethod = "skip";
  }

  if (providerId === "custom") {
    // Ask for a provider name first — users often have multiple local backends
    // (e.g. ollama + vllm) and need distinct entries in models.json.
    const nameAnswer = await text({
      message: "Provider name (identifier for ~/.ghost/models.json)",
      placeholder: "ollama",
      defaultValue: "ollama",
      validate: (v) => validateCustomProviderName(v ?? ""),
    });
    if (isCancel(nameAnswer)) { cancel("Setup cancelled."); process.exit(0); }
    customProviderName = (nameAnswer as string).trim();

    const url = await text({
      message: "API base URL (e.g. http://localhost:11434/v1 or https://my-api.com/v1)",
      placeholder: "http://localhost:11434/v1",
      defaultValue: "http://localhost:11434/v1",
    });
    if (isCancel(url)) { cancel("Setup cancelled."); process.exit(0); }
    customUrl = url as string;

    // Ghost bypasses the OAuth/API-key auth step for Custom — models.json owns
    // the apiKey. For localhost endpoints Ollama ignores the key but still
    // requires one, so pre-fill "ollama" and let the user override.
    const local = isLocalBaseUrl(customUrl);
    const keyAnswer = await text({
      message: "API key for this endpoint (stored in ~/.ghost/models.json)",
      placeholder: local ? "ollama" : "sk-...",
      defaultValue: local ? "ollama" : "EMPTY",
    });
    if (isCancel(keyAnswer)) { cancel("Setup cancelled."); process.exit(0); }
    customApiKey = (keyAnswer as string).trim();

    // Skip the shared auth prompt path — models.json owns the secret for Custom.
    authMethod = "skip";
  }

  // Step 3/6: Model
  const s = spinner();
  s.start("Fetching models from provider...");
  const models = getModelList(providerId as string);
  s.stop(models.length ? `Found ${models.length} models` : "Using manual model input");

  let modelId: string;
  if (models.length > 0) {
    const modelOptions = [
      ...models.slice(0, 30).map((m) => ({ value: m.id, label: m.name, hint: m.id })),
      { value: "__custom__", label: "Custom model ID (type manually)" },
    ];
    const selected = await select({
      message: "Step 3/6 — Select your default model",
      options: modelOptions,
    });
    if (isCancel(selected)) { cancel("Setup cancelled."); process.exit(0); }
    if (selected === "__custom__") {
      const custom = await text({ message: "Enter model ID" });
      if (isCancel(custom)) { cancel("Setup cancelled."); process.exit(0); }
      modelId = custom as string;
    } else {
      modelId = selected as string;
    }
  } else {
    const manual = await text({
      message: "Step 3/6 — Enter model ID",
      placeholder: "e.g. claude-sonnet-4-6",
    });
    if (isCancel(manual)) { cancel("Setup cancelled."); process.exit(0); }
    modelId = manual as string;
  }

  // Step 4/6: Auth
  const providerInfo = providers.find((p) => p.id === providerId);
  let apiKey = "";
  // authMethod was set to "skip" above for local custom providers; otherwise default "apikey"

  if (providerInfo?.supportsOAuth && authMethod !== "skip") {
    const auth = await select({
      message: "Step 4/6 — How do you want to authenticate?",
      options: [
        { value: "oauth", label: "OAuth Login (authenticate in browser)", hint: "recommended" },
        { value: "apikey", label: "API Key (paste your key)" },
        { value: "skip", label: "Skip (set API key later via env)" },
      ],
    });
    if (isCancel(auth)) { cancel("Setup cancelled."); process.exit(0); }
    authMethod = auth as string;

    if (authMethod === "oauth") {
      const oauth = new OAuthManager(credentials);
      await oauth.login(providerId as string, {
        onAuth: (info) => {
          log.info(`Open this URL:\n  ${info.url}`);
          if (info.instructions) log.info(info.instructions);
        },
        onPrompt: async (prompt) => {
          const a = await text({ message: prompt.message });
          return isCancel(a) ? "" : (a as string);
        },
        onProgress: (msg) => { log.step(msg); },
      });
      log.success(`Authenticated with ${providerInfo.label} via OAuth`);
    }
  }

  if (authMethod === "apikey") {
    const keyUrl = providerInfo?.apiKeyUrl
      ? `\n  Get your key at: ${providerInfo.apiKeyUrl}`
      : "";
    const key = await text({
      message: `Step 4/6 — Paste your ${providerInfo?.label ?? (providerId as string)} API key${keyUrl}`,
      placeholder: "sk-...",
      validate: (v) => (!v || v.length >= 5) ? undefined : "API key seems too short",
    });
    if (isCancel(key)) { cancel("Setup cancelled."); process.exit(0); }
    apiKey = key as string;
  }

  if (authMethod === "skip" && providerId !== "claude-cli" && providerId !== "custom") {
    log.warn("No API key set. Export GHOST_API_KEY before running ghost daemon.");
  }

  if (mode === "update") {
    const existing = loadConfig(configPath);

    const s3 = spinner();
    s3.start("Updating configuration...");

    // Store API key in CredentialStore (not in config.json)
    if (apiKey) {
      await credentials.set("api_key", apiKey);
    }

    let resolvedProvider: string;
    if (providerId === "custom") {
      // Custom endpoint: persist to models.json; config.provider stores the
      // user-chosen name so runtime.resolveProvider() can look it up.
      upsertCustomProvider(getModelsConfigPath(), {
        providerName: customProviderName,
        baseUrl: customUrl,
        modelId,
        apiKey: customApiKey || undefined,
      });
      resolvedProvider = customProviderName;
    } else {
      resolvedProvider = providerId as string;
    }

    const next = applyUpdateModeChanges(existing, {
      provider: resolvedProvider,
      model: modelId,
      paper: daemonOptions.paper,
    });
    saveConfig(next, configPath);
    s3.stop("Configuration updated.");

    console.log("");
    log.success("Configuration updated.");
    if (providerId === "custom") {
      log.info(`Custom provider "${customProviderName}" written to ${getModelsConfigPath()}`);
    }
    console.log("");

    await finalizeOnboard({ interactive: true, logger: daemonOptions.logger });
    return;
  }

  // Store API key in CredentialStore (not in config.json)
  if (apiKey) {
    await credentials.set("api_key", apiKey);
  }

  if (providerId === "custom") {
    upsertCustomProvider(getModelsConfigPath(), {
      providerName: customProviderName,
      baseUrl: customUrl,
      modelId,
      apiKey: customApiKey || undefined,
    });
    config.provider = customProviderName;
  } else {
    config.provider = providerId as string;
  }
  config.model = modelId;
  config.secrets.encrypt = true;
  if (daemonOptions.paper) {
    config.paper = daemonOptions.paper;
  }

  saveConfig(config, configPath);

  log.success("Configuration saved.");
  if (providerId === "custom") {
    log.info(`Custom provider "${customProviderName}" written to ${getModelsConfigPath()}`);
  }
  log.info("Tip: connect channels from the dashboard after starting the daemon.");
  console.log("");

  await finalizeOnboard({ interactive: true, logger: daemonOptions.logger });
}
