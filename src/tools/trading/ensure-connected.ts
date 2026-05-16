/**
 * Auto-reconnect + read-address resolution for trading tools.
 * Heals desync between in-memory tradingClient and persistent walletStore.
 */

import type { ITradingClient } from "../../services/interfaces/trading-client.js";
import type { IWalletStore } from "../../services/interfaces/wallet-store.js";

/**
 * Ensure trading client has an address (write-capable). If disconnected,
 * attempts to reconnect from walletStore. Returns the address or null.
 */
export async function ensureConnected(hl: ITradingClient, walletStore: IWalletStore): Promise<string | null> {
  if (hl.address) return hl.address;
  try {
    const data = await walletStore.load();
    if (!data) return null;
    hl.connect(data);
    return hl.address || null;
  } catch {
    return null;
  }
}

/**
 * Resolve an address for read-only queries (balance, positions, orders).
 * Tries: hl.address → trading wallet from DB → first watch-only wallet.
 */
export async function resolveReadAddress(hl: ITradingClient, walletStore: IWalletStore): Promise<string | null> {
  const connected = await ensureConnected(hl, walletStore);
  if (connected) return connected;
  // Fall back to any wallet (including watch-only) for read queries
  const wallets = walletStore.listWallets();
  const defaultWallet = wallets.find((w) => w.isDefault);
  if (defaultWallet) return defaultWallet.address;
  return wallets[0]?.address ?? null;
}
