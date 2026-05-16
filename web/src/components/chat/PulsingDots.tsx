export function PulsingDots({ color = 'var(--color-brand-default)' }: { color?: string } = {}) {
  return (
    // data-pulse-dots is the hook for the reduced-motion CSS rule in
    // index.css — it freezes the animation while keeping the dots visible.
    <span data-pulse-dots className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1 h-1 rounded-full"
          style={{ background: color, animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite` }}
        />
      ))}
    </span>
  );
}
