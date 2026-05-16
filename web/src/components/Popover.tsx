import { forwardRef, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface PopoverProps {
  open: boolean;
  children: ReactNode;
  /** Where the popover is anchored — affects the scale transform-origin. */
  origin?: 'top-left' | 'top-right' | 'top-center' | 'bottom-left' | 'bottom-right';
  /** Slide distance in px at start. 0 disables slide, use fade-only. */
  slideY?: number;
  /** Duration in ms. Default 160 (snappy). */
  duration?: number;
  className?: string;
  style?: CSSProperties;
  /** Pass-through role/aria attributes. */
  role?: string;
  'aria-label'?: string;
  /**
   * On open, focus the first focusable child ('first') or leave focus alone
   * ('none'). Defaults to 'none' to avoid surprising existing consumers that
   * manage focus themselves. Menu-style popovers should opt in with 'first'.
   */
  initialFocus?: 'first' | 'none';
  /** Called when the user presses Escape while the popover is open. */
  onEscape?: () => void;
  /**
   * When true (default), Arrow Up/Down cycle focus through focusable children
   * ([role="menuitem"], <button>, <a>) inside the popover.
   */
  trapArrowKeys?: boolean;
  /**
   * When true (default), focus returns to the element that was focused at
   * the moment the popover opened once it closes.
   */
  returnFocusOnClose?: boolean;
}

const ORIGIN_MAP: Record<NonNullable<PopoverProps['origin']>, string> = {
  'top-left': 'top left',
  'top-right': 'top right',
  'top-center': 'top center',
  'bottom-left': 'bottom left',
  'bottom-right': 'bottom right',
};

const FOCUSABLE_SELECTOR =
  '[role="menuitem"], button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Mount-persistent fade+slight-scale wrapper for dropdowns, menus, and
 * floating panels. Keeps the node mounted during the exit animation so the
 * content doesn't yank away. Respects prefers-reduced-motion (snaps to final).
 */
export const Popover = forwardRef<HTMLDivElement, PopoverProps>(function Popover(
  {
    open,
    children,
    origin = 'top-left',
    slideY = 4,
    duration = 160,
    className,
    style,
    role,
    'aria-label': ariaLabel,
    initialFocus = 'none',
    onEscape,
    trapArrowKeys = true,
    returnFocusOnClose = true,
  },
  ref,
) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<'enter' | 'exit'>(open ? 'enter' : 'exit');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setMounted(true);
      // Two-frame delay so the enter transition fires from the exit state.
      requestAnimationFrame(() => requestAnimationFrame(() => setPhase('enter')));
    } else {
      setPhase('exit');
      timerRef.current = setTimeout(() => setMounted(false), duration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [open, duration]);

  // Capture opener on open, move focus on first paint, restore on close.
  useEffect(() => {
    if (!open) return;
    if (returnFocusOnClose) {
      const active = document.activeElement as HTMLElement | null;
      openerRef.current = active && active !== document.body ? active : null;
    }
    if (initialFocus === 'first') {
      // Wait one frame so children are laid out before querying focusables.
      requestAnimationFrame(() => {
        const first = innerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        first?.focus();
      });
    }
    return () => {
      if (returnFocusOnClose) openerRef.current?.focus?.();
    };
  }, [open, initialFocus, returnFocusOnClose]);

  // Keyboard: Escape + Arrow Up/Down cycling through focusable children.
  useEffect(() => {
    if (!open) return;
    const node = innerRef.current;
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onEscape) {
        e.stopPropagation();
        onEscape();
        return;
      }
      if (!trapArrowKeys) return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (items.length === 0) return;
      e.preventDefault();
      const idx = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx <= 0 ? items.length - 1 : idx - 1);
      items[next]?.focus();
    };
    node.addEventListener('keydown', onKey);
    return () => node.removeEventListener('keydown', onKey);
  }, [open, onEscape, trapArrowKeys]);

  if (!mounted) return null;

  const isEnter = phase === 'enter';

  // Transform/opacity/transition are driven by `phase` + `duration` (a prop),
  // so they stay as dynamic inline styles. `will-change` is static and lives
  // on the className.
  const popoverStyle: CSSProperties = {
    transformOrigin: ORIGIN_MAP[origin],
    opacity: isEnter ? 1 : 0,
    transform: isEnter ? 'translateY(0) scale(1)' : `translateY(${-slideY}px) scale(0.96)`,
    transition: `opacity ${duration}ms var(--ease-out, ease-out), transform ${duration}ms var(--ease-out, ease-out)`,
    ...style,
  };

  return (
    <div
      ref={(node) => {
        innerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      className={`will-change-[opacity,transform]${className ? ` ${className}` : ''}`}
      style={popoverStyle}
      role={role}
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
});
