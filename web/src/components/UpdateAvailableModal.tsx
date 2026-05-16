import { useCallback, useState } from 'react';
import { TerminalModal } from '@/components/TerminalModal';
import rocketIcon from '@/assets/rocket-update.svg';

interface UpdateAvailableModalProps {
  open: boolean;
  onClose: () => void;
}

const UPDATE_CMD = 'ghost update';
const COPY_FEEDBACK_MS = 1200;

export function UpdateAvailableModal({ open, onClose }: UpdateAvailableModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(UPDATE_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    }).catch(() => {});
  }, []);

  return (
    <TerminalModal
      open={open}
      onClose={onClose}
      title="New version available!"
      width={450}
      hideHeader
      cardClassName="bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px] shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
      bodyClassName="flex flex-col items-end gap-[15px] px-4 pt-4 pb-5"
    >
      {/* Figma 760:9624 — Header */}
      <div className="flex items-center justify-between w-full">
        <span className="text-body-md-semibold text-text-primary">New version available!</span>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="w-7 h-7 inline-flex items-center justify-center rounded-[6px] bg-transparent border-none cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] btn-press transition-colors duration-fast ease-out"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
            <path d="M3 3 L11 11 M11 3 L3 11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col items-center gap-3 w-full">
        <div
          className="size-[38px] rounded-[10px] flex items-center justify-center"
          style={{
            background: 'rgba(59,247,191,0.08)',
            border: '1px solid rgba(59,247,191,0.08)',
          }}
        >
          <RocketIcon />
        </div>

        <div className="flex flex-col items-center gap-4 w-full">
          <p className="text-body-sm text-[var(--color-text-tertiary)] m-0 w-full">
            A new update is ready, bringing improvements and exciting new features.
            Updating takes just two simple steps:
          </p>

          <Step n={1}>Open your Terminal.</Step>

          <div className="flex flex-col gap-2 w-full">
            <Step n={2}>Run the following command:</Step>
            <div className="pl-6 w-full">
              <div className="flex items-center justify-between h-9 px-4 bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] rounded-[4px]">
                <code className="text-body-sm text-[#5dfac9] font-mono">{UPDATE_CMD}</code>
                <button
                  type="button"
                  onClick={handleCopy}
                  title={copied ? 'Copied' : 'Copy command'}
                  aria-label={copied ? 'Copied' : 'Copy update command'}
                  className={
                    'btn-press bg-transparent border-none p-0 inline-flex items-center cursor-pointer ' +
                    'transition-colors duration-fast ease-out ' +
                    (copied
                      ? 'text-[var(--color-brand-default)]'
                      : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]')
                  }
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>
          </div>

          <p className="text-body-sm text-[var(--color-text-tertiary)] m-0 w-full">
            That&apos;s it! The update will run automatically — just make sure you&apos;re connected to the internet.
          </p>
        </div>
      </div>
    </TerminalModal>
  );
}

interface StepProps {
  n: number;
  children: React.ReactNode;
}

function Step({ n, children }: StepProps) {
  return (
    <div className="flex items-center gap-1.5 w-full">
      <span className="bg-[#2a2c31] inline-flex items-center justify-center rounded-full w-[18px] h-[18px] flex-none text-label-sm text-white">
        {n}
      </span>
      <span className="text-body-sm text-text-primary">{children}</span>
    </div>
  );
}

/** Iconex/Filled/Rocket — exported from Figma node 760:9700 (mint rocket
 *  pointing up-right). Asset color baked at #5DFAC9 (mint/300). */
function RocketIcon() {
  return <img src={rocketIcon} alt="" aria-hidden="true" className="size-[24px] block" />;
}

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
