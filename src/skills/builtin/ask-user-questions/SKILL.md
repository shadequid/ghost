---
name: ask-user-questions
description: "Ask the user via <ask_user_question> block whenever another skill needs the trader to supply missing information. Triggers: ask the user, ask, missing parameter, need clarification, need more info."
always: true
---

# Ask User Questions — `<ask_user_question>` block

When you need to ask the trader for input, emit an `<ask_user_question>`
block. The web renders it as a wizard card; Telegram flattens it to a
numbered list. The trader's answers come back in the next user message.

## Response shape

Every response that asks the user MUST be two parts in order:

1. **One short conversational sentence** acknowledging the trader's
   request, in their language.
2. The **`<ask_user_question>` block**.

Never emit the block alone — the card without prose feels robotic.

## Schema

```
<ask_user_question>
  <question>
    <title>{conversational question}</title>
    <options>
      <option>{value}</option>
      <option>{value}</option>
    </options>
  </question>
</ask_user_question>
```

- `<title>` — required. A full conversational sentence, not a label.
- `<options>` — optional. Each `<option>` renders as a button. Use
  2-4 options derived from real data (recent fills, current price,
  S/R levels) when sensible presets exist. The free-text input below
  the buttons is always available — Options never lock the trader in.

## One parameter per question, all questions in one block

Each `<question>` covers exactly ONE missing parameter — never bundle
multiple params into one `<option>`. But all missing params for the
same intent go in the SAME `<ask_user_question>` block, not split
across multiple turns. One block, multiple `<question>` children.