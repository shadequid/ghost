import { useEffect, useRef, useState, forwardRef, type KeyboardEvent } from 'react';
import type {
  ActionCardSingleStep as SingleStepData,
  ActionCardStatus,
} from '@/lib/action-card-types';
import { EditPencilIcon } from '@/components/icons/EditPencilIcon';

/**
 * Backend describers return raw verb-first titles ("Place bracket: …",
 * "Cancel order on BTC?") and the multi-step batched card uses its own
 * pre-prefixed "Confirm N actions?". Web wraps single-action titles into
 * a Confirm-prompt headline at render time so Telegram (which renders
 * the raw title verbatim) and the orchestrator's multi-batch path are
 * unaffected by web's UX choice.
 */
function confirmHeadline(title: string): string {
  if (!title) return title;
  if (/^confirm\b/i.test(title)) return title;
  return `Confirm ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

interface Props {
  data: SingleStepData;
  status: ActionCardStatus;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string, reason?: string) => void;
}

const CARD_CLASS =
  'bg-surface-raised border border-[var(--color-brand-subtle)] rounded-[var(--radius-fig-sm)] ' +
  'p-5 text-body-md text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.45)] ' +
  'relative w-full flex flex-col gap-2.5';

function StatusRow({ status, detail }: { status: ActionCardStatus; detail?: string }) {
  if (status === 'pending' || status === 'approved' || status === 'rejected') return null;
  let icon: string;
  let label: string;
  let tone: string;
  switch (status) {
    case 'executing':
      icon = '↻';
      label = 'Executing…';
      tone = 'text-[var(--color-info-text)]';
      break;
    case 'executed':
      icon = '✓';
      label = 'Executed';
      tone = 'text-[var(--color-success-text)]';
      break;
    case 'failed':
      icon = '✕';
      label = 'Failed';
      tone = 'text-[var(--color-error-text)]';
      break;
    case 'expired':
      icon = '⏱';
      label = 'Expired';
      tone = 'text-text-tertiary';
      break;
  }
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className={`flex items-center gap-2 text-body-sm-medium ${tone}`}>
        <span
          aria-hidden
          className={status === 'executing' ? 'inline-block animate-spin' : 'inline-block'}
        >
          {icon}
        </span>
        <span>{label}</span>
      </div>
      {detail && (
        <div
          className={`pl-[22px] text-caption text-text-tertiary ${
            status === 'failed' ? 'italic' : ''
          }`}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

interface OptionProps {
  label: string;
  onClick: () => void;
  onFocus: () => void;
}

const Option = forwardRef<HTMLDivElement, OptionProps>(function Option(
  { label, onClick, onFocus },
  ref,
) {
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      data-confirm-opt
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={
        'flex h-10 items-center justify-start p-4 cursor-pointer select-none ' +
        'border rounded-[var(--radius-fig-sm)] transition-colors duration-fast ease-out ' +
        'border-[var(--color-border-default)] text-text-primary ' +
        'hover:bg-[var(--color-brand-subtle)] hover:border-[var(--color-brand-subtle)] hover:text-[var(--color-brand-default)] ' +
        'focus:bg-[var(--color-brand-subtle)] focus:border-[var(--color-brand-subtle)] focus:text-[var(--color-brand-default)]'
      }
    >
      <span className="text-body-lg">{label}</span>
    </div>
  );
});

interface FeedbackRowProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  placeholder?: string;
}

function FeedbackRow({
  inputRef,
  value,
  onChange,
  onFocus,
  onCompositionStart,
  onCompositionEnd,
  placeholder,
}: FeedbackRowProps) {
  return (
    <div className="flex items-center gap-3 mt-2">
      <span aria-hidden className="text-text-tertiary shrink-0">
        <EditPencilIcon />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        placeholder={placeholder ?? 'Type here to discuss more'}
        aria-label="Feedback to Ghost"
        className={
          'flex-1 bg-transparent border-none outline-none text-body-md ' +
          'text-text-primary placeholder:text-text-tertiary py-0 px-0 ' +
          'caret-[var(--color-brand-default)]'
        }
      />
    </div>
  );
}

export function ActionCardSingleStep({ data, status, onApprove, onReject }: Props) {
  const isPending = status === 'pending';
  const inputRef = useRef<HTMLInputElement>(null);
  const opt1Ref = useRef<HTMLDivElement>(null);
  const opt2Ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<0 | 1 | -1>(0);
  const [feedback, setFeedback] = useState('');
  const submittedRef = useRef(false);
  // IME composition (Vietnamese diacritics, Chinese pinyin, …): Enter
  // confirms the candidate, not the feedback submit.
  const composingRef = useRef(false);

  useEffect(() => {
    if (!isPending) return;
    const t = setTimeout(() => opt1Ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isPending]);

  function approve() {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onApprove(data.approvalId);
  }
  function cancel() {
    if (submittedRef.current) return;
    submittedRef.current = true;
    onReject(data.approvalId);
  }
  function submitFeedback() {
    if (submittedRef.current) return;
    const text = feedback.trim();
    if (!text) return;
    submittedRef.current = true;
    onReject(data.approvalId, text);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!isPending) return;
    const target = e.target as HTMLElement;
    if (target === inputRef.current) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (composingRef.current || e.nativeEvent.isComposing) return;
        submitFeedback();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setFeedback('');
        opt1Ref.current?.focus();
        setSelected(0);
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (selected === 0) {
          opt2Ref.current?.focus();
          setSelected(1);
        } else if (selected === 1) {
          inputRef.current?.focus();
          setSelected(-1);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (selected === 1) {
          opt1Ref.current?.focus();
          setSelected(0);
        }
        break;
      case '1':
        e.preventDefault();
        opt1Ref.current?.focus();
        setSelected(0);
        break;
      case '2':
        e.preventDefault();
        opt2Ref.current?.focus();
        setSelected(1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selected === 0) approve();
        else if (selected === 1) cancel();
        break;
      case 'Escape':
        e.preventDefault();
        cancel();
        break;
    }
  }

  return (
    <div
      className={CARD_CLASS}
      role="region"
      aria-label={data.title}
      aria-live="polite"
      data-confirm-card-pending={isPending ? data.approvalId : undefined}
      onKeyDown={onKeyDown}
      style={{ viewTransitionName: `action-${data.approvalId}` } as React.CSSProperties}
    >
      <div
        className={`flex items-start justify-between gap-3 ${
          status === 'executing' ? 'opacity-60' : ''
        }`}
      >
        <div className="text-body-lg-semibold text-text-primary">{confirmHeadline(data.title)}</div>
        {isPending && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={cancel}
            className="bg-transparent border-none text-text-tertiary hover:text-text-primary cursor-pointer p-0 flex items-center justify-center w-5 h-5 rounded"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      {data.helper && <div className="text-body-sm text-text-tertiary">{data.helper}</div>}
      {data.actions && data.actions.length > 0 && (
        <ol className="list-decimal pl-5 m-0 flex flex-col gap-1 text-body-md text-text-secondary">
          {data.actions.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      {isPending ? (
        <div className="flex flex-col gap-[11px]">
          <Option
            ref={opt1Ref}
            label="Confirm"
            onClick={() => {
              setSelected(0);
              approve();
            }}
            onFocus={() => setSelected(0)}
          />
          <Option
            ref={opt2Ref}
            label="Cancel"
            onClick={() => {
              setSelected(1);
              cancel();
            }}
            onFocus={() => setSelected(1)}
          />
          <FeedbackRow
            inputRef={inputRef}
            value={feedback}
            onChange={setFeedback}
            onFocus={() => setSelected(-1)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={() => { composingRef.current = false; }}
            placeholder={
              data.suggestedValue
                ? `Enter custom value (suggested: ${data.suggestedValue})`
                : undefined
            }
          />
        </div>
      ) : (
        <StatusRow status={status} />
      )}
    </div>
  );
}
