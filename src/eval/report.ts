/**
 * Eval report — tiered aggregation, CLI summary, JSON persistence.
 *
 * Two tiers are tracked independently:
 *   L1 Execution — tool-use pass rate; unified judge (mechanical fallback).
 *                  Skill activation is NOT verified — a skill IS its tool
 *                  set + behavior guidance, so tool coverage + L2 already
 *                  cover "did Ghost follow the skill".
 *   L2 Behavior  — per-dimension average + total score; LLM-as-judge.
 *                  6 dims × 4 = 24 max.
 *
 * Golden and generated scenario sources are summarized separately.
 * `--compare` only diffs scenarios that appear in both the previous and
 * current run (matched by id) so a changed generated pool does not
 * distort the signal.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScoreResult, BehaviorDimension } from "./judge.js";
import { BEHAVIOR_DIMENSIONS, MAX_L3_SCORE } from "./judge.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface TierSummary {
  /** Count of scenarios where the tier ran (status != "skipped"). */
  applicable: number;
  passed: number;
  failed: number;
  /** Pass rate in [0..1], measured only over applicable scenarios. */
  passRate: number;
}

export interface BehaviorSummary {
  applicable: number;
  /** Mean `totalScore` across scenarios, out of `maxScore` (24). */
  averageScore: number;
  maxScore: number;
  /** Mean per-dimension score (0-4). */
  averageByDimension: Record<BehaviorDimension, number>;
  /** Count of scenarios that emitted at least one violation. */
  violationCount: number;
  /** Histogram of violation codes across scenarios. */
  violationsByType: Record<string, number>;
  weakestDimension: BehaviorDimension;
  strongestDimension: BehaviorDimension;
  topImprovements: string[];
}

export interface SetSummary {
  totalScenarios: number;
  execution: TierSummary;
  behavior: BehaviorSummary;
}

export interface EvalReport {
  timestamp: string;
  ghostModel: string;
  judgeModel: string;
  golden: SetSummary;
  generated: SetSummary;
  /** Full scenario results, tagged with source. */
  scenarios: ScoreResult[];
}

// ── Build report ─────────────────────────────────────────────────────────

export function buildReport(
  scores: ScoreResult[],
  ghostModel: string,
  judgeModel: string,
): EvalReport {
  const golden = scores.filter((s) => s.source === "golden");
  const generated = scores.filter((s) => s.source === "generated");

  return {
    timestamp: new Date().toISOString(),
    ghostModel,
    judgeModel,
    golden: summarizeSet(golden),
    generated: summarizeSet(generated),
    scenarios: scores,
  };
}

function summarizeSet(scores: ScoreResult[]): SetSummary {
  return {
    totalScenarios: scores.length,
    execution: summarizeExecution(scores),
    behavior: summarizeBehavior(scores),
  };
}

function summarizeExecution(scores: ScoreResult[]): TierSummary {
  let applicable = 0;
  let passed = 0;
  for (const s of scores) {
    if (s.execution.status === "skipped") continue;
    applicable++;
    if (s.execution.status === "pass") passed++;
  }
  return {
    applicable,
    passed,
    failed: applicable - passed,
    passRate: applicable === 0 ? 1 : round2(passed / applicable),
  };
}

function summarizeBehavior(scores: ScoreResult[]): BehaviorSummary {
  const avgByDim = Object.fromEntries(
    BEHAVIOR_DIMENSIONS.map((dim) => {
      const values = scores.map((s) => s.dimensions[dim]);
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      return [dim, avg];
    }),
  ) as Record<BehaviorDimension, number>;

  const maxScore = scores[0]?.maxScore ?? MAX_L3_SCORE;
  const avgScore = scores.length
    ? scores.reduce((a, s) => a + s.totalScore, 0) / scores.length
    : 0;

  const violationCount = scores.filter((s) => s.violations.length > 0).length;
  const violationsByType: Record<string, number> = {};
  for (const s of scores) {
    for (const v of s.violations) {
      violationsByType[v] = (violationsByType[v] ?? 0) + 1;
    }
  }

  let weakest: BehaviorDimension = BEHAVIOR_DIMENSIONS[0];
  let strongest: BehaviorDimension = BEHAVIOR_DIMENSIONS[0];
  for (const dim of BEHAVIOR_DIMENSIONS) {
    if (avgByDim[dim] < avgByDim[weakest]) weakest = dim;
    if (avgByDim[dim] > avgByDim[strongest]) strongest = dim;
  }

  const noteFreq = new Map<string, number>();
  for (const s of scores) {
    const note = s.improvementNotes.trim();
    if (note) noteFreq.set(note, (noteFreq.get(note) ?? 0) + 1);
  }
  const topImprovements = [...noteFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([note]) => note);

  return {
    applicable: scores.length,
    averageScore: round2(avgScore),
    maxScore,
    averageByDimension: Object.fromEntries(
      Object.entries(avgByDim).map(([k, v]) => [k, round2(v)]),
    ) as Record<BehaviorDimension, number>,
    violationCount,
    violationsByType,
    weakestDimension: weakest,
    strongestDimension: strongest,
    topImprovements,
  };
}

