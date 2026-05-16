# Memory and Skills

Memory and skills are Ghost's two mechanisms for extending context and teaching the agent specific behaviors. This doc covers the architecture, lifecycle, and integration of each.

## Memory: Two-Layer Storage

Ghost maintains two complementary memory files: **MEMORY.md** (facts) and **HISTORY.md** (log).

| File | Purpose | Scope | Format |
|------|---------|-------|--------|
| **MEMORY.md** | Long-term facts (trader preferences, important events, resolved issues) | Always injected into system prompt | Freeform markdown; updated by consolidator |
| **HISTORY.md** | Append-only timestamped log of consolidated chunks | Archive; searchable via grep | `[YYYY-MM-DD HH:MM] event summary` per line |

Both files live in `~/.ghost/workspace/memory/` and are managed by `MemoryStore` (src/memory/store.ts:11).

### Reading Memory

On each turn, `MemoryStore.getMemoryContext()` (src/memory/store.ts:46) reads MEMORY.md and wraps it as a section in the system prompt:

```
## Long-term Memory

[contents of MEMORY.md]
```

If MEMORY.md is empty, the section is omitted entirely — no overhead for new users.

### Consolidating Memory

When session messages grow large, the **MemoryConsolidator** (src/memory/consolidator.ts:89) summarizes old messages and persists them to memory. This keeps prompt tokens under budget without losing important context.

#### Trigger Condition

`maybeConsolidate()` (src/memory/consolidator.ts:118) checks before every turn:

1. Calculate `estimateSessionPromptTokens()` (src/memory/tokens.ts:34) — sum of system prompt + tools + unconsolidated messages + safety buffer.
2. If estimate exceeds `config.memory.contextWindowTokens` (default 65,536), proceed to consolidation.
3. Budget = `contextWindowTokens - maxCompletionTokens - 1024` (SAFETY_BUFFER).

#### Consolidation Flow

1. Pick boundary: find the earliest user message beyond the token target (src/memory/consolidator.ts:151).
2. Format chunk (src/memory/consolidator.ts:39) — convert messages to `[HH:MM] ROLE: text` for readability.
3. Call Runner with `save_memory` tool and a prompt asking the LLM to summarize.
4. LLM writes two outputs:
   - `history_entry` — one-paragraph summary with timestamp.
   - `memory_update` — full updated MEMORY.md (keep facts, add new ones).
5. Only advance `session.lastConsolidated` pointer if memory content changed (src/memory/consolidator.ts:144).
6. Repeat for up to `maxConsolidationRounds` (default 5) if still over budget.

**Best-effort semantics:** If the LLM skips `save_memory` tool, consolidation is a no-op for that round — the session continues to grow. After 5 rounds, consolidation stops. Logged warning: "LLM did not call save_memory tool — session continues to grow" (src/memory/consolidator.ts:188).

## System Prompt Assembly (ContextBuilder)

The system prompt is built layer by layer via `StructuredPrompt` (src/agent/context-builder.ts:37), a Map-based section manager:

1. **Identity** — SOUL.md seeded to workspace on first daemon start (src/templates/SOUL.md:1).
2. **Safety** — hardcoded rules (no emoji, use tags, no tool names exposed).
3. **Tooling** — list of available tools + signatures (hidden from this doc).
4. **Bootstrap** — optional workspace files (max 20 KB per file, 50 KB total).
5. **Memory** — MEMORY.md wrapped as "## Long-term Memory" (src/memory/store.ts:46).
6. **Active Skills** — full text of N always-on skills (src/skills/loader.ts:181).
7. **Skills Summary** — XML block listing all available skills (src/skills/loader.ts:129).
8. **Runtime Context** — wallet address, current time, open positions, fee tier.

Final prompt is sections joined with `\n\n---\n\n` separator (src/agent/context-builder.ts:73).

### SOUL.md Tags

The system prompt uses semantic tags to structure data. Traders and skills reference these tags in rules:

| Tag | Attributes | Example | Purpose |
|-----|------------|---------|---------|
| `<pct>` | `dir="up\|down"` | `<pct dir="up">+2.5%</pct>` | Percentage changes |
| `<price>` | — | `<price>1,234 USDT</price>` | Currency amounts, prices |
| `<pnl>` | `dir="up\|down"` | `<pnl dir="up">+$520</pnl>` | Profit/loss |
| `<lev>` | — | `<lev>10x</lev>` | Leverage amount |
| `<side>` | `dir="long\|short"` | `<side dir="long">LONG</side>` | Position direction |
| `<tag>` | `type="entry\|tp\|sl"` | `<tag type="entry">1,950</tag>` | Trade level label |
| `<risk>` | `level="low\|medium\|high"` | `<risk level="high">Liquidation near</risk>` | Risk level |
| `<verdict>` | `type="bullish\|bearish\|neutral"` | `<verdict type="bullish">Buy signal confirmed</verdict>` | Opinion/conclusion |
| `<ind>` | `name="ema\|bb\|..."` | `<ind name="ema">EMA50</ind>` | Technical indicator (hoverable) |
| `<lvl>` | `price="..."` | `<lvl price="71388">$71,388</lvl>` | S/R level (hoverable) |
| `<chart>` | `symbol="..."`; `interval="..."` | `<chart symbol="BTC" interval="4h" ... />` | Interactive candlestick |

