# Memory and Skills: Ghost's Long-Term Context

Ghost learns about you through two mechanisms: **memory** (what it remembers) and **skills** (how it acts).

## What Ghost Remembers

Ghost maintains two memory files:

**MEMORY.md** (long-term facts)
- Your trading preferences: "I don't trade breakouts on low volume"
- Important events: "Lost $5k on DOGE — doesn't trade meme coins anymore"
- Your risk model: "Never more than 5x leverage"
- Market observations: "Funding rate spike precedes liquidation cascades"

**HISTORY.md** (timestamped log)
- Append-only archive: every session summary goes here
- You can search it: "When did we last discuss AAPL?"
- Ghost uses it to find patterns: "This is the 3rd time you've entered this level"

## How Memory Shapes Responses

**Example 1: You trade a pump**
- Day 1: You ask about DOGE at $0.25. Ghost says "Risky — you said no meme pumps."
- You trade anyway and lose $2k.
- Ghost updates MEMORY.md: "Learned: pumps burn. Reinforces: no meme trades."

- Day 7: SHIB is pumping. You ask "Worth a look?"
- Ghost reads MEMORY.md. "You said DOGE pumps rug. SHIB same pattern. Why is today different?"
- You don't trade. Ghost was useful.

**Example 2: Your risk model evolves**
- Month 1: "I want 2:1 reward-to-risk ratio."
- Ghost stores this in memory.
- Month 2: You realize your best trades have 1:1 ratios (tight stops).
- You say "Update my model to 1:1."
- Ghost updates MEMORY.md and uses 1:1 going forward.

## Skills: Teaching Ghost How to Act

A skill is a document that teaches Ghost specific behaviors. They live in the web dashboard under `/skills`.

**Default skills** (always active):
- Emotion awareness — detects FOMO, revenge trading, overconfidence
- Risk enforcement — checks position sizing against your limits
- Respectful pushback — reminds you of your stated strategy

**Optional skills** (enable/disable as needed):
- Technical analysis specialist — deeper chart analysis on demand
- News reactor — summarizes market news and impact
- Liquidation monitor — tracks whale liquidations on-chain

You control which skills are active. Turn off skills you don't need. Create custom skills for your unique style.

## When Memory Gets Too Big

As you trade with Ghost, the memory file grows. Eventually it could slow down the conversation.

Ghost handles this automatically:

1. **Consolidation**: Every few days, Ghost summarizes old conversations and archives them to HISTORY.md
2. **Active memory shrinks**: Only your current trading goals, risk model, and recent preferences stay in the active window
3. **No data loss**: Everything is searchable in HISTORY.md — Ghost just doesn't keep it all in the active chat
4. **You don't manage it**: It's automatic. You keep trading.

**Why this matters**: You don't need to worry about token budgets or memory caps. Ghost does the maintenance.

## Skill Customization

Write your own skill for very specific behaviors. Example: "After every loss, ask me: why did it fail?" 

See [Skills Authoring Guide](../contributing/skills-authoring.md) for how to write a custom skill.

You can also ask Ghost to tune existing skills:
- "Make you more aggressive on support bounces"
- "Warn me harder when I chase"

Ghost applies skill tweaks within the same session — no restart needed.
