import { randomBytes } from "node:crypto";

/** ASCII bytes for "ghost" (5 bytes = 10 hex chars), used as the Ghost cloid prefix. */
export const GHOST_CLOID_PREFIX = "0x67686f7374" as const;

/** Random suffix length so total = 32 hex chars after `0x` (HL constraint). */
const SUFFIX_HEX_LENGTH = 22;
const SUFFIX_BYTE_LENGTH = SUFFIX_HEX_LENGTH / 2;

/** Generate a fresh Ghost-prefixed cloid suitable for HL `order()` calls. */
export function generateGhostCloid(): string {
  const suffix = randomBytes(SUFFIX_BYTE_LENGTH).toString("hex");
  return `${GHOST_CLOID_PREFIX}${suffix}`;
}

/** Check whether a cloid was placed by Ghost. Case-insensitive on hex. */
export function isGhostCloid(cloid: string | undefined | null): boolean {
  if (typeof cloid !== "string" || cloid.length === 0) return false;
  return cloid.toLowerCase().startsWith(GHOST_CLOID_PREFIX);
}
