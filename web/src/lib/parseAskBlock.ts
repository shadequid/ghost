/**
 * Parser for the `<AskUserQuestion>` block the agent emits when a
 * write-tool intent is missing a parameter. The block renders as a
 * step-by-step wizard card; answers come back to the agent as the next
 * user message in plain `Title = answer` lines, one per question.
 *
 * Schema + when-to-emit doctrine lives in the trade-executor skill
 * (src/skills/builtin/trade-executor/SKILL.md → "Asking for Missing
 * Params").
 *
 * Example:
 *
 *   <AskUserQuestion>
 *     <Question>
 *       <Title>Long hay short?</Title>
 *       <Suggestion>Còn $15,240 margin. 30d avg BTC size $400-600.</Suggestion>
 *       <Options>
 *         <Option>long</Option>
 *         <Option>short</Option>
 *       </Options>
 *     </Question>
 *     <Question>
 *       <Title>Size (USDC)?</Title>
 *       <Suggestion>Available: $15,240.</Suggestion>
 *     </Question>
 *   </AskUserQuestion>
 *
 * Notes:
 * - `<Title>` is required.
 * - `<Suggestion>` is optional — context the agent computed (account
 *   state, history) that helps the trader decide. Plain prose, no
 *   formatting tags.
 * - `<Options>` is optional — when present, render as buttons. When
 *   absent, the trader uses the free-text input row.
 * - `<Suggestion>` and `<Options>` are independent: a Question may
 *   have both, either, or just `<Title>`.
 */

export interface AskQuestion {
  title: string;
  suggestion?: string;
  options?: string[];
}

export interface AskBlock {
  questions: AskQuestion[];
}

const BLOCK_RE = /<ask_user_question>([\s\S]*?)<\/ask_user_question>/gi;
const QUESTION_RE = /<question>([\s\S]*?)<\/question>/gi;
const TITLE_RE = /<title>([\s\S]*?)<\/title>/i;
const SUGGESTION_RE = /<suggestion>([\s\S]*?)<\/suggestion>/i;
const OPTIONS_RE = /<options>([\s\S]*?)<\/options>/i;
const OPTION_RE = /<option>([\s\S]*?)<\/option>/gi;

function parseQuestion(inner: string): AskQuestion | null {
  const title = TITLE_RE.exec(inner)?.[1]?.trim();
  if (!title) return null;
  const suggestion = SUGGESTION_RE.exec(inner)?.[1]?.trim() || undefined;
  const optionsBlock = OPTIONS_RE.exec(inner)?.[1];
  let options: string[] | undefined;
  if (optionsBlock) {
    const collected: string[] = [];
    OPTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = OPTION_RE.exec(optionsBlock)) !== null) {
      const v = m[1].trim();
      if (v) collected.push(v);
    }
    if (collected.length > 0) options = collected;
  }
  return { title, ...(suggestion ? { suggestion } : {}), ...(options ? { options } : {}) };
}

/**
 * Extract every `<AskUserQuestion>` block from `content`. Returns the
 * content stripped of those blocks plus the parsed blocks in encounter
 * order. Malformed blocks (no parseable Question) are silently dropped
 * along with their source text.
 */
export function extractAskBlocks(content: string): { stripped: string; blocks: AskBlock[] } {
  const blocks: AskBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  const stripped = content.replace(BLOCK_RE, (_full, inner: string) => {
    const questions: AskQuestion[] = [];
    QUESTION_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = QUESTION_RE.exec(inner)) !== null) {
      const q = parseQuestion(m[1]);
      if (q) questions.push(q);
    }
    if (questions.length === 0) return '';
    blocks.push({ questions });
    return '';
  });
  return { stripped: stripped.replace(/\n{3,}/g, '\n\n').trim(), blocks };
}

/**
 * Build the canonical reply string from a populated answer list. The
 * trade-executor skill commits to a Q:/A: block per question, with a
 * blank line between pairs, so the LLM next turn can scan each Q line
 * back to the write-tool parameter the question was about.
 *
 * Example:
 *
 *   Q: Long hay short?
 *   A: long
 *
 *   Q: Size (USDC)?
 *   A: 100
 */
export function formatAskReply(questions: AskQuestion[], answers: string[]): string {
  return questions
    .map((q, i) => `Q: ${q.title}\nA: ${answers[i] ?? ''}`)
    .join('\n\n');
}
