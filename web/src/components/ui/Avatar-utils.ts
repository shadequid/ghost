/**
 * Deterministic 0–360 hue derived from a string — lets each distinct
 * seed paint its own background tone without a palette lookup. Shared
 * between `<Avatar>` and a few places that need the source color
 * (e.g. tweet-utils) without pulling in the component.
 */
export function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
