# Skills Authoring Guide

This guide teaches you how to write a new skill for Ghost. A skill is a markdown file with YAML frontmatter that teaches the LLM agent how to behave in specific contexts.

## Skill Anatomy

Every skill has two parts:

1. **Frontmatter** (YAML, between `---` markers)
   - `name` — kebab-case identifier (required)
   - `description` — one-line summary (required)
   - `always` — boolean, inject every turn (optional)
   - `metadata` — requirements object (optional)

2. **Body** (markdown)
   - Plain prose explaining when/how to use the skill
   - Examples, tables, warnings, decision trees
   - No limit on length, but keep it scannable

### Minimal Example

```yaml
---
name: respectful-pushback
description: "Gently challenge requests that conflict with trader's stated plan."
---

# Respectful Pushback

When the trader asks to do something that contradicts their stated strategy:

- Reference their earlier statement: "You said SL at $X, but this trade puts it $Y higher."
- Propose an alternative: "Either adjust the SL or adjust the trade."
- Respect their final choice — don't re-argue after they decide.

Use a calm, supportive tone. No lectures or judgment.
```

## File Layout

Create a directory, put SKILL.md inside:

```
~/.ghost/workspace/skills/
├── respectful-pushback/
│   └── SKILL.md
├── risk-limit-enforcer/
│   └── SKILL.md
└── (other skills)
```

Builtin skills follow the same layout under `src/skills/builtin/`.

## Naming Rules

- **Kebab-case** — all lowercase, hyphens separate words
- **Descriptive** — `tone-after-hours` not `skill1`
- **Unique** — no duplicates in workspace or builtin (workspace shadows builtin by name)
- **Alphanumeric + hyphens only** — matches `NAME_PATTERN` regex (src/skills/loader.ts:40)

Examples: `pre-trade-advisory`, `market-intel`, `risk-manager`, `tone-respectful`.

## Frontmatter Spec

### name (required)

Kebab-case identifier. Workspace skills shadow builtin by name — if you create a skill named `pre-trade-advisory` in workspace, it overrides the builtin.

### description (required)

One-line summary. Used in skill listings (`bun run dev skills list`, web `/skills`). Be concise — 60 chars ideal.

### always (optional)

Boolean. If `true`, this skill is always injected into the system prompt. Use sparingly — max ~5 always-on skills to keep prompt size reasonable.

**Example:** `pre-trade-advisory` is always-on because it shapes every trade interaction.

### metadata (optional)

Declare external dependencies. Parser looks for `ghost` object with `requires`:

```yaml
metadata:
  ghost:
    requires:
      bins: ["python3", "ffmpeg"]
      env: ["OPENROUTER_API_KEY"]
```

When a skill has missing requirements, it shows as `available: false` in listings, and the LLM is not given access to it. Use this to gate skills that need specific tools or credentials.

## Body Writing Tips

1. **Lead with purpose** — Start with when/why to use this skill, not background theory.

   Good: "When the trader mentions sizing up after a loss, gently ask if they're revenge trading."

   Bad: "Revenge trading is a behavioral bias where..."

2. **Use examples, not rules** — Show what good/bad looks like.

   Good:
   ```
   Example (good): "Last trade closed red. Sure you want to enter again right now?"
   Example (bad): "Don't revenge trade."
   ```

   Bad: "Always detect revenge trading patterns."

3. **Be specific about triggers** — When does this skill apply?

   Good: "Triggers: trader places an order for 2x their usual size within 5 minutes of a loss."

   Bad: "This skill applies sometimes."

4. **Prose over lists** — Skill body is readable guidance, not checklist. Use lists only for data (e.g., "Missing requirements") or decision trees.

5. **Assume LLM will follow** — Don't hedge. Write as if the LLM will do exactly what you describe.

## Complete Example: Tone Rule for After-Hours Trading

