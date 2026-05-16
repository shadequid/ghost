/**
 * Eval CLI — entry point for `bun run eval`.
 */

import { parseEvalArgs } from "./config.js";
import { runEval } from "./runner.js";
import { runRegen } from "./regen.js";

const HELP = `
Ghost Eval — Tiered AI quality evaluation

Runs a frozen golden dataset through Ghost and scores on two tiers:
  L1 Execution  — did the right skill chain + tools run with valid args?  (unified LLM judge + mechanical fallback)
  L2 Behavior   — is the response helpful, grounded, decisive, safe, and
                  recognizably Ghost? (LLM judge; 6 dims x 4 = 24 max)

Uses your Ghost config (~/.ghost/config.json) for the agent under test. Judge
runs on a separate provider/model (--judge-provider, --judge-model) to reduce
self-bias.

Subcommands:
  bun run eval regen ...   Regenerate golden personas + scenarios (see 'regen --help')

Usage:
  bun run eval [options]

Dataset:
  --golden-dir DIR         Path to golden dataset (default: eval-data/golden)
  --generated N            Also run N generated personas/scenarios as an info-only
                           rotating pool (default: 0)
  --skill NAME             Filter to a single skill (e.g. "pre-trade-advisory")
  --eval-skills CSV        Skills to load into scenario-gen context,
                           comma-separated. Default covers the 6 core trading
                           skills; override to scope eval to new / subset skills
                           without editing code.
  --scenario ID            Run exactly one scenario by id (e.g. "marcus-decision")
  --limit N                Cap number of scenarios after filters (e.g. --limit 1)

Judge:
  --judge-provider         Provider for judge calls (default: openrouter)
  --judge-model            Model id for judge calls (default: anthropic/claude-sonnet-4)

Thresholds (applied to golden set only; generated is informational):
  --execution-threshold F  Minimum execution pass rate, 0..1 (default: 0.85)
  --behavior-threshold N   Minimum behavior average score, 0..24 (default: 15)
  --threshold N            Alias for --behavior-threshold
  --l1-threshold F         Deprecated alias for --execution-threshold

Output:
  --output DIR             Output directory (default: eval-results)
  --verbose                Print per-scenario trace and execution + behavior details
  --compare                Compare matching golden scenarios with previous run

  --help                   Show this help
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Subcommand dispatch — must come before --help check so `regen --help`
  // hits the subcommand's own help text.
  if (args[0] === "regen") {
    await runRegen(args.slice(1));
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }

  const config = parseEvalArgs(args);

  console.log("\n  Ghost Eval");
  console.log("  " + "-".repeat(40));
  console.log(`  Golden dir:     ${config.goldenDir}`);
  console.log(`  Generated pool: ${config.generatedCount}`);
  console.log(`  Skill filter:   ${config.skill || "all"}`);
  if (config.scenarioId) console.log(`  Scenario id:    ${config.scenarioId}`);
  if (config.limit > 0) console.log(`  Limit:          ${config.limit}`);
  console.log(`  Thresholds:     Exec=${config.executionThreshold} Behavior=${config.passThreshold}/24`);
  console.log("");

  await runEval(config);
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exitCode = 1;
});
