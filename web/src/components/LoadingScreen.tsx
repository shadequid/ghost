interface LoadingScreenProps {
  /** 'connecting' during initial auth, 'reconnecting' when socket drops. */
  phase?: 'connecting' | 'reconnecting' | 'waking';
  /** Soft message below the title. */
  detail?: string;
}

export function LoadingScreen({ phase = 'connecting', detail }: LoadingScreenProps) {
  const title =
    phase === 'reconnecting' ? 'Reconnecting'
    : phase === 'waking' ? 'Waking up'
    : 'Connecting';

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-surface-canvas text-[var(--color-text-primary)] app-fade-in"
    >
      <div className="relative w-[52px] h-[52px] flex items-center justify-center">
        <svg width="52" height="52" viewBox="0 0 52 52" className="-rotate-90">
          <circle cx="26" cy="26" r="22" fill="none" stroke="rgba(0,255,136,0.12)" strokeWidth="2" />
          <circle
            data-loading-ring
            cx="26" cy="26" r="22" fill="none" stroke="#00ff88" strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray="138.23"
            style={{
              animation: 'loading-ring 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
              filter: 'drop-shadow(0 0 6px rgba(0, 255, 136, 0.45))',
            }}
          />
        </svg>
      </div>
      <div className="text-body-sm-medium tracking-[0.08em] text-[var(--color-text-primary)] uppercase">{title}</div>
      <div className="flex items-center gap-1" data-pulse-dots>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-[#00ff88]"
            style={{
              animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      {detail && (
        <div className="text-caption text-[var(--color-text-secondary)] text-center max-w-[300px]">
          {detail}
        </div>
      )}
    </div>
  );
}
