/**
 * Paper wallet store — in-memory virtual wallet for paper trading mode.
 * Implements IWalletStore so the gateway and tools work without changes.
 */

import type { IWalletStore, WalletData, WalletInfo, WalletSource } from "../interfaces/wallet-store.js";

export class PaperWalletStore implements IWalletStore {
  private readonly createdAt: string;

  constructor(private readonly address = "paper-default") {
    this.createdAt = new Date().toISOString();
  }

  async load(): Promise<WalletData | null> {
    return { address: this.address, privateKey: "", testnet: false };
  }

  async save(_data: WalletData): Promise<void> {
    // No-op — paper mode doesn't persist wallets
  }

  async addWatch(_address: string, _testnet: boolean, _source: WalletSource): Promise<boolean> {
    return false;
  }

  async enableTrading(_address: string, _apiWalletAddress: string, _privateKey: string): Promise<void> {
    // No-op
  }

  listWallets(): WalletInfo[] {
    return [{
      address: this.address,
      testnet: false,
      isDefault: true,
      source: "chat",
      status: "trading",
      apiWalletAddress: null,
      addedAt: this.createdAt,
    }];
  }

  getWallet(address: string): WalletInfo | null {
    if (address === this.address) return this.listWallets()[0];
    return null;
  }

  setDefault(_address: string): void {
    // No-op
  }

  async remove(_address: string): Promise<boolean> {
    return false;
  }

  async removeBySource(_source: WalletSource): Promise<string[]> {
    return [];
  }
}
