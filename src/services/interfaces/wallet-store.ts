/**
 * Wallet store interface — shared contract for live and paper wallet stores.
 */

/** Wallet source — "chat" for agent-connected, or EIP-6963 RDNS (e.g. "io.rabby", "io.metamask") for UI-connected. */
export type WalletSource = string;
export type WalletStatus = "watch" | "trading";

export interface WalletData {
  address: string;
  privateKey: string;
  testnet: boolean;
  source?: WalletSource;
}

export interface WalletInfo {
  address: string;
  testnet: boolean;
  isDefault: boolean;
  source: WalletSource;
  status: WalletStatus;
  apiWalletAddress: string | null;
  addedAt: string;
}

export interface IWalletStore {
  /** Load the default wallet with trading enabled. Returns null if none. */
  load(): Promise<WalletData | null>;
  /** Save a wallet and set it as default. Sets status to "trading". */
  save(data: WalletData): Promise<void>;
  /** Add a watch-only wallet (no private key). Returns true if new, false if already existed. */
  addWatch(address: string, testnet: boolean, source: WalletSource): Promise<boolean>;
  /** Enable trading on a wallet by storing its API wallet key. */
  enableTrading(address: string, apiWalletAddress: string, privateKey: string): Promise<void>;
  /** List all wallets (without decrypted keys). */
  listWallets(): WalletInfo[];
  /** Get a specific wallet by address. */
  getWallet(address: string): WalletInfo | null;
  /** Set a wallet as the default (must have trading status). */
  setDefault(address: string): void;
  /** Remove a wallet and its credential. */
  remove(address: string): Promise<boolean>;
  /** Remove all wallets from a specific source. Returns removed addresses. */
  removeBySource(source: WalletSource): Promise<string[]>;
}
