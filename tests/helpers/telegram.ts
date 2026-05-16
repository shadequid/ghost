/**
 * Shared test helpers for TelegramChannel construction. Lets non-slash-command
 * tests instantiate the channel without copy-pasting `{} as any` for the
 * slash-services bundle.
 */

import type { CommandServices } from "../../src/channels/telegram/index.js";
import type { ITradingClient } from "../../src/services/interfaces/trading-client.js";
import type { IWalletStore } from "../../src/services/interfaces/wallet-store.js";
import type {
  CommandNewsService,
  CommandAlertRulesService,
  CommandPriceCache,
} from "../../src/channels/telegram/commands/types.js";

/**
 * Returns a no-op slash-services bundle suitable for tests that don't exercise
 * the slash-command dispatcher. Each field is a typed empty object — calling
 * any service method on it will throw, which is the desired behavior for
 * tests that should never reach the slash path.
 */
export function makeNoopServices(): CommandServices {
  return {
    tradingClient: {} as ITradingClient,
    walletStore: {} as IWalletStore,
    newsService: {} as CommandNewsService,
    alertRules: {} as CommandAlertRulesService,
    priceCache: {} as CommandPriceCache,
  };
}
