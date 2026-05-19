import { useEffect, useState, useCallback, useRef, type ReactNode, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '@/components/ui';

interface TerminalModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
  /** Extra header-right content (e.g. action buttons) placed before close button */
  headerRight?: ReactNode;
  /** Disable close interactions (e.g. during async ops) */
  preventClose?: boolean;
  /** Override the card's outer classes (bg / border / radius / shadow).
   *  Defaults to the Figma modal surface: `bg-surface-base` +
   *  `border-border-default` + `rounded-[2px]` + soft drop shadow. */
  cardClassName?: string;
  /** Override the body wrapper classes. Defaults to `p-4`. */
  bodyClassName?: string;
  /** Suppress the default header bar (title + close button). The caller
   *  takes ownership of header + close affordance via `children`. The
   *  ESC key still closes the dialog. */
  hideHeader?: boolean;
}

const ANIM_MS = 180;
const FOCUSABLE_SEL =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), iframe, object, embed, ' +
  '[tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function TerminalModal({ open, onClose, title, children, width = 600, headerRight, preventClose, cardClassName, bodyClassName, hideHeader }: TerminalModalProps) {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Sync visibility with open prop
  useEffect(() => {
    if (open) {
      setClosing(false);
      setVisible(true);
    } else if (visible && !closing) {
      setClosing(true);
      timerRef.current = setTimeout(() => {
        setVisible(false);
        setClosing(false);
      }, ANIM_MS);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animated close
  const animatedClose = useCallback(() => {
    if (preventClose || closing) return;
    setClosing(true);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      setClosing(false);
      onClose();
    }, ANIM_MS);
  }, [onClose, preventClose, closing]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // ESC key
  useEffect(() => {
    if (!visible || preventClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') animatedClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, animatedClose, preventClose]);

  // Lock body scroll
  useEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [visible]);

  // Focus management: capture opener, move focus into dialog, restore on close.
  // Tab/Shift+Tab cycle within the dialog (focus trap). Inline implementation —
  // no dependencies. Covers children rendered inside this modal (XAuthModal,
  // SkillUploadModal), so those components don't need their own traps.
  useEffect(() => {
    if (!visible) return;
    openerRef.current = (document.activeElement as HTMLElement) ?? null;
    // Defer one frame so the dialog is painted + children mounted before we
    // query focusable descendants.
    const raf = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SEL);
      const first = focusables[0];
      if (first) first.focus();
      else dialog.focus();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SEL),
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialog.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      // Restore focus to the element that opened the modal.
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [visible]);

  if (!visible) return null;

  // Animation names depend on `closing` (runtime state), so they stay inline.
  const overlayAnim: CSSProperties = {
    animation: closing
      ? `tm-overlay-out ${ANIM_MS}ms ease-in forwards`
      : `tm-overlay-in ${ANIM_MS}ms ease-out`,
  };
  const modalAnim: CSSProperties = {
    animation: closing
      ? `tm-modal-out ${ANIM_MS}ms ease-in forwards`
      : 'tm-modal-in 200ms ease-out',
  };

  // Portal to body so the modal's paint order is above any compositor
  // layers created by transforms/animations elsewhere in the app (eg.
  // `.message-enter` in chat). Without this, z-index alone can't win
  // against GPU-promoted sibling branches.
  // Top-aligned with a 100px gap from the viewport top. The card itself
  // scrolls if its content exceeds the remaining height (vh − 100px top
  // gap − 24px bottom safety).
  const overlayNode = (
    <div
      className="fixed inset-0 z-[10010] bg-[var(--color-surface-scrim)] backdrop-blur-[4px] flex items-start justify-center pt-[100px] pb-6 px-4 overflow-y-auto"
      style={overlayAnim}
      onClick={(e) => { if (e.target === e.currentTarget) animatedClose(); }}
    >
      <div
        ref={dialogRef}
        className={
          (cardClassName ?? 'bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px] shadow-[0_8px_32px_rgba(0,0,0,0.5)]')
          + ' w-full max-h-[calc(100vh-124px)] overflow-y-auto'
        }
        style={{ ...modalAnim, maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {!hideHeader && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)]">
            <div className="flex items-center gap-3">
              {/* Title — 16px medium, matches the hideHeader-mode title style
                  used by TelegramSetupModal / XAuthModal / ExposeModal so the
                  default-header modals (Trade History, Upload Skill, External
                  Link) read at the same weight. */}
              <span className="text-body-lg-semibold text-text-primary">{title}</span>
            </div>
            <div className="flex items-center gap-2">
              {headerRight}
              <IconButton
                variant="ghost"
                size="sm-plus"
                onClick={animatedClose}
                disabled={preventClose}
                aria-label="Close"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </IconButton>
            </div>
          </div>
        )}
        <div className={bodyClassName ?? 'p-4'}>
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(overlayNode, document.body);
}
