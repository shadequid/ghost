import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { renderTradingTags } from '@/lib/tradingTags';
import emptyNotificationsIllustration from '@/assets/empty-notifications.svg';

export type NotificationSeverity = 'info' | 'risk' | 'warning' | 'success';

export interface NotificationItem {
  id: string;
  severity: NotificationSeverity;
  /** Short severity label rendered in the top-left (e.g. "Info", "Risk"). */
  label: string;
  /** Pre-formatted relative time string (e.g. "4m ago"). */
  time: string;
  /** Body copy — short single-paragraph string. */
  message: string;
}

export interface NotificationDrawerProps {
  open: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  /** Called when the user clicks × on a card. Client-side hide only —
   *  the consumer is expected to filter the id out of `notifications`
   *  on the next render. */
  onDismiss?: (id: string) => void;
}

const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  info: 'var(--color-info-text)',
  risk: 'var(--color-warning-text)',
  warning: 'var(--color-warning-text)',
  success: 'var(--color-success-text)',
};

export function NotificationDrawer({ open, onClose, notifications, onDismiss }: NotificationDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  return createPortal(
    <>
      <div
        aria-hidden="true"
        data-drawer-scrim
        onClick={onClose}
        className={
          'fixed inset-0 z-[10001] bg-[var(--color-surface-scrim)] ' +
          'transition-opacity duration-base ease-out ' +
          (open ? 'opacity-100' : 'opacity-0 pointer-events-none')
        }
      />
      <aside
        role="dialog"
        aria-label="Notifications"
        aria-modal="true"
        data-drawer-panel
        className={
          'fixed top-0 right-0 h-screen w-[408px] z-[10002] ' +
          'bg-[var(--color-surface-canvas)] backdrop-blur-[12px] flex flex-col ' +
          'shadow-[-20px_4px_24px_0px_rgba(0,0,0,0.25)] ' +
          'transition-transform duration-base ease-out ' +
          (open ? 'translate-x-0' : 'translate-x-full pointer-events-none')
        }
      >
        <DrawerHeader onClose={onClose} />
        <NotificationList notifications={notifications} onDismiss={onDismiss} />
      </aside>
    </>,
    document.body,
  );
}

function DrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-4 shrink-0">
      <span className="text-body-lg-semibold text-white">Notification</span>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className={
          'w-7 h-7 inline-flex items-center justify-center rounded-[4px] ' +
          'bg-transparent border-none cursor-pointer ' +
          'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] ' +
          'btn-press transition-colors duration-fast ease-out'
        }
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

function NotificationList({
  notifications,
  onDismiss,
}: {
  notifications: NotificationItem[];
  onDismiss?: (id: string) => void;
}) {
  if (notifications.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto pb-2">
        <div className="flex flex-col items-center gap-[14px] pt-[119px] px-4">
          <img
            src={emptyNotificationsIllustration}
            alt=""
            width={168}
            height={145}
            className="block select-none"
            draggable={false}
            aria-hidden="true"
          />
          <p className="m-0 text-body-md text-[var(--color-text-secondary)] text-center">No notifications</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto px-4 pb-4">
      <div className="flex flex-col gap-2">
        {notifications.map((n) => (
          <NotificationCard key={n.id} item={n} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

function NotificationCard({
  item,
  onDismiss,
}: {
  item: NotificationItem;
  onDismiss?: (id: string) => void;
}) {
  return (
    <div
      className={
        'group relative bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)] ' +
        'rounded-[2px] px-4 py-3 ' +
        'drop-shadow-[20px_4px_12px_rgba(0,0,0,0.25)]'
      }
    >
      <div className="flex flex-col gap-1 w-full pr-6">
        <div className="flex items-center gap-3">
          <span
            className="text-body-md-semibold whitespace-nowrap"
            style={{ color: SEVERITY_COLOR[item.severity] }}
          >
            {item.label}
          </span>
          <span aria-hidden="true" className="inline-block w-[2px] h-[2px] rounded-full bg-[var(--color-text-secondary)]" />
          <span className="text-body-sm text-[var(--color-text-secondary)]">{item.time}</span>
        </div>
        <p className="text-body-sm text-white">{renderTradingTags(item.message)}</p>
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => onDismiss(item.id)}
          className={
            'absolute top-2 right-2 w-6 h-6 inline-flex items-center justify-center rounded-[4px] ' +
            'bg-transparent border-none cursor-pointer ' +
            'text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] ' +
            'btn-press transition-colors duration-fast ease-out'
          }
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
