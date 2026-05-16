import { useEffect, useMemo, useRef, useState, memo, forwardRef, type KeyboardEvent } from 'react';
import type { ConfirmationData, ConfirmationStatus } from '@/lib/confirmation-types';

export type { ConfirmationData, ConfirmationStatus };

interface ConfirmationCardProps {
  data: ConfirmationData;
  status: ConfirmationStatus;
  onApprove: (approvalId: string) => void;
  onReject: (approvalId: string, reason?: string) => void;
}

// ── derived render helpers ────────────────────────────────────────────────

/**
 * Tokenize the trader-facing title into spans so we can colour direction
 * nouns ("Long BTC", "Short ETH") without relying on the backend to ship
 * markup. Heuristic — matches the first occurrence of "long X" / "short X"
 * in any case. Anything that doesn't match falls through as plain text.
 */
function renderTitle(text: string): React.ReactNode {
  const re = /\b(long|short)\s+([A-Za-z]{2,10}(?:\s+[A-Za-z]{2,10})?)/i;
  const m = re.exec(text);
  if (!m || m.index === undefined) return text;
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + m[0].length);
  const cls = m[1].toLowerCase() === 'long' ? 'text-[var(--color-success-text)]' : 'text-[var(--color-error-text)]';
  return (
    <>
      {before}
      <span className={cls}>
        {m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()} {m[2].toUpperCase()}
      </span>
      {after}
    </>
  );
}

/**
 * For pre-flat-list session JSONL we still need to synthesize a body
 * because old payloads only had `summary` / `details` / `warnings`. The
 * synthetic list is used only when neither `lines` nor `steps` arrived.
 */
function fallbackLines(data: ConfirmationData): string[] {
  const out: string[] = [];
  if (data.summary) out.push(data.summary);
  if (data.details) {
    for (const [k, v] of Object.entries(data.details)) {
      out.push(`${k}: ${typeof v === 'number' ? v : String(v)}`);
    }
  }
  if (data.warnings) for (const w of data.warnings) out.push(`⚠ ${w}`);
  return out;
}

// Pretty title for the header. Describer-built titles already end in "?"
// (e.g. "Open Long BTC?"). Multi-step headers pass through as-is. LLM-
// supplied `_intent` is rendered verbatim — no auto-punctuation. We
// append "?" only when the upstream forgot to (older payloads / fall-
// backs) so the card always reads as a question.
function headerTitle(data: ConfirmationData): string {
  const t = data.actionLabel.trim();
  if (t.endsWith("?") || t.endsWith("？")) return t;
  return `${t}?`;
}

// ── status-state row (executing / executed / failed / expired) ─────────────

interface StatusRowProps {
  status: ConfirmationStatus;
  detail?: string;
}

