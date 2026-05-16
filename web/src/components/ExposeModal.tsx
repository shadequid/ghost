import { useState, useCallback } from 'react';
import { TerminalModal } from '@/components/TerminalModal';
import mouseCircleIcon from '@/assets/mouse-circle-expose.svg';

interface ExposeModalProps {
  open: boolean;
  onClose: () => void;
}

const OPTIONS = [
  {
    name: 'Tailscale Funnel',
    blurb: 'Public HTTPS via Tailscale, no port forwarding, free for personal use.',
    cmd: 'tailscale funnel 15401',
    docs: 'https://tailscale.com/kb/1223/funnel',
  },
  {
    name: 'Tailscale Serve (private)',
    blurb: 'HTTPS within your tailnet only — devices you control, not the public internet.',
    cmd: 'tailscale serve 15401',
    docs: 'https://tailscale.com/kb/1242/tailscale-serve',
  },
  {
    name: 'Cloudflare Tunnel',
    blurb: 'Public HTTPS via Cloudflare, requires the cloudflared CLI.',
    cmd: 'cloudflared tunnel --url http://localhost:15401',
    docs: 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/',
  },
  {
    name: 'ngrok',
    blurb: 'Quick public HTTPS for testing. Free tier rotates URLs on restart.',
    cmd: 'ngrok http 15401',
    docs: 'https://ngrok.com/docs/getting-started/',
  },
];

const COPY_FEEDBACK_MS = 1200;

function CopyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ExternalArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 11L11 5" />
      <path d="M6 5h5v5" />
    </svg>
  );
}

/** vuesax/outline/mouse-circle — exported from Figma node 586:4381 (mint
 *  outline of a circle + cursor-style L-shape inside). 20×20 inside the
 *  38×38 mint-tinted container. */
function MouseHero() {
  return <img src={mouseCircleIcon} alt="" aria-hidden="true" className="size-[20px] block" />;
}

export function ExposeModal({ open, onClose }: ExposeModalProps) {
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const handleCopy = useCallback((cmd: string) => {
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedCmd(cmd);
      setTimeout(() => setCopiedCmd((prev) => (prev === cmd ? null : prev)), COPY_FEEDBACK_MS);
    }).catch(() => {});
  }, []);

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title="Expose to Internet"
      width={720}
      hideHeader
      cardClassName="bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      bodyClassName="flex flex-col p-0"
    >
      {/* Figma 570:4087 — Header: title left, close right; pl-24/pr-16/py-16 */}
      <div className="flex items-center pl-6 pr-4 py-4 w-full">
        <div className="flex-1 min-w-0 flex items-center justify-between">
          <span className="text-body-lg-semibold text-white">Expose to Internet</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center w-7 h-7 rounded-[4px] bg-transparent border-0 cursor-pointer hover:bg-[rgba(255,255,255,0.04)] focus-visible:outline-none focus-visible:bg-[rgba(255,255,255,0.04)]"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-[var(--color-text-secondary)]" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-col items-center gap-5 px-6 pb-6 w-full">
        <div
          className="size-[38px] rounded-[10px] flex items-center justify-center"
          style={{
            background: 'rgba(59,247,191,0.08)',
            border: '1px solid rgba(59,247,191,0.08)',
          }}
        >
          <MouseHero />
        </div>

        <p className="text-body-md text-[var(--color-text-secondary)] leading-[1.5] m-0 w-full">
          Ghost runs locally on port 15401 (replace with your configured port if different).
          To reach it from other devices, use one of these tunnels.
        </p>

        <div className="flex flex-col gap-6 w-full">
          {OPTIONS.map((opt) => {
            const copied = copiedCmd === opt.cmd;
            return (
              <div key={opt.name} className="flex flex-col gap-2.5">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-body-md-medium text-[var(--color-text-primary)]">
                      {opt.name}
                    </span>
                    <a
                      href={opt.docs}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={
                        'btn-press inline-flex items-center gap-0.5 text-body-sm-medium ' +
                        'text-[var(--color-brand-default)] no-underline hover:opacity-80 ' +
                        'transition-opacity duration-fast ease-out'
                      }
                    >
                      Docs
                      <ExternalArrow />
                    </a>
                  </div>
                  <p className="text-body-sm text-[var(--color-text-tertiary)] m-0">
                    {opt.blurb}
                  </p>
                </div>
                <div
                  className={
                    'h-10 flex items-center justify-between gap-3 px-4 py-3.5 ' +
                    'bg-[var(--color-surface-raised,var(--color-surface-canvas))] rounded-[2px]'
                  }
                  style={{ border: '1px dashed var(--color-border-strong)' }}
                >
                  <pre className="flex-1 m-0 text-body-md font-mono text-[var(--color-text-primary)] overflow-x-auto whitespace-nowrap">
                    {opt.cmd}
                  </pre>
                  <button
                    type="button"
                    onClick={() => handleCopy(opt.cmd)}
                    title={copied ? 'Copied' : 'Copy command'}
                    aria-label={copied ? 'Copied' : `Copy ${opt.name} command`}
                    className={
                      'btn-press bg-transparent border-none p-1 rounded inline-flex items-center cursor-pointer ' +
                      'transition-colors duration-fast ease-out ' +
                      (copied
                        ? 'text-[var(--color-brand-default)]'
                        : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:text-[var(--color-text-primary)]')
                    }
                  >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </TerminalModal>
  );
}
