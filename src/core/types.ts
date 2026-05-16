/**
 * Shared types for the Ghost autonomous agent runtime.
 * Channel message types in src/bus/types.ts.
 * LLM/message types from @mariozechner/pi-ai.
 */

/** Autonomy level controlling how much the agent can act without human approval. */
export type AutonomyLevel = "read_only" | "supervised" | "full";

/** Risk classification for shell commands. */
export type CommandRiskLevel = "low" | "medium" | "high";
