/**
 * Shared helper for trading tool factories.
 *
 * `defineTool` is an identity function whose generic captures each tool's
 * concrete TypeBox schema so the `execute` callback receives a properly
 * typed `params` argument (Static<TParameters>). Without it, returning an
 * inline tool literal in an `AgentTool[]` array would widen the schema to
 * the default `TSchema`, which under typebox 1.1.x conditional-type
 * semantics resolves params to `unknown` and forces each call site to
 * either cast or suppress the lint.
 *
 * Trading tool factories return `AgentTool[]` (or a single `AgentTool`)
 * directly; each element inside is wrapped in `defineTool({...})`.
 */

import type { TSchema } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export function defineTool<TParameters extends TSchema, TDetails = unknown>(
  tool: AgentTool<TParameters, TDetails>,
): AgentTool<TParameters, TDetails> {
  return tool;
}
