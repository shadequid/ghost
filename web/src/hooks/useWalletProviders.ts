/**
 * EIP-6963 Multi Injected Provider Discovery.
 * Discovers all installed wallet extensions. Falls back to window.ethereum.
 */

import { useState, useEffect, useCallback } from "react";
import type { EIP1193Provider } from "viem";

export interface WalletProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface WalletProvider {
  info: WalletProviderInfo;
  provider: EIP1193Provider;
}

export function useWalletProviders() {
  const [providers, setProviders] = useState<WalletProvider[]>([]);

  useEffect(() => {
    const discovered = new Map<string, WalletProvider>();

    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.info?.uuid || !detail?.provider) return;
      discovered.set(detail.info.uuid, { info: detail.info, provider: detail.provider });
      setProviders([...discovered.values()]);
    };

    window.addEventListener("eip6963:announceProvider", handler);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () => window.removeEventListener("eip6963:announceProvider", handler);
  }, []);

  // Fallback to window.ethereum if no EIP-6963 providers
  const legacyProvider = typeof window !== "undefined"
    ? (window as unknown as Record<string, unknown>).ethereum as EIP1193Provider | undefined
    : undefined;

  const allProviders: WalletProvider[] = providers.length > 0
    ? providers
    : legacyProvider
      ? [{
          info: { uuid: "legacy", name: "Browser Wallet", icon: "", rdns: "legacy" },
          provider: legacyProvider,
        }]
      : [];

  const getProviderByRdns = useCallback((rdns: string): EIP1193Provider | null => {
    const match = providers.find((p) => p.info.rdns === rdns);
    if (match) return match.provider;
    if (legacyProvider) return legacyProvider;
    return null;
  }, [providers, legacyProvider]);

  return { providers: allProviders, getProviderByRdns };
}
