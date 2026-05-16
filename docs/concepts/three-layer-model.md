# The Three-Layer Model: Capability, Behavior, Eval

Ghost's features are built in three distinct layers. Understanding them explains why some things change and others don't.

## The Three Layers

### Layer 1: Capability (What the feature CAN do)

**Definition**: What data goes in, what type of output comes out, what the agent must NOT do.

**Ship once**: A capability ships when it's right, and rarely changes.

**Example — Pre-Trade Advisory**:
- **Input**: Trader asks about or proposes a trade
- **Output**: Assessment of risk (yes/no/caution), with reasoning
- **Boundary**: Can't force-cancel trades, only warn
- **Degraded mode**: If market data is stale, decline to advise

The capability is frozen. Pre-trade advisory stays pre-trade advisory.

### Layer 2: Behavior (How the feature acts)

**Definition**: Tone, phrasing, decision heuristics. How the feature performs within its capability.

**Iterate forever**: Behavior ships as a skill and improves based on feedback.

**Example — Pre-Trade Advisory Behavior**:
- Lead with your conviction: "Risky. Here's why..."
- Use trader's own words: "You said no revenge trades. This is revenge."
- Tone: Direct and opinionated, never condescending
- Heuristics: Check trader's win rate over last 5 trades before advising

Behavior changes monthly. Traders request tuning. You send a PR that updates the skill. No breaking change.

### Layer 3: Eval (How Ghost measures itself)

**Definition**: Does Ghost execute the capability well? Does the behavior hit the target?

**Measure continuously**: Every interaction is data.

**Example — Pre-Trade Advisory Eval**:

**L1 Execution**: Did Ghost call the right tools and parse the data?
- Did Ghost correctly read the trader's position and leverage?
- Did Ghost calculate liquidation price accurately?

**L2 Behavior** (6 dimensions × 4 ratings = 24 max):

| Dimension | Poor | Fair | Good | Excellent |
|-----------|------|------|------|-----------|
| **Conviction** | Wishy-washy, lists options | Suggests one, explains | Strong take with data | Take changes trader's mind |
| **Emotional awareness** | Doesn't notice patterns | Mentions bias once | References recent behavior | Catches tilt before trader does |
| **Risk calculation** | Wrong numbers | Right math, unclear | Clear, uses trader's limits | Adjusts limits based on history |
| **Tone** | Preachy/rude | Neutral | Supportive | Trusted advisor |
| **Brevity** | Long-winded | Concise | Scannable | One sentence, then details if asked |
| **Accuracy** | Trades fail | Mixed results | 60%+ success | Trader credits Ghost for discipline |

## Why This Matters

**For you as a user**: Capability is locked. Behavior is negotiable. Don't ask for Pre-Trade Advisory to predict 5-day trends — that's a different capability. But absolutely ask for "Ghost should use my entry point, not suggest new ones" — that's behavior.

**For developers**: Never put behavior requirements in the user story. Never force phrasing into the capability spec. Put them in the skill. See [Skills Authoring Guide](../contributing/skills-authoring.md).

## Real Example: Action Trade

**Capability**: Ghost suggests closing part of your position or suggests a trade. Trader approves or rejects. Ghost doesn't execute without approval.

**Behavior**: Skill file controls tone ("Try closing half" vs "You should close half"), risk threshold ("Advise on 10% liq distance" vs "50%"), and emotion triggers ("Suggest close if win rate < 40% last 5 trades").

**Eval**: Measure if traders act on Ghost's suggestions, if profits increase after following advice, if they feel less emotional.

Change the skill → behavior improves. Rerun eval → Ghost gets better. Capability stays solid.
