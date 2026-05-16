/** Pure-logic helpers extracted from InlineConfirmButtons.tsx so the .tsx
 * file can satisfy react-refresh/only-export-components. */

const CONFIRM_PATTERN = /Confirm\b.*\?\s*\*{0,2}Yes\s*\/\s*No\*{0,2}\s*$/i;

export function hasInlineConfirm(content: string): boolean {
  return CONFIRM_PATTERN.test(content);
}

export function stripConfirmText(content: string): string {
  return content.replace(/Confirm\b.*\?\s*\*{0,2}Yes\s*\/\s*No\*{0,2}\s*$/i, '').trimEnd();
}

export function confirmBorderColor(content: string, decision?: string): string | undefined {
  if (!hasInlineConfirm(content) && !decision) return undefined;
  if (decision === 'yes' || decision === 'approved') return 'var(--color-success-text)';
  if (decision === 'no' || decision === 'rejected') return 'var(--color-error-text)';
  if (decision === 'expired') return 'var(--color-text-muted)';
  if (hasInlineConfirm(content)) return 'var(--color-warning-text)';
  return undefined;
}
