import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'success' | 'danger' | 'ghost' | 'primary';
type Size = 'sm' | 'sm-plus' | 'md';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const BASE =
  'inline-flex items-center justify-center rounded-full flex-shrink-0 ' +
  'transition-colors duration-fast ease-out btn-press ' +
  'disabled:cursor-default disabled:opacity-30';

const VARIANTS: Record<Variant, string> = {
  success:
    'bg-[rgba(0,255,136,0.1)] text-[#00ff88] hover:bg-[rgba(0,255,136,0.2)] ' +
    'focus-visible:bg-[rgba(0,255,136,0.2)] cursor-pointer',
  danger:
    'bg-[rgba(255,71,87,0.1)] text-[#ff4757] hover:bg-[rgba(255,71,87,0.2)] ' +
    'focus-visible:bg-[rgba(255,71,87,0.2)] cursor-pointer',
  // Ghost: color shift + subtle bg lift. Color-only change was dismissed
  // by the a11y audit (color-blind users can miss #3a4a5a→#fff). Adding a
  // 6% white bg gives every user a visible affordance.
  ghost:
    'text-[var(--color-text-secondary)] hover:bg-white/[0.06] hover:text-[var(--color-text-primary)] ' +
    'focus-visible:bg-white/[0.06] focus-visible:text-[var(--color-text-primary)] cursor-pointer',
  primary:
    'bg-primary/15 text-primary hover:bg-primary/25 focus-visible:bg-primary/25 cursor-pointer',
};

const SIZES: Record<Size, string> = {
  sm: 'w-6 h-6',
  // Close buttons often want a 28px well that's slightly tighter than
  // md (32px). Keeps the close-X feeling like a chrome icon rather
  // than a peer of primary actions.
  'sm-plus': 'w-7 h-7',
  md: 'w-8 h-8',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { variant = 'ghost', size = 'md', className = '', children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim()}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
