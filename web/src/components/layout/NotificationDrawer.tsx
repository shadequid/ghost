import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { renderTradingTags } from '@/lib/tradingTags';

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
        <div className="flex flex-col items-center gap-[14px] pt-[90px] px-4">
          <NoNotificationsIcon />
          <p className="m-0 text-body-md text-[var(--color-text-tertiary)] text-center">No notifications</p>
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

function NoNotificationsIcon() {
  return (
    <svg width="27" height="31" viewBox="0 0 27 31" fill="none" aria-hidden="true">
      <path d="M26.221 23.0376C25.6759 19.509 25.1195 15.9696 24.3286 12.4843C22.5345 4.57716 21.2265 -0.874473 11.1363 0.116119C3.77873 0.837778 2.86553 8.1314 1.65308 13.8331C1.0602 16.6197 0.423766 19.7861 0.0907987 22.5997C0.00228842 23.343 -0.164896 23.7687 0.432196 24.3877C1.93266 25.9431 4.58796 23.1025 6.03222 23.1795C7.05641 23.2349 7.58607 24.062 8.422 24.4039C10.986 25.4539 11.5423 23.4119 13.2015 23.4444C14.2763 23.466 14.6669 24.2904 15.5829 24.5431C18.1399 25.2485 18.7103 23.0943 20.51 23.1714C21.1352 23.1984 21.5819 23.6782 22.1186 23.9309C23.3816 24.5282 25.0408 25.4093 25.9161 24.2741C26.1887 23.9214 26.2856 23.47 26.2182 23.0362L26.221 23.0376ZM13.1215 15.6683C8.86315 15.6683 5.41125 12.6695 5.41125 8.97063C5.41125 5.27179 8.86315 2.27299 13.1215 2.27299C17.3798 2.27299 20.8317 5.27179 20.8317 8.97063C20.8317 12.6695 17.3798 15.6683 13.1215 15.6683Z" fill="#6E7480"/>
      <path d="M13.2444 10.245C12.6294 10.245 12.1194 9.735 12.1194 9.12V5.125C12.1194 4.51 12.6294 4 13.2444 4C13.8594 4 14.3694 4.51 14.3694 5.125V9.12C14.3694 9.75 13.8594 10.245 13.2444 10.245Z" fill="#3BF7BF"/>
      <circle cx="13.2694" cy="12.15" r="1.15" fill="#3BF7BF"/>
      <path d="M4.31824 30.8098C5.34023 30.8098 6.16872 30.014 6.16872 29.0324C6.16872 28.0507 5.34023 27.2549 4.31824 27.2549C3.29626 27.2549 2.46777 28.0507 2.46777 29.0324C2.46777 30.014 3.29626 30.8098 4.31824 30.8098Z" fill="#6E7480"/>
      <path d="M12.9535 30.8098C13.9755 30.8098 14.804 30.014 14.804 29.0324C14.804 28.0507 13.9755 27.2549 12.9535 27.2549C11.9315 27.2549 11.103 28.0507 11.103 29.0324C11.103 30.014 11.9315 30.8098 12.9535 30.8098Z" fill="#6E7480"/>
      <path d="M21.5892 30.8098C22.6112 30.8098 23.4397 30.014 23.4397 29.0324C23.4397 28.0507 22.6112 27.2549 21.5892 27.2549C20.5673 27.2549 19.7388 28.0507 19.7388 29.0324C19.7388 30.014 20.5673 30.8098 21.5892 30.8098Z" fill="#6E7480"/>
    </svg>
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
