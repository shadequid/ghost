/**
 * Execution tier assertion — tool-use only.
 *
 * Deterministic check on the orchestrator trace — no LLM calls. Produces
 * an ExecutionResult with sub-fields (toolsCalled, missingRequired,
 * invalidParams, extras) for debugging.
 *
 * We do NOT verify skill activation. In Ghost's design, a skill IS its
 * tool set + behavior guidance — so if the tools are right and the behavior
 * (judged at L2) is right, the skill was followed. Verifying skill
 * activation separately was noisy because strong models skip the
 * `read_file(SKILL.md)` step that produces the signal.
 *
 * The verdict here is the mechanical baseline. The runner passes it to
 * the LLM judge as informational context, and the judge can verify or
 * override based on the full trace.
 */

import { Value } from "@sinclair/typebox/value";
import type { ToolRegistry } from "../tools/registry.js";
import type { Scenario } from "./scenario.js";
import type { ExecutionResult } from "./judge.js";

/**
 * Tools the system prompt mandates unconditionally (see
 * `src/agent/context-builder.ts` — "ALWAYS call ghost_list_wallets first
 * before using any other trading tool"). These appear in every trace but
 * don't belong in any scenario's `expected.tools`, so treating them as
 * "extras" punishes Ghost for following its own system prompt.
 *
 * Keep this list in sync with the system prompt. Anything listed here is
 * silently filtered out of the extras set AND ignored when deciding whether
 * extras were justified.
 *
 * Related: `NON_GHOST_ALLOWED_EXPECTED_TOOLS` in `scenario.ts` — that list
 * covers tools that SKILL.md files mandate and should be allowed *into*
 * `expected.tools`. Different layer, different purpose.
 */
const SYSTEM_MANDATED_TOOLS: readonly string[] = ["ghost_list_wallets"];

export function assertExecution(
  scenario: Scenario,
  toolCalls: Array<{ name: string; arguments: unknown }>,
  tools: ToolRegistry,
): ExecutionResult {
  const expectedTools = scenario.expected.tools ?? [];
  const actualNames = toolCalls.map((t) => t.name);
  const uniqueActual = Array.from(new Set(actualNames));

  // Scenarios with no expected tools skip the tier — nothing mechanical
  // to assert against.
  if (expectedTools.length === 0) {
    return {
      status: "skipped",
      toolsCalled: actualNames,
      missingRequired: [],
      invalidParams: [],
      extras: [],
      source: "mechanical",
    };
  }

  const missingRequired = expectedTools.filter((t) => !actualNames.includes(t));
  const extras = uniqueActual.filter(
    (t) => !expectedTools.includes(t) && !SYSTEM_MANDATED_TOOLS.includes(t),
  );

  const invalidParams: string[] = [];
  for (const name of expectedTools) {
    if (!actualNames.includes(name)) continue;
    const tool = tools.get(name);
    if (!tool) {
      invalidParams.push(`${name} (not registered)`);
      continue;
    }
    for (const call of toolCalls) {
      if (call.name !== name) continue;
      try {
        if (!Value.Check(tool.parameters, call.arguments)) {
          invalidParams.push(name);
          break;
        }
      } catch {
        invalidParams.push(name);
        break;
      }
    }
  }

  const status: ExecutionResult["status"] =
    missingRequired.length === 0 && invalidParams.length === 0 ? "pass" : "fail";

  return {
    status,
    toolsCalled: actualNames,
    missingRequired,
    invalidParams,
    extras,
    source: "mechanical",
  };
}
