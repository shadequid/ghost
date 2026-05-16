import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover } from '@/components/Popover';

interface MenuItem {
  key: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
}

interface WidgetHeaderMenuProps {
  /** Trigger button content (e.g. the small filter icon). */
  trigger: ReactNode;
  /** Accessible label for the trigger button. */
  triggerLabel: string;
  /** Menu items shown in the dropdown. */
  items: ReadonlyArray<MenuItem>;
  /** Accessible label for the menu. */
  menuLabel: string;
}

/**
 * Header-icon dropdown used by News and Tweets widgets. Matches Figma
 * 984:4123 / 984:4158 — bordered surface-raised card with `gap-4` between
 * items, 16x16 icon + 13px label per row.
 *
 * Owns the open state, the outside-click handler, and Popover positioning
 * so the caller only supplies `items` and a `trigger`.
 */
export function WidgetHeaderMenu({ trigger, triggerLabel, items, menuLabel }: WidgetHeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className="bg-transparent border-none cursor-pointer text-text-tertiary hover:text-text-primary transition-colors duration-fast ease-out p-0 inline-flex items-center justify-center"
      >
        {trigger}
      </button>
      <Popover
        open={open}
        origin="top-right"
        onEscape={() => setOpen(false)}
        initialFocus="first"
        className={
          'absolute right-0 top-[calc(100%+6px)] z-50 min-w-[160px] ' +
          'bg-[var(--color-surface-raised)] border border-[var(--color-border-subtle)] ' +
          'drop-shadow-[0_16px_19px_rgba(0,0,0,0.45)] rounded-[4px] ' +
          'px-[14px] py-3 flex flex-col gap-4'
        }
        role="menu"
        aria-label={menuLabel}
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              item.onSelect();
            }}
            className="flex items-center gap-2 w-full bg-transparent border-none p-0 text-left cursor-pointer text-text-secondary hover:text-text-primary focus-visible:text-text-primary transition-colors duration-fast ease-out btn-press"
          >
            <span className="inline-flex shrink-0 size-4 items-center justify-center">{item.icon}</span>
            <span className="text-body-sm text-[var(--color-text-primary)] whitespace-nowrap">{item.label}</span>
          </button>
        ))}
      </Popover>
    </div>
  );
}
