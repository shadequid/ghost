/**
 * Shared SSRF validation utility — reused by web-fetch tool and news service.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Return true when an IP address (v4 or v6) resolves to a private, loopback,
 * link-local, or otherwise non-routable range.
 *
 * Handles:
 *  - Plain IPv4 (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, …)
 *  - Plain IPv6 (::1, fe80::/10, fc00::/7, …)
 *  - IPv4-mapped IPv6 (::ffff:127.0.0.1 — the mapped part is extracted and re-checked)
 *  - Carrier-grade NAT (100.64.0.0/10)
 *  - AWS metadata relay via link-local (169.254.169.254)
 */
export function isPrivateIp(ip: string): boolean {
  // Strip brackets used in URL literals: [::1] → ::1
  const stripped = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;

  // IPv4-mapped IPv6: ::ffff:a.b.c.d  or  ::ffff:hex (e.g. ::ffff:7f00:1)
  const mappedV4 = extractMappedV4(stripped);
  if (mappedV4 !== null) {
    return isPrivateIpv4(mappedV4);
  }

  const family = isIP(stripped);
  if (family === 4) return isPrivateIpv4(stripped);
  if (family === 6) return isPrivateIpv6(stripped);

  // Not a valid IP — let the caller's DNS resolution handle it
  return false;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * If `addr` is an IPv4-mapped IPv6 address (::ffff:a.b.c.d or ::ffff:HHHH:HHHH),
 * return the dotted-decimal IPv4 string; otherwise return null.
 */
function extractMappedV4(addr: string): string | null {
  // Dotted form: ::ffff:127.0.0.1
  const dottedMatch = addr.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (dottedMatch) return dottedMatch[1];

  // Hex form: ::ffff:7f00:0001  (two 16-bit groups encoding the IPv4 octets)
  const hexMatch = addr.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMatch) {
    const hi = parseInt(hexMatch[1], 16);
    const lo = parseInt(hexMatch[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    return `${a}.${b}.${c}.${d}`;
  }

  return null;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts as [number, number, number, number];

  // Loopback: 127.0.0.0/8
  if (a === 127) return true;
  // Unspecified / "this" network: 0.x.x.x
  if (a === 0) return true;
  // Link-local + AWS metadata: 169.254.0.0/16 (covers 169.254.169.254)
  if (a === 169 && b === 254) return true;
  // Class A private: 10.0.0.0/8
  if (a === 10) return true;
  // Class B private: 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // Class C private: 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // Carrier-grade NAT: 100.64.0.0/10
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Broadcast
  if (a === 255) return true;

  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // Loopback: ::1
  if (lower === "::1") return true;
  // Link-local: fe80::/10
  if (lower.startsWith("fe80:") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // Unique-local: fc00::/7 (covers fd00::/8 too)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // Multicast: ff00::/8
  if (lower.startsWith("ff")) return true;
  // Unspecified: ::
  if (lower === "::") return true;

  return false;
}

/** Validate a URL is safe to fetch (no SSRF to private/internal addresses). */
export async function validateUrlSafety(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme: ${parsed.protocol}. Only http:// and https:// allowed.`);
  }

  const hostname = parsed.hostname;

  // Reject bracket-wrapped IPv6 literals (strip brackets for the check)
  const hostForCheck = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  if (hostForCheck === "localhost") {
    throw new Error("Blocked: internal/private address");
  }

  if (isPrivateIp(hostForCheck)) {
    throw new Error(`Blocked: ${hostname} is a private address`);
  }

  // DNS resolution check — resolve both A (IPv4) and AAAA (IPv6) records.
  // Using dns.lookup with family=0 returns the OS-preferred address (one
  // result). We call both families explicitly to validate all addresses a
  // hostname might resolve to, preventing AAAA-only bypass.
  const isIpLiteral = isIP(hostForCheck) !== 0;
  if (!isIpLiteral) {
    const resolved = await resolveAllAddresses(hostname);
    for (const addr of resolved) {
      if (isPrivateIp(addr)) {
        throw new Error(`Blocked: ${hostname} resolves to private address ${addr}`);
      }
    }
  }
}

/**
 * Resolve both A and AAAA records for a hostname, returning all addresses.
 * Silently ignores DNS families that have no records (ENODATA / ENOTFOUND).
 * Other errors (network failure, timeout) are also swallowed — we let the
 * subsequent fetch fail naturally rather than blocking on DNS uncertainty.
 */
async function resolveAllAddresses(hostname: string): Promise<string[]> {
  const results: string[] = [];

  await Promise.allSettled([
    // IPv4
    lookup(hostname, { family: 4, all: true }).then((addrs) => {
      for (const a of addrs) results.push(a.address);
    }),
    // IPv6
    lookup(hostname, { family: 6, all: true }).then((addrs) => {
      for (const a of addrs) results.push(a.address);
    }),
  ]);

  return results;
}
