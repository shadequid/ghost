import { useState, useEffect } from 'react';
import { hashHue } from './Avatar-utils';

interface AvatarProps {
  /** Image URL. Falls back to the initials disk if load fails. */
  url: string | null;
  /** Seed for the background hue hash — typically a username or source ID. */
  seed: string;
  /** Full display name; first character is used for the initials fallback. */
  label: string;
  /** Square side length in px. Defaults to 36. */
  size?: number;
}

/**
 * Round avatar used by TweetRow and NewsRow. If `url` is provided, shows
 * the image with a tinted initials disk as onError fallback. If `url` is
 * null, shows the initials disk directly.
 *
 * The onError path uses React state (not DOM sibling manipulation) so the
 * fallback actually renders — a previous implementation poked
 * `nextElementSibling.style.display` which resolved to the caller's label
 * column and left the user staring at a blank tinted circle whenever the
 * favicon was blocked by ad-block / CSP / network.
 */
export function Avatar({ url, seed, label, size = 36 }: AvatarProps) {
  const initial = (label.trim()[0] ?? '?').toUpperCase();
  const bg = `hsl(${hashHue(seed || label || '?')}, 45%, 35%)`;
  const fontSize = Math.round(size * 0.5);

  const [errored, setErrored] = useState(false);
  // Reset the error flag if the caller swaps `url` — otherwise a previously
  // broken URL would keep us on the initials branch forever.
  useEffect(() => { setErrored(false); }, [url]);

  const initialsDisk = (
    <div
      aria-hidden="true"
      className="rounded-full flex items-center justify-center text-white font-bold"
      style={{
        width: size, height: size,
        flex: `0 0 ${size}px`, background: bg,
        fontSize,
      }}
    >
      {initial}
    </div>
  );

  if (!url || errored) return initialsDisk;

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      className="rounded-full object-cover"
      style={{ width: size, height: size, flex: `0 0 ${size}px`, background: bg }}
      onError={() => setErrored(true)}
    />
  );
}
