/**
 * Shared types for trading tool factories.
 *
 * AnyAgentTool replaces the scattered `AgentTool<any>` + eslint-disable pattern
 * in intel tool files. The single eslint-disable lives here; every tool
 * factory that returns an opaque-schema tool imports AnyAgentTool instead of
 * suppressing the lint rule inline.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";

// Single suppression point: tool factories expose an opaque schema at their
// public boundary. The `any` is intentional — the caller (tool registry, agent)
// treats all tools uniformly regardless of their concrete parameter schema.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentTool = AgentTool<any>;