function StatusRow({ status, detail }: StatusRowProps) {
  if (status === 'pending' || status === 'approved' || status === 'rejected') return null;
  let icon: string;
  let label: string;
  let toneClass: string;
  switch (status) {
    case 'executing':
      icon = '↻';
      label = 'Executing…';
      toneClass = 'text-[var(--color-info-text)]';
      break;
    case 'executed':
      icon = '✓';
      label = 'Executed';
      toneClass = 'text-[var(--color-success-text)]';
      break;
    case 'failed':
      icon = '✕';
      label = 'Failed';
      toneClass = 'text-[var(--color-error-text)]';
      break;
    case 'expired':
      icon = '⏱';
      label = 'Expired';
      toneClass = 'text-text-tertiary';
      break;
  }
  return (
    <div className="mt-1.5 flex flex-col gap-1">
      <div className={`flex items-center gap-2 text-body-sm-medium ${toneClass}`}>
        <span
          aria-hidden="true"
          className={status === 'executing' ? 'inline-block animate-spin' : 'inline-block'}
        >
          {icon}
        </span>
        <span>{label}</span>
      </div>
      {detail && (
        <div
          className={`pl-[22px] text-caption text-text-tertiary ${status === 'failed' ? 'italic' : ''}`}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

// ── main card ──────────────────────────────────────────────────────────────

const CARD_CLASS =
  'bg-surface-raised border border-[var(--color-brand-subtle)] rounded-[var(--radius-fig-sm)] ' +
  'p-5 text-body-md text-text-primary shadow-[0_1px_3px_rgba(0,0,0,0.45)] ' +
  'relative w-full flex flex-col gap-2.5';

export const ConfirmationCard = memo(function ConfirmationCard({
  data, status, onApprove, onReject,
}: ConfirmationCardProps) {
  const isPending = status === 'pending';
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const opt1Ref = useRef<HTMLDivElement>(null);
  const opt2Ref = useRef<HTMLDivElement>(null);

  // 0 = Confirm, 1 = Cancel. -1 = focus is in the feedback input.
  const [selected, setSelected] = useState<0 | 1 | -1>(0);
  const [feedback, setFeedback] = useState('');
  // Latched once the user has dispatched a decision. Prevents a second
  // RPC for the same approvalId during the window between client send
  // and server-emitted `trading.approval.resolved` (which would flip
  // `status` away from 'pending' and unmount these affordances).
  // Examples this protects against: rapid double-Enter on Confirm,
  // pressing Enter on feedback then clicking the dismiss X, or hitting
  // Esc immediately after Enter.
  const submittedRef = useRef(false);

  // Derived body — prefer structured fields; fall back to the legacy shape
  // only for old session JSONL playback. The legacy fallback ONLY fires
  // when `data.lines` is truly absent (undefined). An explicit empty array
  // means "tool intentionally has no bullets" — respect it and render nothing,
  // otherwise `fallbackLines` would push `data.summary` and produce a bullet
  // duplicating the title (cancel-all, emergency-close, etc.).
  const steps = data.steps && data.steps.length > 0 ? data.steps : undefined;
  const lines = useMemo(() => {
    if (data.lines !== undefined) return data.lines;
    if (steps) return [];
    return fallbackLines(data);
  }, [data, steps]);

  const titleNode = useMemo(() => {
    return renderTitle(headerTitle(data));
  }, [data]);

  // Auto-focus row 1 when this card becomes pending. Other pending cards
  // (rare — overlapping tool calls) coexist; only the bottom-most claims
  // the keyboard, mirroring the mock's "active card" behaviour.
  useEffect(() => {
    if (!isPending) return;
    const t = setTimeout(() => opt1Ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isPending]);

  // Decide whether THIS card is the active confirm for global key handling.
  // When two confirms are visible (parallel tool calls) only the
  // bottom-most should respond to ↑/↓/1/2/Enter/Esc.
  function isActiveCard(): boolean {
    const all = document.querySelectorAll<HTMLElement>('[data-confirm-card-pending]');
    if (all.length <= 1) return true;
    const last = all[all.length - 1];
    return last.getAttribute('data-confirm-card-pending') === data.approvalId;
  }

  function moveTo(idx: 0 | 1) {
    setSelected(idx);
    if (idx === 0) opt1Ref.current?.focus();
    else opt2Ref.current?.focus();
  }

  function focusInput() {
    setSelected(-1);
    inputRef.current?.focus();
  }

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
    if (text.length === 0) return;
    submittedRef.current = true;
    onReject(data.approvalId, text);
  }

  // Card-level keyboard handler. We attach it on the card so typing in
  // chat panes elsewhere on screen doesn't get intercepted.
  function onCardKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (!isPending || !isActiveCard()) return;
    const target = e.target as HTMLElement;
    const inInput = target === inputRef.current;
    if (inInput) {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitFeedback();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Esc inside input = blur back to options, do not cancel.
        setFeedback('');
        moveTo(0);
      }
      return; // never let 1/2/Enter/Esc-as-approve fire while typing
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (selected === 0) moveTo(1);
        else if (selected === 1) focusInput();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (selected === 1) moveTo(0);
        break;
      case '1':
        e.preventDefault();
        moveTo(0);
        break;
      case '2':
        e.preventDefault();
        moveTo(1);
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

  // Status detail line — for failed: surface reject reason or warnings.
  // For executed: keep it empty (chat surface emits the fill detail
  // through normal assistant text already).
  const statusDetail = useMemo(() => {
    if (status === 'failed' && data.warnings && data.warnings[0]) return data.warnings[0];
    return undefined;
  }, [status, data.warnings]);

  return (
    <div
      ref={cardRef}
      className={CARD_CLASS}
      role="region"
      aria-label={data.actionLabel}
      aria-live="polite"
      data-confirm-card-pending={isPending ? data.approvalId : undefined}
      onKeyDown={onCardKeyDown}
      style={{
        // Stable name so cross-status transitions can pair the old/new
        // node when an upstream wraps the status flip in a view transition.
        viewTransitionName: `confirm-${data.approvalId}`,
      } as React.CSSProperties}
    >
      {/* Title row */}
      <div className={`flex items-start justify-between gap-3 ${status === 'executing' ? 'opacity-60' : ''}`}>
        <div className="text-body-md-semibold text-text-primary">
          {titleNode}
        </div>
        {isPending && (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={cancel}
            className="bg-transparent border-none text-text-tertiary hover:text-text-primary cursor-pointer p-0 flex items-center justify-center w-5 h-5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus)] focus-visible:outline-offset-2"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {/* Description block — steps (numbered) then bullets */}
      {(steps || lines.length > 0) && (
        <ul
          className={`list-none m-0 p-0 pl-4 text-text-primary ${status === 'executing' ? 'opacity-60' : ''}`}
        >
          {steps?.map((s, i) => (
            <li
              key={`s-${i}`}
              className="relative pl-[22px] py-px text-body-sm"
            >
              <span
                aria-hidden="true"
                className="absolute left-0 top-0 text-body-sm text-text-primary"
              >
                {i + 1}.
              </span>
              {s}
            </li>
          ))}
          {lines.map((line, i) => {
            const isMuted = /^net:|^remaining:/i.test(line);
            return (
              <li
                key={`l-${i}`}
                className={`relative pl-[14px] py-px text-body-sm ${isMuted ? 'text-text-tertiary' : ''}`}
              >
                <span
                  aria-hidden="true"
                  className="absolute left-0 top-0 text-body-sm text-text-tertiary"
                >
                  •
                </span>
                {line}
              </li>
            );
          })}
        </ul>
      )}

      {/* Options block (pending only). Replaced by status row otherwise. */}
      {isPending ? (
        <div className="flex flex-col gap-[11px]">
          <Option
            ref={opt1Ref}
            num={1}
            label="Confirm"
            tone="execute"
            selected={selected === 0}
            onClick={() => { moveTo(0); approve(); }}
            onFocus={() => setSelected(0)}
          />
          <Option
            ref={opt2Ref}
            num={2}
            label="Cancel"
            tone="cancel"
            selected={selected === 1}
            onClick={() => { moveTo(1); cancel(); }}
            onFocus={() => setSelected(1)}
          />
          <FeedbackRow
            inputRef={inputRef}
            value={feedback}
            active={selected === -1}
            onChange={setFeedback}
            onFocus={() => setSelected(-1)}
          />
        </div>
      ) : (
        <StatusRow status={status} detail={statusDetail} />
      )}
    </div>
  );
});

// ── option row ─────────────────────────────────────────────────────────────

interface OptionProps {
  num: number;
  label: string;
  tone: 'execute' | 'cancel';
  selected: boolean;
  onClick: () => void;
  onFocus: () => void;
}

const Option = forwardRef<HTMLDivElement, OptionProps>(function Option(
  { num, label, tone, selected, onClick, onFocus },
  ref,
) {
  // Resting state for both tones is identical (no bg, text-primary,
  // border-default). On hover OR `:focus-visible` (keyboard-only), the
  // Confirm option flips to the mint affordance (brand-subtle bg + mint
  // text + brand-subtle border). The Cancel option only shifts its
  // border to strong. The global `*:focus-visible` mint outline is
  // suppressed for `[data-confirm-opt]` in `index.css` — the bg/text
  // shift is the focus indicator. `selected` is retained for the
  // keyboard handler's bookkeeping; it has no visual effect.
  void num;
  void selected;
  void tone;
  const containerClasses =
    'border-[var(--color-border-default)] text-text-primary ' +
    'hover:bg-[var(--color-brand-subtle)] hover:border-[var(--color-brand-subtle)] hover:text-[var(--color-brand-default)] ' +
    'focus:bg-[var(--color-brand-subtle)] focus:border-[var(--color-brand-subtle)] focus:text-[var(--color-brand-default)]';
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      data-confirm-opt
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={(e) => {
        // Prevent space from scrolling; treat as click for accessibility.
        if (e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={
        'flex h-10 items-center justify-start px-6 cursor-pointer select-none ' +
        'border rounded-[var(--radius-fig-sm)] ' +
        'transition-colors duration-fast ease-out ' +
        containerClasses
      }
    >
      <span className="text-body-md uppercase">{label}</span>
    </div>
  );
});

// ── feedback row (option 3) ────────────────────────────────────────────────

interface FeedbackRowProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  active: boolean;
  onChange: (v: string) => void;
  onFocus: () => void;
}

function FeedbackRow({ inputRef, value, active, onChange, onFocus }: FeedbackRowProps) {
  void active;
  return (
    <div className="flex items-center gap-3 mt-2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="15"
        height="15"
        viewBox="0 0 15 15"
        fill="none"
        aria-hidden="true"
        className="flex-none"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M8.51502 0.586544C9.29548 -0.195096 10.5613 -0.195575 11.3424 0.585473L13.0326 2.27574C13.807 3.05012 13.8151 4.30377 13.0507 5.08804L11.9292 6.23869L7.39688 1.70638L8.51502 0.586544ZM6.33703 2.76784L10.8821 7.31296L5.55501 12.7786C4.99058 13.3577 4.21646 13.6843 3.40811 13.6843L1.4994 13.6842C0.646564 13.6841 -0.0345123 12.9732 0.00135446 12.1205L0.0842832 10.1489C0.115882 9.39771 0.428106 8.68572 0.959173 8.15384L6.33703 2.76784ZM8.27521 13.6225C8.27521 14.0369 8.61087 14.3728 9.02493 14.3728H14.2212C14.6353 14.3728 14.9709 14.0369 14.9709 13.6225C14.9709 13.2082 14.6353 12.8723 14.2212 12.8723H9.02493C8.61087 12.8723 8.27521 13.2082 8.27521 13.6225Z"
          fill="var(--color-text-secondary)"
        />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
        placeholder="Type here to discuss more"
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