All tags are defined in src/templates/SOUL.md:42-54. Skills and traders use these for consistent, tagged output.

## Three-Layer Model

Ghost features are designed in three layers, each with its own acceptance criteria and iteration cycle:

| Layer | Owner | Iteration | Example: Pre-Trade Advisory |
|-------|-------|-----------|------------------------|
| **Capability (US)** | BA/Product | Ship once | "Agent gathers portfolio state, funding, technicals before order. Output: risk level + SL/TP levels (type: JSON prices, not phrasing)." |
| **Behavior (Skill)** | Engineer/LLM trainer | Tune forever | "Lead with risk level in plain words. Include 2-3 factors. Never dump indicators. Match trader's emotional state." |
| **Eval** | QA/Data | Measure always | L1: tool accuracy. L2: 6-dim behavior matrix (tone, completeness, actionability, data accuracy, risk calibration, personalization). |

**Critical rule:** Never put behavior in the US. Every skill tuning would then "violate" the AC. Separate concerns:

- US defines what data goes in, what type comes out, what NOT to do.
- Skill defines HOW to phrase, WHAT to emphasize, WHEN to warn.

Pre-Trade Advisory example (src/skills/builtin/pre-trade-advisory/SKILL.md):

- **US boundary:** Call these tools in parallel, output risk level + suggested SL/TP.
- **Skill behavior:** "Lead with your quick take. Risk level in plain words — 'this is moderate risk because...' (not scores). Always concrete price for SL/TP. Name behavioral patterns gently."
- **Eval:** Did the advisory match the trader's emotional state? Were SL/TP levels based on structure or arbitrary? Was the risk level calibrated to reality?

## Skills: Authoring and Lifecycle

Skills are markdown files with YAML frontmatter that inject behavior guidance into the system prompt.

### Skill File Format

```yaml
---
name: skill-name
description: "One-line description of what this skill teaches."
always: true  # optional; if true, always injected (max ~5)
metadata:     # optional; for requirements checking
  ghost:
    requires:
      bins: ["python3", "ffmpeg"]  # CLI tools needed
      env: ["OPENROUTER_API_KEY"]  # env vars needed
---

# Skill Title

Prose explaining when/how to use this skill. Section by section.
Can include examples, tables, warnings, etc.
```

Location rules:

- **Builtin skills:** `src/skills/builtin/{skill-name}/SKILL.md`. Shipped with Ghost. Workspace skills shadow by name.
- **Workspace skills:** `~/.ghost/workspace/skills/{skill-name}/SKILL.md`. User-created or uploaded. Takes precedence over builtin.

### Enable/Disable Lifecycle

Skills are enabled by default when first discovered. Users toggle via CLI or web:

1. **Discovery:** `SkillService.syncState()` (src/services/skill-service.ts:64) scans disk, inserts new rows into `skill_states` table with `enabled=1`.
2. **Toggle:** CLI `bun run dev skills disable {name}` or web `/skills` toggle updates `skill_states.enabled` for that skill.
3. **Prompt injection:** `ContextBuilder` queries disabled-skills set and omits them from **Active Skills** and **Skills Summary** sections.

Disabled skills are never exposed to the LLM, reducing distraction and token usage.

### Testing a Skill Locally

1. Create `~/.ghost/workspace/skills/{your-skill}/SKILL.md` with frontmatter + body.
2. Restart daemon: `bun run dev daemon stop && bun run dev daemon` (or kill + rerun in dev).
3. List skills: `bun run dev skills list` (CLI) or visit `/skills` (web UI).
4. Look for your skill in the listing. If requirements are missing, it shows `available: false` + missing list.
5. Toggle on (if off): `bun run dev skills enable {your-skill}` or use web UI.
6. Chat with Ghost — your skill prose is now in the system prompt.

Logs show skill injection: grep `ContextBuilder` in daemon output.

### When to Ship a Builtin vs. Workspace-Only

- **Builtin** (src/skills/builtin/): Core Ghost capabilities shipped with every installation. Examples: pre-trade-advisory, market-intel, technical-analysis. Requires code review, testing, and versioning.
- **Workspace-only**: Custom workflows for this user/team. Examples: a specialized tone rule for after-hours trading, or a risk metric override. No review needed; lives in user's home dir.

Workspace shadows builtin by name — if you want to override a builtin skill, copy it to workspace and edit.
