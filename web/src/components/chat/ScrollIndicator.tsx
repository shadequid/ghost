interface ScrollIndicatorProps { visible: boolean; hasNew: boolean; onClick: () => void; }

export function ScrollIndicator({ visible, hasNew, onClick }: ScrollIndicatorProps) {
  if (!visible) return null;

  const label = hasNew ? 'New message' : 'Scroll to latest';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        'pointer-events-auto inline-flex items-center justify-center ' +
        'w-7 h-7 rounded-[5px] bg-[var(--color-brand-subtle)] ' +
        'text-[var(--color-brand-default)] ' +
        'cursor-pointer border-none btn-press ' +
        'transition-colors duration-fast ease-out hover:bg-[var(--color-brand-soft)]'
      }
    >
      <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
        <path d="M7.5 12.1875C7.09619 12.1875 6.69239 12.0305 6.38665 11.7222L2.62547 7.93045C2.45818 7.76179 2.45818 7.48264 2.62547 7.31399C2.79276 7.14534 3.06966 7.14534 3.23695 7.31399L6.99813 11.1058C7.27502 11.3849 7.72498 11.3849 8.00187 11.1058L11.7631 7.31399C11.9303 7.14534 12.2072 7.14534 12.3745 7.31399C12.5418 7.48264 12.5418 7.76179 12.3745 7.93045L8.61335 11.7222C8.30761 12.0305 7.90381 12.1875 7.5 12.1875Z" fill="currentColor" />
        <path d="M7.5 7.8125C7.09619 7.8125 6.69239 7.65548 6.38665 7.34725L2.62547 3.55545C2.45818 3.38679 2.45818 3.10764 2.62547 2.93899C2.79276 2.77034 3.06966 2.77034 3.23695 2.93899L6.99813 6.73079C7.27502 7.00994 7.72498 7.00994 8.00187 6.73079L11.7631 2.93899C11.9303 2.77034 12.2072 2.77034 12.3745 2.93899C12.5418 3.10764 12.5418 3.38679 12.3745 3.55545L8.61335 7.34725C8.30761 7.65548 7.90381 7.8125 7.5 7.8125Z" fill="currentColor" />
      </svg>
    </button>
  );
}
