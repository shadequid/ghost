/**
 * Confirmation function type.
 * In Ghost, the agent confirms with the user via chat before calling write tools.
 * This auto-confirms by default — the skill guidelines enforce confirmation at the AI level.
 */

export type ConfirmFn = (title: string, message: string) => Promise<boolean>;

/** Default: always confirm (AI handles confirmation via chat). */
export const autoConfirm: ConfirmFn = async () => true;

/**
 * Deferred confirm — starts as autoConfirm, can be replaced at runtime
 * once the gateway is ready. Allows tools created before the gateway
 * to use gateway-based approval.
 */
export function createDeferredConfirm(): { confirm: ConfirmFn; setConfirm: (fn: ConfirmFn) => void } {
  let inner: ConfirmFn = autoConfirm;
  return {
    confirm: (title, message) => inner(title, message),
    setConfirm: (fn) => { inner = fn; },
  };
}
