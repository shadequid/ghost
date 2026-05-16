/**
 * Persona definitions — 4 fixed archetypes + LLM-generated variations.
 */

import { complete } from "@mariozechner/pi-ai";
import type { Model, Api, ProviderStreamOptions, ToolCall } from "@mariozechner/pi-ai";
import { Type } from "@sinclair/typebox";
import { PERSONA_GEN_PROMPT } from "./prompts/persona-gen.js";
import { loadGhostContext, formatSoulContext } from "./ghost-context.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface Persona {
  name: string;
  source: "fixed" | "generated";
  experience: string;
  portfolioSize: number;
  riskBehavior: string;
  emotionalState: string;
  marketContext: string;
  timePressure: string;
  tradingStyle: string;
  languageStyle: string;
  backstory: string;
}

// ── Fixed personas (from PERSONAS.md) ────────────────────────────────────

const MARCUS: Persona = {
  name: "Marcus",
  source: "fixed",
  experience: "2.5 years perps, 1 year Hyperliquid",
  portfolioSize: 25_000,
  riskBehavior: "impulsive",
  emotionalState: "FOMO",
  marketContext: "extended altcoin rotation, funding feels hot",
  timePressure: "evening session after work",
  tradingStyle: "swing, 5-10x leverage, 2-5 trades/week",
  languageStyle: "English casual, trader slang (long, short, SL, TP, leverage, send it, bro).",
  backstory:
    "Fullstack dev, has plan but no discipline. After winning streaks pushes leverage to 15-20x, " +
    "removes SL, enters trades outside plan. Lost 35% in 4 days after spiraling from 2 losses.",
};

const KEVIN: Persona = {
  name: "Kevin",
  source: "fixed",
  experience: "4 years crypto, 2 years perps, Hyperliquid since early 2025",
  portfolioSize: 60_000,
  riskBehavior: "rushed",
  emotionalState: "time-pressured",
  marketContext: "sharp recent dump, macro uncertainty",
  timePressure: "between meetings, phone only",
  tradingStyle: "position + scalp, 1-3 trades/day, 3-15x leverage",
  languageStyle: "English terse, action-oriented, minimal words, no fluff",
  backstory:
    "Marketing agency CEO. Trading is side income but large size. Can't sit in front of charts. " +
    "Once got liquidated for $8k because he was in a meeting when bad news dropped.",
};

const ELENA: Persona = {
  name: "Elena",
  source: "fixed",
  experience: "1.5 years perps, 8 months Hyperliquid",
  portfolioSize: 10_000,
  riskBehavior: "cautious",
  emotionalState: "analysis-paralysis",
  marketContext: "setup forming but hesitating, wants confluence before entry",
  timePressure: "studying, checks phone every 20 min",
  tradingStyle: "swing + position, 3-7x leverage, 3-5 trades/week",
  languageStyle: "English formal/technical, uses quant jargon, writes in full sentences",
  backstory:
    "Quant/data grad student. Thorough analysis but too much data leads to paralysis. " +
    "65% win rate but poor R:R — average exit at only 40% of TP target. Cuts winners early.",
};

const DANIEL: Persona = {
  name: "Daniel",
  source: "fixed",
  experience: "5 years crypto, 3 years perps, Hyperliquid early adopter",
  portfolioSize: 150_000,
  riskBehavior: "methodical",
  emotionalState: "calm",
  marketContext: "watching whale flow on majors, patient for confluence",
  timePressure: "running a company, 1-2 hours/day for trading",
  tradingStyle: "position, 2-5x leverage, 1-2 trades/week",
  languageStyle: "English concise, data-heavy, prefers numbers over words",
  backstory:
    "Small startup CEO. Trades infrequently but large size. Tracks whale wallets + TA confluence. " +
    "Capital preservation > returns. One wrong trade loses $10-20k.",
};

export function getFixedPersonas(): Persona[] {
  return [MARCUS, KEVIN, ELENA, DANIEL];
}

// ── LLM-generated personas ──────────────────────────────────────────────

const GEN_PERSONAS_TOOL = {
  name: "gen_personas",
  description: "Return generated trader personas as structured data.",
  parameters: Type.Object({
    personas: Type.Array(
      Type.Object({
        name: Type.String(),
        experience: Type.String(),
        portfolioSize: Type.Number(),
        riskBehavior: Type.String(),
        emotionalState: Type.String(),
        marketContext: Type.String(),
        timePressure: Type.String(),
        tradingStyle: Type.String(),
        languageStyle: Type.String(),
        backstory: Type.String(),
      }),
    ),
  }),
};

export async function generatePersonas(
  count: number,
  model: Model<Api>,
  getApiKey: (provider: string) => Promise<string | undefined>,
): Promise<Persona[]> {
  // Persona-gen only needs SOUL, not skill specs — pass empty skill list.
  const soulContext = formatSoulContext(loadGhostContext([]));
  const systemPrompt = soulContext
    ? `${PERSONA_GEN_PROMPT}\n\n${soulContext}`
    : PERSONA_GEN_PROMPT;
  const context = {
    systemPrompt,
    messages: [
      {
        role: "user" as const,
        content: `Generate ${count} diverse trader personas for evaluation.`,
        timestamp: Date.now(),
      },
    ],
    tools: [GEN_PERSONAS_TOOL],
  };
  const apiKey = await getApiKey(model.provider);

  let response;
  try {
    response = await complete(model, context, {
      tool_choice: { type: "function", function: { name: "gen_personas" } },
      apiKey,
    } as ProviderStreamOptions);
  } catch (err) {
    console.warn(`  [persona-gen] forced tool_choice failed (${err instanceof Error ? err.message : String(err)}), retrying without`);
    response = await complete(model, context, { apiKey } as ProviderStreamOptions);
  }

  const toolCall = response.content.find(
    (c): c is ToolCall => c.type === "toolCall" && c.name === "gen_personas",
  );
  if (!toolCall) {
    const textParts = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    console.warn(`  [persona-gen] no tool call in response. Response preview: ${textParts.slice(0, 400)}`);
    return [];
  }

  const args = typeof toolCall.arguments === "string"
    ? JSON.parse(toolCall.arguments)
    : toolCall.arguments;

  return (args.personas ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    source: "generated" as const,
  }));
}
