/**
 * Interactive judge setup — runs automatically on `bun run eval` when no
 * persisted judge configuration is found.
 *
 * Uses the same provider + model catalogue the Ghost onboard wizard uses, so
 * the judge picker feels identical: pick a provider (OAuth-capable built-ins,
 * cloud API-key providers, or custom endpoints), then pick a model from that
 * provider's list.
 *
 * Persistence: `~/.ghost/eval.json`. Lives outside the main Ghost `config.json`
 * on purpose — eval is infra tooling, separate lifecycle from the agent.
 * Plaintext apiKey in that file is acceptable because `~/.ghost` is already
 * the user's private config root (same posture as `models.json`).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { select, text, isCancel, cancel, log, intro, note } from "@clack/prompts";
import { z } from "zod";
import { getEvalConfigPath } from "../config/paths.js";
import { getProviderList, getModelList } from "../onboard/providers.js";

// ── Persisted schema ─────────────────────────────────────────────────────

export const evalFileSchema = z.object({
  judgeProvider: z.string().min(1),
  judgeModel: z.string().min(1),
  /** Literal API key. Omitted for OAuth providers when the user wants the
   *  judge to reuse an existing OAuth token via Ghost's OAuthManager. */
  apiKey: z.string().optional(),
});
export type EvalFile = z.infer<typeof evalFileSchema>;

// ── Public API ───────────────────────────────────────────────────────────

export function readEvalConfig(): EvalFile | null {
  const path = getEvalConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    const parsed = evalFileSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export interface WizardContext {
  /** Ghost's agent provider — kept for API compatibility. */
  ghostProvider: string;
}

/** Returns the judge choice to use, or null if the user cancelled. */
export async function runJudgeSetupWizard(_ctx: WizardContext): Promise<EvalFile | null> {
  intro("Ghost Eval — Judge setup");
  note(
    "Eval needs a judge LLM to score Ghost's responses. Ideally a different\n" +
    "provider than the one Ghost uses, so the agent isn't grading itself.\n" +
    "Settings saved to ~/.ghost/eval.json.",
    "Why this prompt?",
  );

  const providers = getProviderList();

  // Step 1 — provider
  const providerId = await select({
    message: "Judge provider",
    options: providers.map((p) => ({
      value: p.id,
      label: `${p.tierLabel}  ${p.label}`,
      hint: providerHint(p),
    })),
  });
  if (isCancel(providerId)) { cancel("Cancelled."); return null; }
  const picked = providers.find((p) => p.id === providerId)!;

  // Step 2 — model
  const models = getModelList(picked.id);
  if (models.length === 0) {
    cancel(`No models registered for provider "${picked.id}". Configure one in ~/.ghost/models.json first.`);
    return null;
  }
  const modelId = await select({
    message: `Judge model (${picked.label})`,
    options: models.map((m) => ({ value: m.id, label: m.name, hint: m.id })),
  });
  if (isCancel(modelId)) { cancel("Cancelled."); return null; }

  // Step 3 — API key, only when needed
  let apiKey: string | undefined;
  if (needsApiKey(picked.id)) {
    if (picked.apiKeyUrl) log.info(`Get an API key: ${picked.apiKeyUrl}`);
    const entered = await text({
      message: `Paste your ${picked.label} API key`,
      placeholder: "sk-...",
      validate: (v) => (v && v.length >= 8 ? undefined : "Key too short"),
    });
    if (isCancel(entered)) { cancel("Cancelled."); return null; }
    apiKey = entered.trim();
  } else if (picked.supportsOAuth) {
    log.info(
      `${picked.label} supports OAuth. The judge will reuse the Ghost OAuth ` +
      `token for this provider. If you haven't authorized it, run Ghost onboard for ${picked.label} first.`,
    );
  }

  const file: EvalFile = {
    judgeProvider: picked.id,
    judgeModel: String(modelId),
    ...(apiKey ? { apiKey } : {}),
  };
  writeFileSync(getEvalConfigPath(), JSON.stringify(file, null, 2));
  log.success(`Saved to ${getEvalConfigPath()}`);
  return file;
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Providers that do NOT need the wizard to prompt for an API key:
 *   - OAuth providers: reuse Ghost's OAuth token via OAuthManager at call time
 *   - custom: user is expected to configure ~/.ghost/models.json separately
 * Everything else (built-in cloud providers without OAuth) needs a literal key.
 */
function needsApiKey(providerId: string): boolean {
  if (providerId === "custom") return false;
  const info = getProviderList().find((p) => p.id === providerId);
  if (info?.supportsOAuth) return false;
  return true;
}

function providerHint(p: ReturnType<typeof getProviderList>[number]): string {
  if (p.supportsOAuth) return "OAuth or API key";
  if (p.id === "custom") return "configure models.json";
  return "API key";
}
