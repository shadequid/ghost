import { createContext } from 'react';

export interface WalletInfo {
  address: string;
  testnet: boolean;
  isDefault: boolean;
  source: string;
  status: "watch" | "trading";
  apiWalletAddress: string | null;
  addedAt: string;
}

export interface Balance {
  totalEquity: number;
  availableBalance: number;
  usedMargin: number;
  unrealizedPnl: number;
  spotBalance?: number;
}

export interface Position {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number | null;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  leverage: number;
  marginMode: string;
  margin: number;
  walletAddress?: string;
}

export interface OpenOrder {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  orderType: string;
  price: number | null;
  triggerPrice: number | null;
  size: number;
  filled: number;
  reduceOnly: boolean;
  timestamp: number;
}

/** Mirrors the server `NotificationKind` discriminator. The bell-dropdown
 *  filters to `price_target` only — other kinds (news, tp_hit,
 *  liquidation_risk, ...) land in chat history but don't badge the bell. */
export type NotificationKind =
  | 'price_target'
  | 'liquidation_risk'
  | 'position_closed'
  | 'tp_hit'
  | 'sl_hit'
  | 'order_filled'
  | 'order_canceled'
  | 'news'
  | 'proactive';

export interface Notification {
  id: string;
  kind: NotificationKind;
  symbol?: string;
  body: string;
  payload?: Record<string, unknown>;
  ts: string;
  dismissedAt?: string;
}

export type PortfolioStatus = 'idle' | 'loading' | 'connected' | 'no-wallet' | 'error';

export interface PerWalletPortfolio {
  address: string;
  status: string;
  testnet?: boolean;
  // Server nulls `balance` and sets `error` when a per-wallet Hyperliquid
  // call fails (e.g. 429). The aggregate request still returns
  // `connected: true`, so consumers must handle this partial-failure shape.
  balance: Balance | null;
  positions: Position[];
  openOrders: OpenOrder[];
  error?: string;
}

export interface AggregatePortfolio {
  totalEquity: number;
  totalAvailable: number;
  totalUnrealizedPnl: number;
  positionCount: number;
  orderCount: number;
  walletCount: number;
  perWallet: PerWalletPortfolio[];
}

export interface PortfolioContextValue {
  status: PortfolioStatus;
  wallets: WalletInfo[];
  balance: Balance | null;
  positions: Position[];
  openOrders: OpenOrder[];
  /** Visible price-target notifications. Other kinds are stored server-side
   *  but filtered out of the bell-dropdown by the hook; locally dismissed
   *  ids are also filtered out per the client-side-hide invariant. */
  notifications: Notification[];
  /** Ids that arrived since the drawer was last opened — bell badge. */
  unreadNotificationIds: ReadonlySet<string>;
  markNotificationsRead: () => void;
  /** Persist a soft-dismiss. Sets `dismissed_at` server-side so reload /
   *  cross-device stay hidden; the underlying row is preserved (not
   *  DELETE) per [[feedback_notification_dismiss_clientside]]. */
  dismissNotification: (id: string) => Promise<void>;
  aggregate: AggregatePortfolio | null;
  error: string | null;
  paperMode: boolean;
  refresh: () => void;
  lastFetchedAt: number;
  pollIntervalMs: number;
}

export const PortfolioContext = createContext<PortfolioContextValue | null>(null);
