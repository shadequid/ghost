/**
 * Regen — rebuild the golden dataset (personas + scenarios) using a chosen
 * LLM generator. Intended workflow: run once at kickoff with a strong model
 * (Opus), review output by hand, commit as v2 golden. Can be re-run when
 * prompts evolve or personas need to rotate.
 *
 * Persona archetypes from PERSONAS.md are preserved as seed names (Marcus,
 * Kevin, Elena, Daniel) when `--keep-fixed` is set — the generator is asked
 * to refresh their language style and backstory detail but keep the core
 * archetype intact. Otherwise fully new personas are generated.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";
import { getModel, type Model, type Api, type KnownProvider } from "@earendil-works/pi-ai";
import { loadCustomModelRegistry } from "../providers/models-config.js";
import { getModelsConfigPath, getCredentialsPath, getSecretKeyPath } from "../config/paths.js";
import { OAuthManager } from "../auth/oauth.js";
import { SecretStore } from "../config/secrets.js";
import { CredentialStore } from "../config/credentials.js";
import { getApiKey as makeRuntimeGetApiKey } from "../runtime.js";
import { readEvalConfig } from "./setup.js";
import { DEFAULT_EVAL_SKILLS } from "./config.js";
import { generatePersonas, getFixedPersonas, type Persona } from "./persona.js";
import { buildScenarios } from "./scenario.js";

interface RegenOptions {
  personaProvider: string;
  personaModel: string;
  personaCount: number;
  keepFixed: boolean;
  outputDir: string;
  apiKey?: string;
  /** Skills to target in scenario generation. Default mirrors EvalConfig.evalSkills. */
  evalSkills: string[];
}


