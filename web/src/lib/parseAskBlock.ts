/**
 * Parser for the `<asks>` block the agent emits when a write-tool intent
 * is missing a parameter. The block renders as a step-by-step wizard
 * card; answers come back to the agent as the next user message in plain
 * `Title = answer` lines, one per question.
 *
 * Schema + when-to-emit doctrine lives in the ask-user-questions skill
 * (src/skills/builtin/ask-user-questions/SKILL.md).
 *
 * Example:
 *
 *   <asks>
 *     <question>
 *       <title>Long or short?</title>
 *       <options>
 *         <option>long</option>
 *         <option>short</option>
 *       </options>
 *     </question>
 *     <question>
 *       <title>Size (USDC)?</title>
 *     </question>
 *   </asks>
 *
 * Notes:
 * - `<title>` is required.
 * - `<options>` is optional — when present, render as buttons. When
 *   absent, the trader uses the free-text input row.
 */

export interface AskQuestion {
  title: string;
  options?: string[];
}

export interface AskBlock {
  questions: AskQuestion[];
}

// Also accepts the legacy `<ask_user_question>` wrapper. CommonMark raw-HTML
// tokenization rejects underscores, so streamed legacy blocks reach the web
// markdown pipeline as escaped text — but parseAskBlock runs upstream on the
// raw chunk, so the block is still recoverable for the wizard card.
const BLOCK_RE = /<(asks|ask_user_question)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
const QUESTION_RE = /<question>([\s\S]*?)<\/question>/gi;
const TITLE_RE = /<title>([\s\S]*?)<\/title>/i;
const OPTIONS_RE = /<options>([\s\S]*?)<\/options>/i;
const OPTION_RE = /<option>([\s\S]*?)<\/option>/gi;

function parseQuestion(inner: string): AskQuestion | null {
  const title = TITLE_RE.exec(inner)?.[1]?.trim();
  if (!title) return null;
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
  return { title, ...(options ? { options } : {}) };
}

/**
 * Extract every `<asks>` block from `content`. Returns the content
 * stripped of those blocks plus the parsed blocks in encounter order.
 * Malformed blocks (no parseable question) are silently dropped along
 * with their source text. Tag matching is case-insensitive.
 */
export function extractAskBlocks(content: string): { stripped: string; blocks: AskBlock[] } {
  const blocks: AskBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  const stripped = content.replace(BLOCK_RE, (_full, _tag: string, inner: string) => {
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
 * ask-user-questions skill commits to a Q:/A: block per question, with a
 * blank line between pairs, so the LLM next turn can scan each Q line
 * back to the write-tool parameter the question was about.
 *
 * Example:
 *
 *   Q: Long or short?
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
