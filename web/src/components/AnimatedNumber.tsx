import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';

interface AnimatedNumberProps {
  value: number;
  format: (v: number) => string;
  duration?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Tween a numeric value over `duration` ms when it changes. Uses
 * requestAnimationFrame with an easeOutCubic curve — feels snappy without
 * being distracting during frequent refreshes (portfolio PnL, watchlist
 * prices).
 *
 * If `prefers-reduced-motion: reduce` is on, snap to the new value.
 */
export const AnimatedNumber = memo(function AnimatedNumber({
  value,
  format,
  duration = 320,
  className,
  style,
}: AnimatedNumberProps) {
  const [displayed, setDisplayed] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === displayed) return;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setDisplayed(value);
      return;
    }

    fromRef.current = displayed;
    startRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // easeOutCubic — overshoots deceleration for a natural settle
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplayed(t >= 1 ? value : next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // We intentionally omit `displayed` from deps: we want the tween to
    // restart only when the target `value` changes, using the current
    // `displayed` as the starting point (captured via fromRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return (
    <span className={`tabular-nums${className ? ` ${className}` : ''}`} style={style}>
      {format(displayed)}
    </span>
  );
});