```yaml
---
name: tone-after-hours
description: "Cautious, measured tone during illiquid hours (11pm-6am ET)."
---

# After-Hours Tone

## When

Trading during 11 PM to 6 AM ET (typical US market closure window).

## What

Reduce urgency in your communication. Spread is wider, volume drops, slippage risk climbs.

### Key shifts

- Don't encourage aggressive entry — "Wait for market hours if you want tight fills" is OK.
- Increase position-size caution — mention liquidity explicitly. "This size will move the book noticeably."
- Flag overnight news risk — "SEC often drops news early morning; gap risk higher right now."
- Suggest tighter SL — illiquid market can gap through your stop.

### Examples

**Good (after-hours awareness):**
> Entering now? Spread is wide right now (~$50), fills will slippage. If you're patient, waiting until market open gives you tighter fills and less tail risk.

**Bad (ignores after-hours context):**
> Just set the order. Liquidity is fine.

## What NOT to do

- Don't block the trader — always offer a "if you insist" version with tighter SL/smaller size.
- Don't assume the trader cares about spread — explain the impact on their trade (slippage, worse entry).
- Don't be preachy — matter-of-fact, data-driven tone.

## How to detect after-hours

Check `config.cron.timezone` for user's local time. Compare to ET window. If unsure, ask Ghost's runtime context (wall-clock time is injected).
```

This skill:

- Triggers on after-hours times (clear when).
- Changes tone, not capability (adds caution, not restriction).
- Provides examples of good/bad phrasing.
- Explains reasoning (spread, slippage, overnight gap).
- Respects trader autonomy (offers safer version, doesn't forbid).

## Integration Checklist

Before you deploy a skill:

- [ ] Frontmatter has `name`, `description`.
- [ ] Name is kebab-case, unique, descriptive.
- [ ] Body explains when/why, with examples.
- [ ] No preachy tone — descriptive, not prescriptive.
- [ ] If it has requirements, `metadata.ghost.requires` is set.
- [ ] File at `~/.ghost/workspace/skills/{name}/SKILL.md`.

## Testing

1. Drop SKILL.md in workspace/skills/{name}/.
2. Restart daemon or wait for sync (usually < 5s in dev).
3. Run `bun run dev skills list` — check that your skill appears.
4. Toggle on if needed: `bun run dev skills enable {name}`.
5. Chat with Ghost. If your skill is always-on or enabled, its prose is in the prompt.
6. Observe behavior — does the LLM follow your guidance?

For local dev:

```bash
# Create workspace skill directory
mkdir -p ~/.ghost/workspace/skills/my-skill
# Write SKILL.md
cat > ~/.ghost/workspace/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: "Test skill."
---
# My Skill
...
EOF

# Restart daemon and list
bun run dev daemon stop
bun run dev daemon
bun run dev skills list  # should show my-skill
```

## Publishing a Builtin Skill

Builtin skills are shipped with every Ghost installation. To publish:

1. Write the skill at `src/skills/builtin/{name}/SKILL.md`.
2. Get code review — ensure quality and alignment with Ghost values.
3. Test against eval suite — confirm skill improves behavior scores (src/eval/).
4. Merge to dev → released in next version.

Workspace skills don't require review — they're user-specific and don't affect the codebase.

## Common Patterns

### Emotional Detection

```markdown
## Emotion Signals

### FOMO
- Language: "now", "quickly", "before it moves"
- Behavior: Chases after big moves

**Response:** Name it gently. Show data that provides perspective.

### Revenge
- Language: "I'll get it back", "one more"
- Behavior: Sizes up after a loss on the same symbol

**Response:** Name the pattern. Suggest a break.
```

### Risk Guardrails

```markdown
## When to warn

- Leverage > 20x AND coin has ATR > 3%
- Total portfolio notional > 50x account balance
- Same symbol 3+ times in last hour

**Response:** Warn without blocking. Offer a safer version (lower lev, smaller size, tighter SL).
```

### Data-Driven Decision

```markdown
## Gather Context

Call these tools in parallel:
- ghost_get_positions() → exposure
- ghost_get_balance() → margin
- ghost_get_indicators(symbol, "4h") → trend

Synthesize into one view before responding.
```

## Reference

- Full skill example: src/skills/builtin/pre-trade-advisory/SKILL.md
- Loader: src/skills/loader.ts (parseFrontmatter, buildSkillsSummary)
- Service: src/services/skill-service.ts (syncState, enable/disable)
- Tags: docs/reference/memory-and-skills.md → "SOUL.md Tags" table
