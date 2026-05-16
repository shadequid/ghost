import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Stable ID associates the tooltip bubble with the trigger wrapper so
  // assistive tech can describe the wrapped interactive element.
  const tooltipId = useId();

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
  };
  const hide = () => setPos(null);

  return (
    <div
      ref={ref}
      className="inline-flex"
      aria-describedby={pos ? tooltipId : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      // Keyboard parity — screen-reader/keyboard users get the tooltip
      // when the wrapped control receives focus, matching hover behavior.
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {pos && createPortal(
        <div
          id={tooltipId}
          role="tooltip"
          className="fixed -translate-x-1/2 px-2 py-1 text-footnote text-[var(--color-text-primary)] bg-[#0f1a28] border border-[#1a2a3a] rounded-[4px] whitespace-nowrap pointer-events-none z-[9999] shadow-[0_4px_12px_rgba(0,0,0,0.4)]"
          style={{ top: pos.top, left: pos.left }}
        >
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-l-transparent border-r-transparent border-b-4 border-b-[#1a2a3a]"
          />
          {text}
        </div>,
        document.body,
      )}
    </div>
  );
}
