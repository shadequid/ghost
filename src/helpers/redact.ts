/**
 * Redaction helpers for secrets that may leak into error messages or logs.
 *
 * Bot tokens grant full impersonation; treat them as sensitive even in
 * developer logs. Underlying `fetch` errors typically embed the full URL
 * (including the token) in their message — strip the token (raw and
 * URL-encoded) before propagating the message to logs or wire.
 */

/** Replace every occurrence of `token` (raw and URL-encoded) with `[REDACTED]`.
 *  No-op when `token` is empty. */
export function redactToken(message: string, token: string): string {
  if (!token) return message;
  let out = message.split(token).join("[REDACTED]");
  const encoded = encodeURIComponent(token);
  if (encoded !== token) {
    out = out.split(encoded).join("[REDACTED]");
  }
  return out;
}
