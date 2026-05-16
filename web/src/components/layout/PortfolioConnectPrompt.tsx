import hyperliquidLogo from '@/assets/hyperliquid-logo.svg';

interface Props {
  onConnect: () => void;
}

function GhostAvatar() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34" fill="none" aria-hidden="true" className="shrink-0">
      <rect width="34" height="34" rx="17" fill="#3BF7BF" fillOpacity="0.08" />
      <rect x="0.5" y="0.5" width="33" height="33" rx="16.5" stroke="#3BF7BF" strokeOpacity="0.08" />
      <path d="M24.1482 21.3509C23.8507 19.4257 23.5472 17.4947 23.1157 15.5931C22.1368 11.279 21.4232 8.3046 15.918 8.84506C11.9038 9.2388 11.4055 13.2182 10.744 16.329C10.4206 17.8493 10.0733 19.5769 9.89166 21.112C9.84337 21.5175 9.75215 21.7498 10.0779 22.0875C10.8966 22.9362 12.3453 21.3863 13.1333 21.4283C13.6921 21.4586 13.981 21.9098 14.4371 22.0963C15.836 22.6692 16.1396 21.5551 17.0448 21.5728C17.6312 21.5846 17.8443 22.0344 18.3441 22.1723C19.7391 22.5572 20.0503 21.3819 21.0323 21.4239C21.3734 21.4386 21.6171 21.7004 21.9099 21.8383C22.599 22.1642 23.5043 22.6449 23.9818 22.0256C24.1305 21.8331 24.1834 21.5868 24.1466 21.3502L24.1482 21.3509ZM17.0011 17.3302C14.6778 17.3302 12.7945 15.6941 12.7945 13.676C12.7945 11.658 14.6778 10.0218 17.0011 10.0218C19.3245 10.0218 21.2078 11.658 21.2078 13.676C21.2078 15.6941 19.3245 17.3302 17.0011 17.3302Z" fill="#3BF7BF" />
      <path d="M12.198 25.5912C12.7556 25.5912 13.2076 25.157 13.2076 24.6214C13.2076 24.0858 12.7556 23.6516 12.198 23.6516C11.6404 23.6516 11.1884 24.0858 11.1884 24.6214C11.1884 25.157 11.6404 25.5912 12.198 25.5912Z" fill="#3BF7BF" />
      <path d="M16.9094 25.5912C17.467 25.5912 17.919 25.157 17.919 24.6214C17.919 24.0858 17.467 23.6516 16.9094 23.6516C16.3518 23.6516 15.8998 24.0858 15.8998 24.6214C15.8998 25.157 16.3518 25.5912 16.9094 25.5912Z" fill="#3BF7BF" />
      <path d="M21.6211 25.5912C22.1787 25.5912 22.6307 25.157 22.6307 24.6214C22.6307 24.0858 22.1787 23.6516 21.6211 23.6516C21.0635 23.6516 20.6115 24.0858 20.6115 24.6214C20.6115 25.157 21.0635 25.5912 21.6211 25.5912Z" fill="#3BF7BF" />
    </svg>
  );
}

