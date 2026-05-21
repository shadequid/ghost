---
name: ask-user-questions
description: "Ask the user via <asks> block whenever another skill needs the trader to supply missing information. Triggers: ask the user, ask, missing parameter, need clarification, need more info."
always: true
---

# Ask User Questions — `<asks>` block

When you need to ask the trader for input, emit an `<asks>` block. The
web renders it as a wizard card; Telegram flattens it to a numbered
list. The trader's answers come back in the next user message.

## Response shape

Every response that asks the user MUST be two parts in order:

1. **One short conversational sentence** acknowledging the trader's
   request, in their language.
2. The **`<asks>` block**.

Never emit the block alone — the card without prose feels robotic.

## Schema

```
<asks>
  <question>
    <title>{conversational question}</title>
    <options>
      <option>{value}</option>
      <option>{value}</option>
    </options>
  </question>
</asks>
```

- `<title>` — required. A full conversational sentence, not a label.
- `<options>` — required. 2-4 concrete preset values derived from real
  data (balance %, watchlist symbols, leverage ticks, S/R levels). The
  free-text input is a last-resort fallback, not a substitute for
  thinking up presets.

## One parameter per question, all questions in one block

Each `<question>` covers exactly ONE missing parameter — never bundle
multiple params into one `<option>`. But all missing params for the
same intent go in the SAME `<asks>` block, not split across multiple
turns. One block, multiple `<question>` children.

## Notes

- Wizard is the default form for collecting ≥2 intent params (symbol/size/leverage). Use it — don't fall back to a plain markdown bullet list.
- One option = one param value. Never bundle (e.g., side+size+leverage in one button).
- Each question: 2-4 concrete presets derived from data (watchlist, % balance, leverage ticks 3x/5x/10x/20x, S/R levels). Always derive — don't ship empty options.
- No analytical questions in wizard. OrderType (market vs limit), entry price, SL, TP, wait-vs-now, direction-without-TA-bias → propose in prose with reasoning, never as options.
- One question → prose (a 1-Q wizard is heavier than a chat answer). Cap each wizard at 3 questions. Never chain two wizards — between them is prose with your analysis (entry/SL/TP/bias).

## Example — collecting trade intent

Scenario: trader says "I want to enter a trade", wallet has $25 available, watchlist is [BTC, ETH, SOL], no open positions.

**Good** — short prose ack, then a wizard with one param per question and concrete presets:

```
Got it, I need a few things to set this up right.

<asks>
  <question>
    <title>Which coin do you want to trade?</title>
    <options>
      <option>BTC</option>
      <option>ETH</option>
      <option>SOL</option>
    </options>
  </question>
  <question>
    <title>Size in USD?</title>
    <options>
      <option>$5 (20% balance)</option>
      <option>$10 (40% balance)</option>
      <option>$15 (60% balance)</option>
    </options>
  </question>
  <question>
    <title>Leverage?</title>
    <options>
      <option>3x</option>
      <option>5x</option>
      <option>10x</option>
      <option>20x</option>
    </options>
  </question>
</asks>
```

**Bad** — common failures to avoid:

- Markdown bullet list with no `<asks>` block at all ("Which coin? Long or short? Size? Leverage?"). The wizard renders as a card; bullets render as text the trader has to type a reply to.
- Bundled options on one button: `<option>Long BTC $10 at 5x</option>` — changes 4 params at once, hides what's varying.
- Empty options (`<options></options>` or only `<option>Something else</option>`) — forces free-typing for a question with obvious presets.
- Analytical question with options: `<title>Market or limit?</title>` — that's Ghost's call after looking at S/R, not the trader's.