// ── Print CLI summary ────────────────────────────────────────────────────

export function printReport(report: EvalReport, verbose: boolean): void {
  console.log("\n" + "=".repeat(60));
  console.log("  GHOST EVAL REPORT");
  console.log("=".repeat(60));
  console.log(`  Ghost model:  ${report.ghostModel}`);
  console.log(`  Judge model:  ${report.judgeModel}`);
  console.log("");

  printSetSummary("Golden (primary)", report.golden);
  if (report.generated.totalScenarios > 0) {
    console.log("");
    printSetSummary("Generated (rotating, info-only)", report.generated);
  }

  // Verbose: per-scenario details
  if (verbose) {
    console.log("\n" + "-".repeat(60));
    console.log("  SCENARIO DETAILS");
    console.log("-".repeat(60));
    for (const s of report.scenarios) {
      const exec = s.execution.status === "skipped" ? "—" : s.execution.status.toUpperCase();
      const violationTag = s.violations.length > 0 ? ` [${s.violations.join(",")}]` : "";
      console.log(
        `\n  [${s.source}] ${s.scenarioId} (${s.skill}) — Exec=${exec} Behavior=${s.totalScore}/${s.maxScore}${violationTag}`,
      );
      if (s.execution.status === "fail") {
        const e = s.execution;
        if (e.missingRequired.length) console.log(`  Exec missing: ${e.missingRequired.join(", ")}`);
        if (e.invalidParams.length) console.log(`  Exec invalid params: ${e.invalidParams.join(", ")}`);
        if (e.reasoning) console.log(`  Exec [${e.source}] ${e.reasoning}`);
      }
      // Surface unjustified extras even when execution passes overall.
      if (s.execution.extras.length >= 3 || s.execution.extrasJustified === false) {
        const tag = s.execution.extrasJustified === false ? "unjustified" : "informational";
        console.log(`  Exec extras (${tag}, ${s.execution.extras.length}): ${s.execution.extras.slice(0, 6).join(", ")}${s.execution.extras.length > 6 ? "..." : ""}`);
      }
      console.log(`  Message: ${s.message.slice(0, 120)}${s.message.length > 120 ? "..." : ""}`);
      console.log(`  Response: ${s.ghostResponse.slice(0, 160)}${s.ghostResponse.length > 160 ? "..." : ""}`);
      if (s.improvementNotes) {
        console.log(`  Improve: ${s.improvementNotes.slice(0, 140)}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60) + "\n");
}

function printSetSummary(label: string, s: SetSummary): void {
  console.log(`  ${label}: ${s.totalScenarios} scenarios`);
  console.log("  " + "-".repeat(40));
  console.log(`  L1 Execution: ${tierLine(s.execution)}`);
  console.log(`  L2 Behavior:  ${s.behavior.averageScore.toFixed(2)} / ${s.behavior.maxScore}   scenarios with violations=${s.behavior.violationCount}`);
  if (s.behavior.applicable > 0) {
    // Bar width: each dim is 0..4, show 16 cells so 1 point ≈ 4 cells.
    for (const dim of BEHAVIOR_DIMENSIONS) {
      const avg = s.behavior.averageByDimension[dim] ?? 0;
      const cells = Math.round(avg * 4);
      const bar = "█".repeat(cells) + "░".repeat(Math.max(0, 16 - cells));
      const marker = dim === s.behavior.weakestDimension
        ? " ← weakest"
        : dim === s.behavior.strongestDimension
          ? " ← strongest"
          : "";
      console.log(`      ${dim.padEnd(20)} ${avg.toFixed(2)}    ${bar}${marker}`);
    }
    const vTypes = Object.entries(s.behavior.violationsByType);
    if (vTypes.length > 0) {
      console.log("    Violations by type:");
      for (const [code, count] of vTypes.sort((a, b) => b[1] - a[1])) {
        console.log(`      ${code.padEnd(26)} ${count}`);
      }
    }
    if (s.behavior.topImprovements.length > 0) {
      console.log("    Top improvements:");
      for (let i = 0; i < Math.min(3, s.behavior.topImprovements.length); i++) {
        console.log(`      ${i + 1}. ${s.behavior.topImprovements[i].slice(0, 120)}`);
      }
    }
  }
}

function tierLine(t: TierSummary): string {
  if (t.applicable === 0) return "— (no applicable scenarios)";
  const pct = Math.round(t.passRate * 100);
  return `${t.passed}/${t.applicable} (${pct}%)`;
}

// ── Write JSON + compare ─────────────────────────────────────────────────

export function writeReport(report: EvalReport, outputDir: string): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  const filename = `eval-${report.timestamp.replace(/[:.]/g, "-")}.json`;
  const filepath = join(outputDir, filename);
  writeFileSync(filepath, JSON.stringify(report, null, 2));
  writeFileSync(join(outputDir, "latest.json"), JSON.stringify(report, null, 2));
  return filepath;
}

export function compareWithPrevious(report: EvalReport, outputDir: string): void {
  const latestPath = join(outputDir, "latest.json");
  if (!existsSync(latestPath)) {
    console.log("  No previous run to compare against.\n");
    return;
  }

  let previous: EvalReport;
  try {
    previous = JSON.parse(readFileSync(latestPath, "utf-8"));
  } catch {
    console.log("  Could not parse previous report.\n");
    return;
  }

  // Detect legacy report shape — earlier reports had `l1`/`l2` fields
  // instead of `execution`. Mixing them crashes rateExecution. Skip with a
  // friendly message so `--compare` across a schema migration is a no-op,
  // not a TypeError.
  const isLegacyReport = previous.scenarios.some(
    (s) => (s as unknown as { execution?: unknown }).execution === undefined
      && (s as unknown as { l1?: unknown }).l1 !== undefined,
  );
  if (isLegacyReport) {
    console.log("  Previous report uses legacy (pre-execution-tier) schema — skipping comparison.\n");
    return;
  }

  const prevGolden = new Map(previous.scenarios.filter((s) => s.source === "golden").map((s) => [s.scenarioId, s]));
  const currGolden = report.scenarios.filter((s) => s.source === "golden");

  const matched = currGolden.filter((s) => prevGolden.has(s.scenarioId));
  const added = currGolden.filter((s) => !prevGolden.has(s.scenarioId));
  const removed = [...prevGolden.keys()].filter((id) => !matched.some((s) => s.scenarioId === id));

  if (matched.length === 0) {
    console.log("  No matching golden scenarios to compare.\n");
    return;
  }

  console.log("\n  COMPARISON (golden, matched by id):");
  console.log(`  Previous: ${previous.timestamp}   matched=${matched.length}  +${added.length} new  -${removed.length} removed`);
  console.log("");

  const prevMatchedScores = matched.map((s) => prevGolden.get(s.scenarioId)!);
  const prevExec = rateExecution(prevMatchedScores);
  const currExec = rateExecution(matched);
  const prevBehavior = avgBehavior(prevMatchedScores);
  const currBehavior = avgBehavior(matched);

  line("L1 Execution", prevExec, currExec, "%");
  const maxLabel = `/${matched[0]?.maxScore ?? MAX_L3_SCORE}`;
  line("L2 Behavior", prevBehavior, currBehavior, maxLabel);
}

function rateExecution(scores: ScoreResult[]): number {
  let applicable = 0;
  let passed = 0;
  for (const s of scores) {
    if (s.execution.status === "skipped") continue;
    applicable++;
    if (s.execution.status === "pass") passed++;
  }
  return applicable === 0 ? 1 : passed / applicable;
}

function avgBehavior(scores: ScoreResult[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((a, s) => a + s.totalScore, 0) / scores.length;
}

function line(label: string, prev: number, curr: number, unit: string): void {
  const diff = curr - prev;
  const arrow = diff > 0.01 ? "↑" : diff < -0.01 ? "↓" : "→";
  const sign = diff > 0 ? "+" : "";
  const toStr = (v: number) => unit === "%" ? `${Math.round(v * 100)}%` : v.toFixed(1);
  const diffStr = unit === "%" ? `${sign}${Math.round(diff * 100)}%` : `${sign}${diff.toFixed(1)}`;
  console.log(`  ${label.padEnd(14)} ${toStr(prev)} → ${toStr(curr)}  ${arrow} ${diffStr}`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
