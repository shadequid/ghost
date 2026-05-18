import { memo, useState, useCallback, type ReactNode } from 'react';
// Use the lazy wrapper so streamdown/shiki are not in the critical chunk —
// they load on demand when the first assistant message renders.
import { StreamingMarkdown } from './StreamingMarkdown.lazy';
import { ConfirmationCard } from './ConfirmationCard';
import { InlineConfirmButtons } from './InlineConfirmButtons';
import { hasInlineConfirm, stripConfirmText, confirmBorderColor } from './InlineConfirmButtons-utils';
import { ToolCallChips } from './ToolCallChips';
import type { ChatMessage, ToolCallEntry } from '@/lib/chatTypes';

interface MessageBubbleProps {
  message: ChatMessage;
  onAction?: (text: string) => void;
  onApprove?: (approvalId: string) => void;
  onReject?: (approvalId: string, reason?: string) => void;
  onToolCallSelect?: (entry: ToolCallEntry) => void;
  /** Re-send a user message. Wired for `message.role === 'user'` and for
   *  the inline retry link inside error bubbles (when `errorRetryText`
   *  is supplied). */
  onRetry?: (text: string) => void;
  /** When `message.type === 'error'`, the user-message content the inline
   *  retry link should re-send. Resolved by the parent (AgentChat.tsx)
   *  via `errorRetryText(messages, idx)`. Omitting hides the link. */
  errorRetryText?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTime(ts: Date): string {
  const now = new Date();
  const isToday =
    ts.getFullYear() === now.getFullYear() &&
    ts.getMonth() === now.getMonth() &&
    ts.getDate() === now.getDate();
  const hhmm = `${pad2(ts.getHours())}:${pad2(ts.getMinutes())}`;
  if (isToday) return `Today ${hhmm}`;
  return `${MONTHS[ts.getMonth()]} ${ts.getDate()} \u00B7 ${hhmm}`;
}

const COPY_FEEDBACK_MS = 1200;

// Figma node 161:135 (User) + 1077:4591 (Ghost). Both bubbles share a 15px
// rounded shell with a sharp pointer-corner toward the speaker (user → BR,
// ghost → TL). Body text is 15px — the Figma spec lands between body-md (14)
// and body-lg (16); 16 felt too heavy in live testing.
const USER_BUBBLE =
  'max-w-[75%] self-end ' +
  'bg-[var(--color-brand-soft)] ' +
  'rounded-[15px_15px_0px_15px] px-4 py-3 ' +
  'text-[15px] leading-[1.5] text-text-primary break-words whitespace-pre-wrap';

const ASSISTANT_BUBBLE =
  'max-w-[92%] self-start ' +
  'bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)] ' +
  'rounded-[0px_15px_15px_15px] px-4 py-3 ' +
  'text-[15px] leading-[1.5] text-text-primary break-words';

const ICON_BTN_BASE =
  'bg-transparent border-none p-1.5 rounded-[4px] ' +
  'flex items-center justify-center cursor-pointer ' +
  'transition-colors duration-fast ease-out';

// Hover-reveal CSS for .mb-actions lives in web/src/index.css alongside other
// chat styles — no runtime <style> injection needed.

export const MessageBubble = memo(function MessageBubble({ message, onAction, onApprove, onReject, onToolCallSelect, onRetry, errorRetryText }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const isError = message.type === 'error';
  const showInlineConfirm = !isUser && !message.type && onAction && hasInlineConfirm(message.content);
  const displayContent = showInlineConfirm ? stripConfirmText(message.content) : message.content;
  const borderColor = showInlineConfirm ? confirmBorderColor(message.content) : undefined;
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    }).catch(() => {});
  }, [message.content]);
  const handleRetry = useCallback(() => {
    if (onRetry) onRetry(message.content);
  }, [onRetry, message.content]);
  const handleErrorRetry = useCallback(() => {
    if (onRetry && errorRetryText) onRetry(errorRetryText);
  }, [onRetry, errorRetryText]);

  const copyBtn = (
    <button
      key="copy"
      className={
        `mb-actions ${ICON_BTN_BASE} ` +
        (copied
          ? 'text-[var(--color-success-text)]'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:text-[var(--color-text-primary)]')
      }
      title="Copy"
      aria-label={copied ? 'Copied' : 'Copy message'}
      onClick={handleCopy}
    >
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );

  const retryBtn = (
    <button
      key="retry"
      className={
        `mb-actions ${ICON_BTN_BASE} ` +
        'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:text-[var(--color-text-primary)]'
      }
      title="Retry"
      aria-label="Retry this message"
      onClick={handleRetry}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
    </button>
  );

  const timeEl = (
    <span key="time" className="text-number-sm text-[var(--color-text-secondary)]">
      {formatTime(message.timestamp)}
    </span>
  );

  // Side-aware footer order: assistant (left bubble) = [time, copy];
  // user (right bubble) = [retry, copy, time] when retry is wired, else
  // [copy, time]. Icons hug the message content (inward), timestamp sits
  // on the outer edge. Error bubbles show timestamp only — the user
  // doesn't need to copy or retry the error text itself (they retry the
  // user message above).
  let footerChildren: ReactNode[];
  if (isError) {
    footerChildren = [timeEl];
  } else if (isUser) {
    footerChildren = onRetry ? [retryBtn, copyBtn, timeEl] : [copyBtn, timeEl];
  } else {
    footerChildren = [timeEl, copyBtn];
  }

  return (
    <div
      className={`mb-row message-enter flex flex-col gap-0 ${isUser ? 'items-end' : 'items-start'}`}
    >
      {message.type === 'confirmation' && message.data && onApprove && onReject ? (
        <ConfirmationCard
          data={message.data}
          status={message.status ?? 'pending'}
          onApprove={onApprove}
          onReject={onReject}
        />
      ) : isError ? (
        // Error bubble: soft error-tinted background + 3px destructive left
        // edge + leading alert icon. Retry rendered as a pill button on the
        // right (when wired) so it reads as an actionable affordance rather
        // than an inline underline link.
        <div
          className={
            'max-w-[92%] self-start ' +
            'bg-[var(--color-error-subtle)] ' +
            'rounded-[var(--radius-fig-sm)_var(--radius-fig-sm)_var(--radius-fig-sm)_0] ' +
            'px-3.5 py-2.5 ' +
            'flex items-start gap-2.5 ' +
            'text-body-md text-text-primary break-words'
          }
          style={{ borderLeft: '3px solid var(--color-error-default)' }}
          // `status` (polite) over `alert` (assertive): new errors still
          // get announced, but switching sessions or reloading history
          // doesn't interrupt the user with stale errors that mount fresh.
          role="status"
          aria-live="polite"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="flex-none mt-0.5 text-[var(--color-error-text)]"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="flex-1">{message.content}</span>
          {onRetry && errorRetryText && (
            <button
              type="button"
              onClick={handleErrorRetry}
              className={
                'flex-none inline-flex items-center gap-1 ' +
                'text-label-sm ' +
                'text-[var(--color-error-text)] hover:text-text-primary focus-visible:text-text-primary ' +
                'bg-transparent hover:bg-[var(--color-error-soft)] focus-visible:bg-[var(--color-error-soft)] ' +
                'border border-[var(--color-error-soft)] hover:border-[var(--color-error-default)] ' +
                'rounded-[var(--radius-fig-sm)] px-2 py-1 cursor-pointer ' +
                'transition-colors duration-fast ease-out btn-press'
              }
              aria-label="Retry the previous message"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
              Retry
            </button>
          )}
        </div>
      ) : (
        <div
          className={isUser ? USER_BUBBLE : ASSISTANT_BUBBLE}
          style={borderColor ? { borderLeft: `3px solid ${borderColor}` } : undefined}
        >
          {isUser ? (
            message.content
          ) : (
            <StreamingMarkdown content={displayContent} streaming={message.streaming} />
          )}
          {showInlineConfirm && onAction && (
            <InlineConfirmButtons onAction={onAction} />
          )}
        </div>
      )}

      {!isUser && message.toolCalls && message.toolCalls.length > 0 && onToolCallSelect && (
        <ToolCallChips toolCalls={message.toolCalls} onSelect={onToolCallSelect} />
      )}

      {/* Footer (time + copy) stays hidden while the assistant message
          is still streaming — the timestamp would be premature and the
          copy icon would capture partial text. Shows as soon as the
          stream completes. User messages don't stream, so always shown.
          `mb-actions` keeps the whole row hidden until hover/focus —
          per chat design, the timestamp shouldn't compete with the
          message content at rest. */}
      {!message.streaming && message.type !== 'confirmation' && (
        <div
          className={`mb-actions flex items-center gap-1.5 mt-0.5 ${isUser ? 'self-end' : ''}`}
        >
          {footerChildren}
        </div>
      )}
    </div>
  );
});