function parseRegenArgs(argv: string[]): RegenOptions {
  const raw: Partial<RegenOptions> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--provider" && argv[i + 1]) raw.personaProvider = argv[++i];
    else if (a === "--model" && argv[i + 1]) raw.personaModel = argv[++i];
    else if (a === "--personas" && argv[i + 1]) raw.personaCount = Number(argv[++i]);
    else if (a === "--keep-fixed") raw.keepFixed = true;
    else if (a === "--no-keep-fixed") raw.keepFixed = false;
    else if (a === "--output" && argv[i + 1]) raw.outputDir = argv[++i];
    else if (a === "--api-key" && argv[i + 1]) raw.apiKey = argv[++i];
    else if (a === "--eval-skills" && argv[i + 1]) {
      raw.evalSkills = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  const evalCfg = readEvalConfig();
  return {
    personaProvider: raw.personaProvider ?? evalCfg?.judgeProvider ?? "anthropic",
    personaModel: raw.personaModel ?? evalCfg?.judgeModel ?? "claude-opus-4-5",
    personaCount: raw.personaCount ?? 6,
    keepFixed: raw.keepFixed ?? true,
    outputDir: raw.outputDir ?? "eval-data/golden",
    apiKey: raw.apiKey ?? evalCfg?.apiKey,
    evalSkills: raw.evalSkills ?? [...DEFAULT_EVAL_SKILLS],
  };
}

const REGEN_HELP = `
Ghost Eval — Regen golden dataset

Regenerate personas + scenarios using a strong LLM. Output overwrites the
current golden dataset (review by hand before committing).

Usage:
  bun run eval regen [options]

Options:
  --provider NAME           Generator provider (default: anthropic or from eval.json)
  --model ID                Generator model (default: claude-opus-4-5)
  --personas N              Total persona count (default: 6; includes fixed if --keep-fixed)
  --keep-fixed              Keep Marcus/Kevin/Elena/Daniel archetypes (default: on)
  --no-keep-fixed           Drop fixed archetypes; only use generated personas
  --output DIR              Output root (default: eval-data/golden)
  --api-key KEY             Explicit API key (overrides eval.json)
  --eval-skills CSV         Skills to target in scenario gen, comma-separated
                            (default: market-intel,technical-analysis,pre-trade-advisory,
                            trade-executor,ask-user-questions,risk-manager,position-monitor)
  --help                    Show this help
`;

function resolveModel(opts: RegenOptions): Model<Api> {
  const registry = loadCustomModelRegistry(getModelsConfigPath(), {});
  const custom = registry.find(opts.personaProvider, opts.personaModel);
  if (custom) return custom;
  const model = getModel(opts.personaProvider as KnownProvider, opts.personaModel as never);
  if (!model) {
    throw new Error(
      `Cannot resolve generator model "${opts.personaProvider}/${opts.personaModel}". ` +
      `Configure it in ~/.ghost/models.json or pass a provider supported by pi-ai.`,
    );
  }
  return model;
}

function makeGetApiKey(opts: RegenOptions): (provider: string) => Promise<string | undefined> {
  const registry = loadCustomModelRegistry(getModelsConfigPath(), {});
  const secretStore = new SecretStore(getSecretKeyPath());
  const credentials = new CredentialStore(
    getCredentialsPath(),
    secretStore,
    pino({ level: "silent" }),
  );
  const oauthManager = new OAuthManager(credentials);
  const runtimeGetApiKey = makeRuntimeGetApiKey(oauthManager, credentials, registry);

  return async (provider: string) => {
    // 1. CLI override wins.
    if (provider === opts.personaProvider && opts.apiKey) return opts.apiKey;
    // 2. eval.json literal apiKey for the generator provider.
    const evalCfg = readEvalConfig();
    if (evalCfg && provider === evalCfg.judgeProvider && evalCfg.apiKey) return evalCfg.apiKey;
    // 3. Full runtime resolution — custom registry, OAuth, credential store.
    return runtimeGetApiKey(provider);
  };
}

export async function runRegen(argv: string[]): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(REGEN_HELP);
    return;
  }

  const opts = parseRegenArgs(argv);

  console.log("\n  Ghost Eval — Regen golden dataset");
  console.log("  " + "-".repeat(40));
  console.log(`  Generator: ${opts.personaProvider}/${opts.personaModel}`);
  console.log(`  Personas:  ${opts.personaCount}${opts.keepFixed ? " (Marcus/Kevin/Elena/Daniel + new)" : " (all new)"}`);
  console.log(`  Scenarios: 5 per persona (one per journey step)`);
  console.log(`  Target skills: ${opts.evalSkills.join(", ")}`);
  console.log(`  Output:    ${opts.outputDir}`);
  console.log("");

  const model = resolveModel(opts);
  const getApiKey = makeGetApiKey(opts);

  // 1. Assemble personas: fixed archetypes + generated variations.
  //    Dedupe by slug so a generator-produced "Marcus" can't collide with
  //    the fixed Marcus archetype (would write twice the scenarios with
  //    identical ids otherwise). Fixed personas take precedence.
  const personas: Persona[] = [];
  const seenSlugs = new Set<string>();
  const addIfUnique = (list: Persona[]): void => {
    for (const p of list) {
      const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (seenSlugs.has(slug)) {
        console.log(`  [skip] duplicate persona slug "${slug}" — dropping ${p.source === "fixed" ? "fixed" : "generated"} "${p.name}"`);
        continue;
      }
      seenSlugs.add(slug);
      personas.push(p);
    }
  };
  if (opts.keepFixed) {
    addIfUnique(getFixedPersonas());
    const extraCount = Math.max(0, opts.personaCount - personas.length);
    if (extraCount > 0) {
      console.log(`  Generating ${extraCount} additional personas...`);
      const extra = await generatePersonas(extraCount, model, getApiKey);
      addIfUnique(extra);
    }
  } else {
    console.log(`  Generating ${opts.personaCount} personas from scratch...`);
    addIfUnique(await generatePersonas(opts.personaCount, model, getApiKey));
  }
  console.log(`  → ${personas.length} unique personas ready`);

  // 2. Write personas to disk.
  const personasDir = join(opts.outputDir, "personas");
  rmSync(personasDir, { recursive: true, force: true });
  mkdirSync(personasDir, { recursive: true });
  for (const p of personas) {
    const { source: _source, ...body } = p; // drop source field from disk (loader re-adds it)
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    writeFileSync(join(personasDir, `${slug}.json`), JSON.stringify(body, null, 2) + "\n");
  }
  console.log(`  → wrote ${personas.length} persona files`);

  // 3. Generate scenarios per persona.
  console.log("");
  const allScenariosJson: unknown[] = [];
  for (let i = 0; i < personas.length; i++) {
    const p = personas[i];
    process.stdout.write(`  [${i + 1}/${personas.length}] ${p.name}... `);
    try {
      const scenarios = await buildScenarios(p, model, getApiKey, opts.evalSkills);
      for (const s of scenarios) {
        const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        allScenariosJson.push({
          id: s.id,
          personaRef: slug,
          turns: s.turns,
          expected: {
            primarySkill: s.expected.primarySkill,
            ...(s.expected.skills && s.expected.skills.length > 1
              ? { skills: s.expected.skills }
              : {}),
            ...(s.expected.intent ? { intent: s.expected.intent } : {}),
            ...(s.expected.tools ? { tools: s.expected.tools } : {}),
            ...(s.expected.decision ? { decision: s.expected.decision } : {}),
            ...(s.expected.shouldRefuse ? { shouldRefuse: true } : {}),
          },
          tags: s.tags,
        });
      }
      console.log(`${scenarios.length} scenarios`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 4. Write scenarios bundle to disk. Wipe the whole dir — scenarios from
  //    dropped personas (rename, --no-keep-fixed, fewer --personas) would
  //    otherwise linger and get loaded by golden-loader on next run.
  const scenariosDir = join(opts.outputDir, "scenarios");
  rmSync(scenariosDir, { recursive: true, force: true });
  mkdirSync(scenariosDir, { recursive: true });
  writeFileSync(
    join(scenariosDir, "generated.json"),
    JSON.stringify({ scenarios: allScenariosJson }, null, 2) + "\n",
  );
  console.log(`\n  → wrote ${allScenariosJson.length} scenarios to scenarios/generated.json`);
  console.log("\n  Review output, then commit to freeze as golden v2.\n");
}
