/**
 * Wallet store — SQLite-backed multi-wallet management.
 * Private keys stored encrypted via CredentialStore.
 */

import type { Database } from "bun:sqlite";
import type { CredentialStore } from "../../config/credentials.js";
import type { IWalletStore, WalletData, WalletInfo, WalletSource } from "../interfaces/wallet-store.js";

export type { WalletData, WalletInfo, IWalletStore, WalletSource };

interface WalletRow {
  address: string;
  testnet: number;
  is_default: number;
  source: string;
  status: string;
  api_wallet_address: string | null;
  added_at: number;
}

export class WalletStore implements IWalletStore {
  private readonly stmts;

  constructor(
    private readonly db: Database,
    private readonly credentials: CredentialStore,
  ) {
    this.stmts = {
      upsert: db.prepare(`INSERT INTO wallets (address, encrypted_key, testnet, is_default, source, status)
        VALUES (?, '', ?, ?, ?, ?) ON CONFLICT(address) DO UPDATE SET
        encrypted_key = excluded.encrypted_key, testnet = excluded.testnet,
        source = excluded.source, status = excluded.status`),
      getDefault: db.prepare(`SELECT address, testnet FROM wallets WHERE is_default = 1 AND status = 'trading' LIMIT 1`),
      clearDefault: db.prepare(`UPDATE wallets SET is_default = 0 WHERE is_default = 1`),
      setDefault: db.prepare(`UPDATE wallets SET is_default = 1 WHERE address = ? AND status = 'trading'`),
      list: db.prepare(`SELECT address, testnet, is_default, source, status, api_wallet_address, added_at FROM wallets ORDER BY added_at`),
      getByAddress: db.prepare(`SELECT address, testnet, is_default, source, status, api_wallet_address, added_at FROM wallets WHERE address = ?`),
      remove: db.prepare(`DELETE FROM wallets WHERE address = ?`),
      listBySource: db.prepare(`SELECT address FROM wallets WHERE source = ?`),
      enableTrading: db.prepare(`UPDATE wallets SET status = 'trading', api_wallet_address = ? WHERE address = ?`),
    };
  }

  /** Load the default trading wallet. Returns null if none connected. */
  async load(): Promise<WalletData | null> {
    const row = this.stmts.getDefault.get() as { address: string; testnet: number } | undefined;
    if (!row) return null;
    try {
      const privateKey = await this.credentials.get(`wallet/${row.address}`);
      if (!privateKey) return null;
      return { address: row.address, privateKey, testnet: row.testnet === 1 };
    } catch {
      return null;
    }
  }

  /** Save a wallet with trading enabled. Only sets as default if no other default exists. */
  async save(data: WalletData): Promise<void> {
    const addr = data.address.toLowerCase();
    const source = data.source ?? "chat";
    const hasDefault = this.listWallets().some((w) => w.isDefault && w.status === "trading");
    const setAsDefault = !hasDefault;
    this.db.transaction(() => {
      if (setAsDefault) this.stmts.clearDefault.run();
      this.stmts.upsert.run(addr, data.testnet ? 1 : 0, setAsDefault ? 1 : 0, source, "trading");
    })();
    await this.credentials.set(`wallet/${addr}`, data.privateKey);
  }

  /** Add a watch-only wallet (no private key needed). Returns true if new, false if already existed. */
  async addWatch(address: string, testnet: boolean, source: WalletSource): Promise<boolean> {
    const addr = address.toLowerCase();
    const existing = this.stmts.getByAddress.get(addr) as WalletRow | undefined;
    if (existing) return false;
    this.stmts.upsert.run(addr, testnet ? 1 : 0, 0, source, "watch");
    return true;
  }

  /** Enable trading on a watch-only wallet by storing API wallet credentials. */
  async enableTrading(address: string, apiWalletAddress: string, privateKey: string): Promise<void> {
    const addr = address.toLowerCase();
    const hasDefault = this.listWallets().some((w) => w.isDefault && w.status === "trading");
    this.db.transaction(() => {
      this.stmts.enableTrading.run(apiWalletAddress, addr);
      if (!hasDefault) {
        this.stmts.clearDefault.run();
        this.stmts.setDefault.run(addr);
      }
    })();
    await this.credentials.set(`wallet/${addr}`, privateKey);
  }

  /** List all wallets (without decrypted keys). */
  listWallets(): WalletInfo[] {
    const rows = this.stmts.list.all() as WalletRow[];
    return rows.map((r) => ({
      address: r.address,
      testnet: r.testnet === 1,
      isDefault: r.is_default === 1,
      source: r.source as WalletSource,
      status: r.status as "watch" | "trading",
      apiWalletAddress: r.api_wallet_address,
      addedAt: new Date(r.added_at * 1000).toISOString(),
    }));
  }

  /** Get a specific wallet by address. */
  getWallet(address: string): WalletInfo | null {
    const row = this.stmts.getByAddress.get(address.toLowerCase()) as WalletRow | undefined;
    if (!row) return null;
    return {
      address: row.address,
      testnet: row.testnet === 1,
      isDefault: row.is_default === 1,
      source: row.source as WalletSource,
      status: row.status as "watch" | "trading",
      apiWalletAddress: row.api_wallet_address,
      addedAt: new Date(row.added_at * 1000).toISOString(),
    };
  }

  /** Set a wallet as the default (must have trading status). */
  setDefault(address: string): void {
    const addr = address.toLowerCase();
    this.db.transaction(() => {
      this.stmts.clearDefault.run();
      this.stmts.setDefault.run(addr);
    })();
  }

  /** Remove a wallet and its credential. */
  async remove(address: string): Promise<boolean> {
    const addr = address.toLowerCase();
    await this.credentials.delete(`wallet/${addr}`);
    const result = this.stmts.remove.run(addr);
    if (result.changes > 0) {
      // If removed wallet was default, promote next trading wallet
      const wallets = this.listWallets();
      const hasDefault = wallets.some((w) => w.isDefault);
      if (!hasDefault) {
        const nextTrading = wallets.find((w) => w.status === "trading");
        if (nextTrading) this.setDefault(nextTrading.address);
      }
    }
    return result.changes > 0;
  }

  /** Remove all wallets from a specific source. Returns removed addresses. */
  async removeBySource(source: WalletSource): Promise<string[]> {
    const rows = this.stmts.listBySource.all(source) as Array<{ address: string }>;
    const removed: string[] = [];
    for (const row of rows) {
      const ok = await this.remove(row.address);
      if (ok) removed.push(row.address);
    }
    return removed;
  }
}
