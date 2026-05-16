import { useEffect, useState } from 'react';
import { NotificationDropdown } from '@/components/layout/NotificationDropdown';
import { SystemMenuDropdown } from '@/components/layout/SystemMenuDropdown';
import { TelegramSetupModal } from '@/components/TelegramSetupModal';
import { useGateway } from '@/hooks/useGateway';
import brandIconDisconnected from '@/assets/topbar-brand-disconnected.svg';
import telegramConnectedBadge from '@/assets/telegram-connected-badge.svg';
import unlimitedBadge from '@/assets/topbar-status-unlimited.svg';

/**
 * Global top bar — right-aligned icon row matching the Figma layout
 * (node 297:3248). Lives above the 3-column shell on every route.
 *
 * Left → right: brand+badge (Telegram link) · notifications · settings (opens
 * the system menu dropdown).
 */
export function TopBar() {
  const [telegramOpen, setTelegramOpen] = useState(false);
  const telegramConnected = useTelegramConnected(telegramOpen);

  // Opaque bg hides scrolled sidebar content; decorations escape via z-index.
  return (
    <header className="relative z-20 flex items-center justify-end px-6 py-4 h-[53px] flex-shrink-0 bg-[var(--color-surface-canvas)]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setTelegramOpen(true)}
          className="relative w-8 h-8 shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-default)] rounded-full"
          aria-label={telegramConnected ? 'Telegram connected' : 'Connect Telegram'}
          title={telegramConnected ? 'Telegram connected' : 'Connect Telegram'}
        >
          <img
            src={telegramConnected ? telegramConnectedBadge : brandIconDisconnected}
            alt=""
            className="block w-8 h-8"
          />
          {telegramConnected ? (
            <img
              src={unlimitedBadge}
              alt=""
              className="absolute top-[0.5px] left-[22px] w-[13px] h-[13px]"
            />
          ) : null}
        </button>

        <NotificationDropdown />

        <SystemMenuDropdown />
      </div>

      <TelegramSetupModal open={telegramOpen} onClose={() => setTelegramOpen(false)} />
    </header>
  );
}

/**
 * Reflects whether Telegram is wired up. Polls the generic `channels.status`
 * RPC on connect / modal-close AND subscribes to `channel.state.changed`
 * events so the icon flips the moment the bot connects or disconnects —
 * no page reload required.
 */
function useTelegramConnected(modalOpen: boolean): boolean {
  const { connected, request, subscribe } = useGateway();
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    const refresh = (): void => {
      request<{ enabled: boolean }>('channels.status', { id: 'telegram' })
        .then((r) => { if (!cancelled) setLinked(Boolean(r?.enabled)); })
        .catch(() => { if (!cancelled) setLinked(false); });
    };

    // Initial fetch when the modal isn't suppressing polls.
    if (!modalOpen) refresh();

    // Live updates: connect/disconnect events from the daemon.
    const unsubscribe = subscribe((evt) => {
      if (evt.event !== 'channel.state.changed') return;
      const payload = evt.payload as { channel?: string } | undefined;
      if (payload?.channel === 'telegram') refresh();
    });

    return () => { cancelled = true; unsubscribe(); };
  }, [connected, modalOpen, request, subscribe]);

  return linked;
}
