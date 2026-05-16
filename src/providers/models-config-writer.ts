/**
 * Writer side of the custom models registry — used by the onboard wizard to
 * persist user selections into `~/.ghost/models.json` without clobbering
 * entries the user has already hand-edited.
 *
 * Read path lives in `models-config.ts`; keep the writer out of the runtime
 * hot path so tests can exercise it in isolation.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  isOllamaEndpoint,
  modelsConfigSchema,
  normalizeBaseUrl,
} from "./models-config.js";
import type { ModelsConfigFile, ProviderConfigInput } from "./models-config.js";

/**
 * File mode for models.json: owner read/write only. Matches `config.json`
 * (0o600) and `credentials.json` (0o600) because the file can hold plaintext
 * apiKey values. Parent directory uses 0o700 for the same
 * reason (mirrors SecretStore + CredentialStore).
 */
const MODELS_FILE_MODE = 0o600;
const MODELS_DIR_MODE = 0o700;

export interface UpsertCustomProviderInput {
  readonly providerName: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly apiKey?: string;
  /**
   * Display label for the model ("Qwen 3 8B"). Defaults to the model id when
   * omitted; surfaced in `ghost status` and model pickers.
   */
  readonly modelName?: string;
}

/**
 * Result of probing/reading a models.json file.
 *
 * Distinguishes "file is absent" (OK to create a fresh file) from
 * "file exists but is broken" (must NOT be overwritten — the writer would
 * silently destroy other providers the user had configured).
 */
export type ReadModelsConfigResult =
  | { kind: "missing" }
  | { kind: "ok"; data: ModelsConfigFile }
  | { kind: "malformed"; reason: string };

/**
 * Read an existing models.json, reporting whether the file is missing, valid,
 * or malformed. Malformed files are left untouched — the caller decides
 * whether to surface an error or fall back to defaults.
 *
 * A malformed result is the writer's cue to abort the upsert rather than
 * overwrite (and lose) the user's hand-edited providers.
 */
export function readModelsConfig(path: string): ReadModelsConfigResult {
  if (!existsSync(path)) return { kind: "missing" };
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    return { kind: "malformed", reason: describeError(err) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { kind: "malformed", reason: `invalid JSON (${describeError(err)})` };
  }
  const result = modelsConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join(".") || "root";
    const detail = issue?.message ?? "schema invalid";
    return {
      kind: "malformed",
      reason: `schema validation failed at ${where}: ${detail}`,
    };
  }
  return { kind: "ok", data: result.data };
}

/**
 * Merge a provider entry into models.json (creating the file if absent).
 * If the provider already exists, the model is appended/updated without
 * touching other providers or other models on the same provider.
 *
 * Throws when the existing file is malformed — this is a deliberate failure
 * mode to prevent silently clobbering hand-edited entries.
 *
 * Write is atomic: tmp-file + rename, both with 0o600 permissions, so a
 * crash mid-write cannot leave a truncated models.json.
 *
 * Returns the persisted config so callers can log or inspect it.
 */
export function upsertCustomProvider(
  path: string,
  input: UpsertCustomProviderInput,
): ModelsConfigFile {
  const read = readModelsConfig(path);
  if (read.kind === "malformed") {
    throw new Error(
      `Refusing to overwrite malformed models.json: ${read.reason}. Fix or remove ${path} and retry.`,
    );
  }
  const existing = read.kind === "ok" ? read.data : { providers: {} };
  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);

  const prior = existing.providers[input.providerName];
  const models = upsertModel(prior?.models ?? [], {
    id: input.modelId,
    name: input.modelName,
  });

  const next: ProviderConfigInput = {
    baseUrl: normalizedBaseUrl,
    api: prior?.api ?? "openai-completions",
    apiKey: input.apiKey ?? prior?.apiKey,
    models,
    ...(prior?.compat ? { compat: prior.compat } : {}),
  };

  // Auto-apply Ollama compat defaults on first write if the user didn't set any.
  if (!prior?.compat && isOllamaEndpoint(normalizedBaseUrl)) {
    next.compat = { supportsDeveloperRole: false, supportsReasoningEffort: false };
  }

  const merged: ModelsConfigFile = {
    providers: { ...existing.providers, [input.providerName]: next },
  };

  writeAtomic(path, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

function upsertModel(
  current: NonNullable<ProviderConfigInput["models"]>,
  incoming: { id: string; name?: string },
): NonNullable<ProviderConfigInput["models"]> {
  const idx = current.findIndex((m) => m.id === incoming.id);
  const entry = incoming.name ? { id: incoming.id, name: incoming.name } : { id: incoming.id };
  if (idx === -1) return [...current, entry];
  const next = current.slice();
  next[idx] = { ...current[idx], ...entry };
  return next;
}

/**
 * Atomic write: stage to a sibling `.tmp` file (pre-chmod 0o600), then rename.
 * `renameSync` is atomic on POSIX within the same filesystem, so the file is
 * either the previous version or the new — never half-written.
 *
 * The explicit `chmodSync` after write guards against umask defaults that
 * would otherwise leave the tmp file 0o644 on systems with a loose umask;
 * the rename then preserves those permissions on the final path.
 */
function writeAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: MODELS_DIR_MODE });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, contents, { mode: MODELS_FILE_MODE });
    // Defensive chmod: writeFileSync's mode argument is only honored on file
    // creation and some implementations apply umask anyway. Force 0o600 so the
    // renamed-over destination is always owner-only.
    chmodSync(tmp, MODELS_FILE_MODE);
    renameSync(tmp, path);
  } catch (err) {
    // Best-effort cleanup of the staged tmp file on any failure path.
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* ignore cleanup failures — original error is more useful */
    }
    throw err;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
