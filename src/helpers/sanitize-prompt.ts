/**
 * Sanitize user-supplied text before embedding in system prompts.
 *
 * Strips LLM control tokens and system XML tags that could be used
 * for prompt injection.
 */

const LLM_CONTROL_TOKENS = [
  "<|im_start|>",
  "<|im_end|>",
  "<|system|>",
  "<|endoftext|>",
  "<|assistant|>",
  "<|user|>",
];

const SYSTEM_XML_PATTERN = /<\/?system>/gi;

export function sanitizeForPrompt(input: string): string {
  let result = input;
  for (const token of LLM_CONTROL_TOKENS) {
    result = result.replaceAll(token, "");
  }
  result = result.replace(SYSTEM_XML_PATTERN, "");
  return result;
}
