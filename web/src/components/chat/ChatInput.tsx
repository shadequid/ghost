import { useState, useRef, useEffect, useCallback, type ChangeEvent } from 'react';
import { SlashMenu } from './SlashMenu';
import { SLASH_COMMANDS, NO_PARAM_COMMANDS } from './SlashMenu-commands';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface ChatInputProps {
  onSend: (text: string) => void;
  disabled: boolean;
  placeholder: string;
  isBusy: boolean;
  onAbort: () => void;
}

function expandSlashCommand(raw: string): string | null {
  const cmd = raw.trim().split(/\s+/)[0]?.toLowerCase();
  switch (cmd) {
    case '/news': return 'Summarize the latest crypto news';
    case '/analyze': return 'Analyze the current market';
    case '/alerts': return 'List my active price alerts with current price and distance to target.';
    case '/help': return 'What commands and features are available?';
    default: return null;
  }
}

const TEXTAREA_CLASS =
  'w-full bg-transparent border-none p-0 text-text-primary text-body-md ' +
  'outline-none resize-none min-h-[21px] max-h-[160px] box-border block leading-[1.5]';

const OVERLAY_CLASS =
  'absolute top-0 left-0 right-0 text-text-tertiary text-body-md leading-[1.5] ' +
  'pointer-events-none whitespace-nowrap overflow-hidden text-ellipsis';

export function ChatInput({
  onSend, disabled, placeholder, isBusy, onAbort,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [slashIdx, setSlashIdx] = useState(0);
  const [slashDismissed, setSlashDismissed] = useState(false);
  const composingRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const filteredCommands = input.startsWith('/') && focused && !slashDismissed
    ? SLASH_COMMANDS.filter((c) => c.cmd.startsWith(input.split(/\s/)[0] ?? ''))
    : [];

  const doSend = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    const expanded = trimmed.startsWith('/') ? expandSlashCommand(trimmed) : null;
    onSend(expanded ?? trimmed);
    setInput('');
    setSlashIdx(0);
    setSlashDismissed(false);
  }, [disabled, onSend]);

  const handleSlashSelect = useCallback((cmd: string) => {
    if (NO_PARAM_COMMANDS.has(cmd)) {
      doSend(cmd);
    } else {
      setInput(cmd + ' ');
      setSlashDismissed(true);
      setSlashIdx(0);
      textareaRef.current?.focus();
    }
  }, [doSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (filteredCommands.length > 0) {
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIdx((p) => (p > 0 ? p - 1 : filteredCommands.length - 1)); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIdx((p) => (p < filteredCommands.length - 1 ? p + 1 : 0)); return; }
      if (e.key === 'Tab') { e.preventDefault(); const sel = filteredCommands[slashIdx]; if (sel) handleSlashSelect(sel.cmd); return; }
      if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) { e.preventDefault(); const sel = filteredCommands[slashIdx]; if (sel) handleSlashSelect(sel.cmd); return; }
      if (e.key === 'Escape') { setSlashDismissed(true); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !composingRef.current) { e.preventDefault(); doSend(input); }
    if (e.key === 'Escape' && isBusy) { onAbort(); }
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    setSlashIdx(0);
    setSlashDismissed(false);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  useEffect(() => {
    if (!input && textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input]);

  useEffect(() => {
    if (!disabled) {
      textareaRef.current?.focus();
    }
  }, [disabled]);

  const canSend = !disabled && input.trim().length > 0;
  const showOverlay = !input;
  const useTypewriter = !disabled;

  const [typed, setTyped] = useState('');
  const [typingDone, setTypingDone] = useState(false);
  const prevPlaceholder = useRef(placeholder);

  useEffect(() => {
    if (placeholder !== prevPlaceholder.current) {
      prevPlaceholder.current = placeholder;
      setTyped('');
      setTypingDone(false);
    }
  }, [placeholder]);

  useEffect(() => {
    if (!useTypewriter || typingDone) return;
    // Reduced-motion: show the whole placeholder instantly instead of
    // running the per-character setTimeout loop.
    if (prefersReducedMotion()) {
      setTyped(placeholder);
      setTypingDone(true);
      return;
    }
    if (typed.length >= placeholder.length) {
      setTypingDone(true);
      return;
    }
    const delay = 30 + Math.random() * 25;
    const timer = setTimeout(() => {
      setTyped(placeholder.slice(0, typed.length + 1));
    }, delay);
    return () => clearTimeout(timer);
  }, [typed, placeholder, typingDone, useTypewriter]);

  const displayText = useTypewriter ? typed : placeholder;
  const showCursor = useTypewriter && !typingDone && showOverlay;

  return (
    <div className="flex justify-center px-4 pt-2 pb-4 bg-[var(--color-surface-scrim)]">
      <div
        className={
          'relative w-full max-w-[800px] bg-surface-overlay rounded-[9px] ' +
          'border border-[rgba(59,247,191,0.18)] shadow-[0_1px_8px_rgba(0,0,0,0.45)] flex flex-col gap-3 px-5 py-[14px] ' +
          'transition-opacity duration-base ease-out'
        }
        style={{ opacity: disabled ? 0.6 : 1 }}
      >
        {filteredCommands.length > 0 && (
          <SlashMenu commands={filteredCommands} selectedIndex={slashIdx} onSelect={handleSlashSelect} />
        )}
        <div className="relative">
          <label htmlFor="chat-input-textarea" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input-textarea"
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            rows={1}
            aria-label="Message"
            className={TEXTAREA_CLASS}
          />
          {showOverlay && (
            <div className={OVERLAY_CLASS} aria-hidden="true">
              <span>{displayText}</span>
              {showCursor && (
                <span
                  data-blink
                  className="opacity-60"
                  style={{ animation: 'blink 1s step-end infinite' }}
                >|</span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-number-sm text-text-tertiary select-none">
            Type / for commands
          </span>
          {isBusy ? (
            <button
              type="button"
              onClick={onAbort}
              aria-label="Stop response"
              className="btn-press inline-flex items-center justify-center w-[30px] h-[30px] rounded-full bg-error-soft text-error-text hover:bg-error-default hover:text-white focus-visible:bg-error-default focus-visible:text-white transition-colors duration-fast ease-out cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => doSend(input)}
              disabled={!canSend}
              aria-label="Send message"
              className={
                'btn-press inline-flex items-center justify-center w-[30px] h-[30px] rounded-full transition-colors duration-fast ease-out ' +
                (canSend
                  ? 'bg-brand-default text-text-on-brand hover:bg-[var(--color-brand-hover)] focus-visible:bg-[var(--color-brand-hover)] cursor-pointer'
                  : 'bg-surface-raised text-text-tertiary cursor-default opacity-60')
              }
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
