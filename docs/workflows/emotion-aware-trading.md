# Emotion-Aware Trading

When you're tilted, Ghost notices.

Ghost watches your session memory — position history, win/loss streaks, trade size patterns, and the language you use — to spot behavioral traps before they spiral.

## FOMO: Chasing a Pump

```
03:15 — SOL pumps 12% in 30 minutes on coordinated Telegram group hype.

You: "entering SOL long 10x"

Ghost: Hold on. SOL is up 12%, funding is 0.025% (shorts expensive), and you 
already hold ETH long. Last time you added a second position after a 10%+ move 
and high funding: that trade lost $480.

Historical pattern: 3 times you've added after big pumps in the last 6 weeks. 
You took profit on 1 of them; the other 2 hit SL. The wins came from setups 
you'd pre-planned, not reactions to hype.

Consider: wait for a pullback to $156, then re-evaluate. What's your entry thesis?
```

You pause. You check the chart. The pump is momentum-driven, not fundamental. You pass.

## Revenge Trading: After a Stop-Out

```
14:30 — Your BTC short hits SL for -$1,240. Frustrating — you were right on 
direction, just tight SL.

You: "market ETH now, 15x, scaling in"

Ghost: I see 3 red flags.
1. You just took a -$1,240 loss 8 minutes ago.
2. You're proposing 15x (your average is 7x). Size and leverage both up.
3. In the last 3 months, every time you've entered within 10 minutes of a stop-out, 
   you've lost money. Average loss: -$340.

This is revenge trading. Your thesis on ETH is probably fine — but your emotional 
state makes the execution risky right now.

Suggestion: take a 30-minute break. Get coffee. Then re-examine ETH at 15:00 
with fresh eyes.
```

You close Ghost. You take the break. You come back. You skip the trade.

## Tilt: Rapid-Fire Same Coin

```
17:00 — You've opened and closed a position in SOL 4 times in 2 hours, 
sizes escalating (0.5 → 1.0 → 1.5 → 2.5 contracts). Net result: -$210.

You: "ONE MORE TIME, SOL long, 20x"

Ghost: Stop. You've traded SOL 4 times in 2 hours. Sizes increasing. 
You're down -$210. This is tilt.

Here's what I see:
- Trade 1: -$45 (thesis was right, just timing)
- Trade 2: -$80 (same coin, size up, anger talking)
- Trade 3: +$15 (lucky, not skill)
- Trade 4: -$100 (sizes exploded, lost discipline)

Tilt trades are *revenge + overconfidence + frustration*. You think "I can make 
it back fast," but actually your decision-making gets worse as losses compound.

I'm not executing this. Close SOL for now. Walk away. Come back tomorrow.
```

You see the pattern. You close the app.

---

## How Ghost Detects This

**Memory + Session Context** wired together:

1. **Memory store** (`src/memory/MEMORY.md`) tracks: historic win/loss streaks, trade sizes per coin, time-of-day patterns, and keywords (FOMO language, revenge language, "one more", "make it back").

2. **Session context** (`ghost_session_info` tool) reads: current positions, today's PnL, number of trades opened in the last hour, and the most recent 3 messages.

3. **Event-judge skill** (`src/skills/builtin/event-judge/`) runs on every input to assess emotional state: FOMO, revenge, overconfidence, paralysis, or tilt. If detected, Ghost flags and responds.

4. **Historical comparison** — Ghost pulls the trader's actual past with *the same trade setup on the same coin after similar situations*. Not abstract advice; concrete numbers from your history.

5. **Pattern breaking** — When you resist an emotional trap (like you did above), Ghost acknowledges it. This positive reinforcement is logged to memory and resurfaces on future temptations.

Reference: [PERSONAS.md](../../PERSONAS.md) (emotion-response framework) | [JOURNEYS.md](../../JOURNEYS.md) (narrative examples)
