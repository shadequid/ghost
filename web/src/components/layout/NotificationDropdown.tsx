// Bell icon → right-side notification drawer.
//
// Source: `usePortfolio().notifications` — server response is pre-filtered
// to `kind === 'price_target'` and locally-dismissed ids are hidden by the
// hook. Active alert-rule CRUD (`ghost_alert_set`, `ghost_alert_remove`,
// `/alerts`) happens through chat tools; this surface is read-only history.
import { useMemo, useState } from 'react';
import { usePortfolio } from '@/hooks/usePortfolio';
import { NotificationDrawer, type NotificationItem } from './NotificationDrawer';
import bellRingIcon from '@/assets/topbar-bell-ring.svg';

function formatRelative(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const diffMs = Date.now() - ms;
  const m = Math.floor(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

export function NotificationDropdown() {
  const { notifications, unreadNotificationIds, markNotificationsRead, dismissNotification } = usePortfolio();
  const [open, setOpen] = useState(false);

  const unreadCount = unreadNotificationIds.size;

  // Server pre-formats the `body` string (one shared formatter across web
  // + Telegram per [[feedback_alert_shared_body]]). Just map ts → relative.
  // Source is pre-filtered to `kind === 'price_target'` in usePortfolio, so
  // every row here is a price-move alert.
  const items = useMemo<NotificationItem[]>(() => {
    return notifications.slice(0, 50).map((n) => ({
      id: n.id,
      severity: 'info',
      label: 'Price move',
      time: formatRelative(new Date(n.ts).getTime()),
      message: n.body,
    }));
  }, [notifications]);

  function handleOpen() {
    setOpen(true);
    if (unreadCount > 0) markNotificationsRead();
  }

  return (
    <>
      <button
        className={
          'relative inline-flex items-center justify-center w-8 h-8 rounded-full ' +
          'bg-[var(--color-surface-base)] border border-[var(--color-border-subtle)] ' +
          'cursor-pointer transition-colors duration-fast ease-out ' +
          'hover:border-[var(--color-border-default)]'
        }
        onClick={handleOpen}
        aria-label="Notifications"
        title="Notifications"
      >
        <img src={bellRingIcon} alt="" className="w-[19px] h-[19px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-1 bg-destructive text-white text-footnote rounded-full min-w-[14px] h-[14px] px-[3px] flex items-center justify-center">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>
      <NotificationDrawer
        open={open}
        onClose={() => setOpen(false)}
        notifications={items}
        onDismiss={dismissNotification}
      />
    </>
  );
}