function WalletIcon({ size = 16 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M8.66667 6.5H4.66667C4.39334 6.5 4.16667 6.27333 4.16667 6C4.16667 5.72667 4.39334 5.5 4.66667 5.5H8.66667C8.94001 5.5 9.16667 5.72667 9.16667 6C9.16667 6.27333 8.94001 6.5 8.66667 6.5Z" fill="#3BF7BF" />
      <path d="M12.6933 9.86662C11.6866 9.86662 10.8333 9.11995 10.7533 8.15995C10.6999 7.60662 10.9 7.06663 11.3 6.6733C11.6333 6.32663 12.1066 6.1333 12.6066 6.1333H13.9999C14.6599 6.1533 15.1666 6.67327 15.1666 7.31327V8.68665C15.1666 9.32665 14.66 9.84662 14.02 9.86662H12.6933ZM13.9799 7.1333H12.6133C12.3799 7.1333 12.1666 7.21996 12.0133 7.37996C11.82 7.56663 11.7266 7.81995 11.7533 8.07328C11.7866 8.51328 12.2133 8.86662 12.6933 8.86662H13.9999C14.0866 8.86662 14.1666 8.78665 14.1666 8.68665V7.31327C14.1666 7.21327 14.0866 7.13997 13.9799 7.1333Z" fill="#3BF7BF" />
      <path d="M10.6667 14.1667H4.66666C2.37333 14.1667 0.833328 12.6267 0.833328 10.3333V5.66666C0.833328 3.61333 2.09998 2.12667 4.06665 1.88C4.24665 1.85333 4.45333 1.83333 4.66666 1.83333H10.6667C10.8267 1.83333 11.0333 1.83999 11.2467 1.87333C13.2133 2.09999 14.5 3.59333 14.5 5.66666V6.63334C14.5 6.90667 14.2733 7.13334 14 7.13334H12.6133C12.38 7.13334 12.1667 7.22 12.0133 7.38L12.0067 7.38667C11.82 7.56667 11.7333 7.81331 11.7533 8.06665C11.7867 8.50664 12.2133 8.85998 12.6933 8.85998H14C14.2733 8.85998 14.5 9.08665 14.5 9.35998V10.3267C14.5 12.6267 12.96 14.1667 10.6667 14.1667ZM4.66666 2.83333C4.50666 2.83333 4.35332 2.84665 4.19999 2.86665C2.73332 3.05332 1.83333 4.11999 1.83333 5.66666V10.3333C1.83333 12.0533 2.94666 13.1667 4.66666 13.1667H10.6667C12.3867 13.1667 13.5 12.0533 13.5 10.3333V9.86665H12.6933C11.6866 9.86665 10.8333 9.11999 10.7533 8.15999C10.7 7.61332 10.9 7.06667 11.3 6.68001C11.6467 6.32667 12.1133 6.13334 12.6133 6.13334H13.5V5.66666C13.5 4.10666 12.5866 3.03331 11.1066 2.85998C10.9466 2.83331 10.8067 2.83333 10.6667 2.83333H4.66666Z" fill="#3BF7BF" />
    </svg>
  );
}

function HyperliquidAvatar() {
  return (
    <img
      src={hyperliquidLogo}
      alt=""
      width={34}
      height={34}
      className="size-[34px] shrink-0 object-cover"
      aria-hidden="true"
    />
  );
}

function DottedConnector() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="12" viewBox="0 0 36 12" fill="none" aria-hidden="true" className="shrink-0">
      <line y1="5.5" x2="11" y2="5.5" stroke="#3BF7BF" strokeDasharray="2 2" />
      <line x1="22.9997" y1="5.5" x2="35.9997" y2="5.5" stroke="#3BF7BF" strokeDasharray="2 2" />
      <path d="M13.3333 4.665V7.335C13.3333 8.995 14.5083 9.67 15.9433 8.845L16.5833 8.475C16.7383 8.385 16.8333 8.22 16.8333 8.04V3.96C16.8333 3.78 16.7383 3.615 16.5833 3.525L15.9433 3.155C14.5083 2.33 13.3333 3.005 13.3333 4.665Z" fill="#3BF7BF" />
      <path d="M17.3333 4.395V7.61C17.3333 7.805 17.5433 7.925 17.7083 7.825L18.2583 7.505C19.6933 6.68 19.6933 5.32 18.2583 4.495L17.7083 4.175C17.5433 4.08 17.3333 4.2 17.3333 4.395Z" fill="#3BF7BF" />
    </svg>
  );
}

/** "Connect Wallet" empty state — shown when status is `no-wallet` or `idle`.
 *  Figma node 215:1133. */
export function PortfolioConnectPrompt({ onConnect }: Props) {
  return (
    <div className="bg-[rgba(59,247,191,0.04)]">
      <div className="flex flex-col gap-4 items-center px-4 pt-6 pb-8">
        <div className="flex flex-col gap-3 items-center w-full">
          <div className="flex gap-3 items-center">
            <GhostAvatar />
            <DottedConnector />
            <HyperliquidAvatar />
          </div>
          <div className="flex flex-col gap-1.5 items-center leading-[1.5]">
            <p className="text-body-md-semibold text-white">Connect Wallet</p>
            <p className="text-body-sm text-text-secondary text-center">
              Connect your Hyperliquid wallet to unlock portfolio tracking, trading, and AI insights.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onConnect}
          className="btn-press border border-brand-default rounded-[4px] h-8 px-4 py-2.5 flex items-center justify-center gap-2.5 bg-transparent cursor-pointer transition-colors duration-fast ease-out hover:bg-[rgba(59,247,191,0.08)] focus-visible:bg-[rgba(59,247,191,0.08)]"
        >
          <WalletIcon size={16} />
          <span className="text-label-md leading-none text-brand-default whitespace-nowrap">
            Connect Wallet
          </span>
        </button>
      </div>
    </div>
  );
}
