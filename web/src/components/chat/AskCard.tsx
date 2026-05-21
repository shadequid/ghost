import { memo, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AskBlock, AskQuestion } from '@/lib/parseAskBlock';
import { formatAskReply } from '@/lib/parseAskBlock';
import { EditPencilIcon } from '@/components/icons/EditPencilIcon';

interface AskCardProps {
  block: AskBlock;
  onSubmit: (reply: string) => void;
  /** Closes the card without sending a message. The user can then type
   *  a free-form reply through the normal chat input. */
  onDismiss?: () => void;
}

const CARD_CLASS =
  'bg-[var(--color-surface-overlay)] border border-[var(--color-brand-subtle)] rounded-[var(--radius-fig-sm)] ' +
  'px-5 py-4 text-body-md text-text-primary shadow-[0_4px_4px_rgba(0,0,0,0.55)] ' +
  'relative w-full flex flex-col gap-3';

function ArrowCircleLeft() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M11.2562 14.5C11.0672 14.5 10.8781 14.4264 10.7289 14.2686L7.21642 10.5561C6.92786 10.2511 6.92786 9.74628 7.21642 9.44128L10.7289 5.72875C11.0174 5.42375 11.495 5.42375 11.7836 5.72875C12.0721 6.03374 12.0721 6.53856 11.7836 6.84356L8.79851 9.99869L11.7836 13.1538C12.0721 13.4588 12.0721 13.9636 11.7836 14.2686C11.6443 14.4264 11.4552 14.5 11.2562 14.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ArrowCircleRight() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M8.74378 14.5C8.55473 14.5 8.36567 14.4264 8.21642 14.2686C7.92786 13.9636 7.92786 13.4588 8.21642 13.1538L11.2015 9.99869L8.21642 6.84356C7.92786 6.53856 7.92786 6.03374 8.21642 5.72875C8.50498 5.42375 8.98259 5.42375 9.27114 5.72875L12.7836 9.44128C13.0721 9.74628 13.0721 10.2511 12.7836 10.5561L9.27114 14.2686C9.12189 14.4264 8.93284 14.5 8.74378 14.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

interface OptionsProps {
  options: string[];
  onPick: (value: string) => void;
}

function Options({ options, onPick }: OptionsProps) {
  return (
    <div className="flex flex-col gap-[11px] w-full">
      {options.map((opt, i) => (
        <button
          key={i}
          type="button"
          data-confirm-opt
          onClick={() => onPick(opt)}
          className={
            'flex h-10 items-center justify-start p-4 cursor-pointer select-none w-full ' +
            'border rounded-[var(--radius-fig-sm)] bg-transparent ' +
            'border-[var(--color-border-default)] text-text-primary ' +
            'hover:bg-[var(--color-brand-subtle)] hover:border-[var(--color-brand-subtle)] hover:text-[var(--color-brand-default)] ' +
            'focus:bg-[var(--color-brand-subtle)] focus:border-[var(--color-brand-subtle)] focus:text-[var(--color-brand-default)]'
          }
        >
          <span className="text-body-md">{opt}</span>
        </button>
      ))}
    </div>
  );
}

export const AskCard = memo(function AskCard({ block, onSubmit, onDismiss }: AskCardProps) {
  const total = block.questions.length;
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const submittedRef = useRef(false);
  // Synchronous lock: prevents burst events (IME composition, auto-repeat,
  // double-fire Enter) from skipping steps. Released after the step renders.
  const committingRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    committingRef.current = false;
    setFeedback('');
  }, [idx]);

  const question: AskQuestion = block.questions[idx]!;

  function commitAnswer(value: string) {
    if (submittedRef.current || committingRef.current) return;
    committingRef.current = true;
    const next = [...answers.slice(0, idx), value];
    setAnswers(next);
    if (idx + 1 < total) {
      setIdx(idx + 1);
    } else {
      submittedRef.current = true;
      onSubmit(formatAskReply(block.questions, next));
    }
  }

  function goPrev() {
    if (idx === 0) return;
    setIdx(idx - 1);
    setAnswers((a) => a.slice(0, idx - 1));
  }

  function dismiss() {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onDismiss?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target === inputRef.current) {
      if (e.key === 'Enter') {
        e.preventDefault();
        // IME composition (Vietnamese, Chinese, …): Enter confirms the
        // candidate, not the answer. Ignore until composition ends.
        if (composingRef.current || e.nativeEvent.isComposing) return;
        const text = feedback.trim();
        if (text) commitAnswer(text);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setFeedback('');
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goPrev();
    }
  }

  return (
    <div
      className={CARD_CLASS}
      role="region"
      aria-label={`Step ${idx + 1} of ${total}`}
      aria-live="polite"
      onKeyDown={onKeyDown}
    >
      {/* Header row: left column (pagination + title) | right X */}
      <div className="flex items-start justify-between w-full">
        <div className="flex flex-1 flex-col gap-2 justify-center min-w-0">
          <div className="flex items-center justify-between w-[87px]">
            <button
              type="button"
              aria-label="Previous step"
              disabled={idx === 0}
              onClick={goPrev}
              className="text-text-tertiary disabled:opacity-30 hover:text-text-primary bg-transparent border-none cursor-pointer p-0 flex items-center justify-center w-5 h-5"
            >
              <ArrowCircleLeft />
            </button>
            <p className="leading-[1.5]">
              <span className="text-body-lg-semibold text-[var(--color-brand-default)]">{idx + 1}</span>
              <span className="text-body-md text-text-secondary">/{total}</span>
            </p>
            <button
              type="button"
              aria-label="Next step"
              disabled
              className="text-text-tertiary opacity-30 bg-transparent border-none p-0 flex items-center justify-center w-5 h-5"
            >
              <ArrowCircleRight />
            </button>
          </div>
          <div className="text-body-lg-semibold text-text-primary">{question.title}</div>
        </div>
        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={dismiss}
            className="bg-transparent border-none text-text-tertiary hover:text-text-primary cursor-pointer p-0 flex items-center justify-center w-5 h-5 rounded shrink-0"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Main container: options + footer */}
      <div className="flex flex-col gap-5 w-full">
        {question.options && question.options.length > 0 && (
          <Options options={question.options} onPick={commitAnswer} />
        )}

        <div className="flex items-center gap-3 w-full">
          <span aria-hidden className="text-text-tertiary shrink-0">
            <EditPencilIcon />
          </span>
          <input
            ref={inputRef}
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            placeholder="Something else"
            aria-label="Custom value for this question"
            className="flex-1 bg-transparent border-none outline-none text-body-md text-text-primary placeholder:text-text-tertiary py-0 px-0 caret-[var(--color-brand-default)]"
          />
        </div>
      </div>
    </div>
  );
});
