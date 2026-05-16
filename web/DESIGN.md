# Ghost Web — Design System

> Conventions for the React dashboard in `web/`. Reference this when adding or
> reviewing UI. All tokens live in `web/src/index.css` under `@theme`.

**Styling is Tailwind-first.** Inline `style={{}}` is reserved for values
computed at runtime from React state (e.g. animation delays from timestamps,
per-row dynamic colors). Everything static goes in `className`.

---

## 1. Typography

**Rule:** never hard-code `fontSize` or `font-weight`. Use the named token
utilities below — each bundles size + weight + line-height + tracking from
the AgentGhost Figma type ramp (Figma node `17:2`, 22 styles).

**Family:** SF Pro Display (self-hosted, static `.otf` at weights 400 / 500 / 600 / 700 — see `src/assets/fonts/sf-pro-display/`).

**Line-height:** 150% across all 22 tokens (matches Figma style export).

**Default body:** `text-body-md` — 14 / Regular / 150%.

### Display — hero numbers, marquee titles

| Token | Size / Weight / Tracking | Use for |
| --- | --- | --- |
| `text-display-lg` | 48 / Bold (700) / -2% | hero portfolio value |
| `text-display-md` | 36 / SemiBold (600) / -1.5% | onboarding / launch titles |

### Heading — section titles

| Token | Size / Weight / Tracking | Use for |
| --- | --- | --- |
| `text-heading-lg` | 28 / Bold (700) / -1% | modal / page H1 ("Connect your wallet") |
| `text-heading-md` | 22 / SemiBold (600) / -0.5% | widget headers ("Open Positions") |
| `text-heading-sm` | 18 / Medium (500) | sub-section headers ("Position details") |

### Number — numeric values

| Token | Size / Weight | Use for |
| --- | --- | --- |
| `text-number-lg` | 32 / SemiBold (600) | secondary big numbers |
| `text-number-md` | 14 / Medium (500) | inline PnL, row values (`+$1,247.32`) |
| `text-number-sm` | 12 / Regular (400) | wallet addresses, tx hashes |

### Body — prose, row content

| Token | Size / Weight | Use for |
| --- | --- | --- |
| `text-body-lg` | 16 / Regular (400) | hero copy, empty-state lead |
| `text-body-lg-semibold` | 16 / SemiBold (600) | inline emphasis, prominent alerts |
| `text-body-md` | 14 / Regular (400) | **DEFAULT** body |
| `text-body-md-medium` | 14 / Medium (500) | emphasized body |
| `text-body-md-semibold` | 14 / SemiBold (600) | strong alerts ("FOMO detected") |
| `text-body-sm` | 13 / Regular (400) | meta timestamps, sync info |
| `text-body-sm-medium` | 13 / Medium (500) | emphasized meta |

### Label — UI labels, buttons, caps

| Token | Size / Weight / Tracking | Use for |
| --- | --- | --- |
| `text-label-lg` | 16 / Medium (500) | tab labels, large CTAs |
| `text-label-md` | 14 / Medium (500) | button labels ("Connect Wallet") |
| `text-label-sm` | 12 / Medium (500) / +2% | field labels ("Wallet address") |
| `text-label-caps` | 12 / Bold (700) / +8% UPPER | section caps ("POSITIONS") |

### Link

| Token | Size / Weight / Decoration | Use for |
| --- | --- | --- |
| `text-link-md` | 14 / Regular (400) / underline | inline links ("Manage wallets →") |

### Caption / Footnote — micro text

| Token | Size / Weight | Use for |
| --- | --- | --- |
| `text-caption` | 11 / Regular (400) | version stamps, micro meta |
| `text-footnote` | 10 / Regular (400) | confidentiality notes, legal |

### Usage

```tsx
// ✗ Don't — inline px, inline CSS token, or split size/weight
<div style={{ fontSize: 14, fontWeight: 510 }} />
<div className="text-[14px] font-medium" />

// ✓ Do — single token carries size + weight + line-height + tracking
<div className="text-body-md-medium" />
```

### Weight reference

| Name | Weight | Notes |
| --- | --- | --- |
| Regular | 400 | `font-normal` |
| Medium | 500 | `font-medium` — Figma axis 510 rounded |
| Semibold | 600 | `font-semibold` — Figma axis 590 rounded |
| Bold | 700 | `font-bold` |

Figma uses a variable-weight axis (510 / 590). The shipped fonts are static
`.otf` at 500 / 600, so the browser rounds to the nearest available weight.
Visual delta is sub-pixel. Prefer the named typography tokens above —
they encode the rounded weight directly.

### Legacy aliases — **DEPRECATED**

The pre-Figma scale (`text-micro`, `text-xs`, `text-sm`, `text-base`,
`text-lg`, `text-display`, `text-display-lg`) remains in `@theme` to keep
existing call sites compiling. New code MUST use the named tokens above.
When you next touch a file using a legacy utility, migrate per:

| Legacy | px | → New | Note |
| --- | --- | --- | --- |
| `text-micro` | 9 | `text-footnote` (10) | closest equivalent |
| `text-xs` | 10 | `text-footnote` (10) | exact |
| `text-sm` | 11 | `text-caption` (11) | exact — was the old default |
| `text-base` | 13 | `text-body-sm[-medium]` (13) | pick weight variant |
| `text-lg` | 15 | `text-label-lg` (16) or `text-heading-sm` (18) | size shifted up — choose by role |
| `text-display` | 20 | `text-heading-md` (22) | size shifted up |
| `text-display-lg` | 24 | `text-heading-lg` (28) | size shifted up |

The default body size grows from 11px to 14px under the new ramp — migrate
intentionally per surface, not via a global find/replace.

> **Wiring:** these tokens must be declared in `web/src/index.css` under
> `@theme` (as `--text-display-lg`, `--text-heading-md`, etc.) before the
> utilities resolve. Until wired, code using the new names will compile but
> produce no CSS. See §6 namespacing notes — keep custom tokens under
> `--text-*` so Tailwind v4 generates matching utilities automatically.

---

## 2. Motion

**Rule:** pick a duration from the scale. No bespoke `170ms`, `250ms`, etc.
Use Tailwind utilities — `@theme` exposes `--duration-*` and `--ease-*` so the
classes below read the tokens directly.

| Utility | Duration | Use for |
| --- | --- | --- |
| `duration-fast` | 120ms | hover/focus color transitions |
| `duration-base` | 180ms | buttons, reveals, popovers |
| `duration-slow` | 320ms | layout shifts, cross-fades |
| `duration-enter` | 480ms | first-mount enter animations |

| Utility | Value | Use for |
| --- | --- | --- |
| `ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | **default** — all enter/ambient motion |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | exit-only motion |
| `ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | symmetric back-and-forth |

```tsx
// ✗ Don't
<div style={{ transition: 'opacity 200ms ease-in-out' }} />
// ✓ Do
<div className="transition-opacity duration-base ease-out" />
```

### Reduced motion

Every animation you add MUST be disabled under `prefers-reduced-motion: reduce`.
Add your selector to the `@media (prefers-reduced-motion: reduce)` block at the
bottom of `index.css`. If your component uses an attribute like `data-blink` or
`data-pulse-dots`, the block already covers it.

---

## 3. Shared UI primitives

Reuse these before rolling a new one. They live under
`web/src/components/ui/` and export named.

### `<IconButton>` — circular icon button

Variants cover every icon-in-circle pattern in the app: chat send/stop, modal
close, primary CTA.

```tsx
import { IconButton } from '@/components/ui';

<IconButton variant="success" aria-label="Send" onClick={send}><SendIcon /></IconButton>
<IconButton variant="danger" aria-label="Stop" onClick={abort}><StopIcon /></IconButton>
<IconButton variant="ghost" aria-label="Close" onClick={close}><XIcon /></IconButton>
<IconButton variant="primary" size="sm-plus" aria-label="More" onClick={more}><DotsIcon /></IconButton>
```

Sizes: `sm` (24×24, borderline hit target — prefer `sm-plus` unless truly
inline), `sm-plus` (28×28, modal close), `md` (32×32, primary actions).
Every icon-only button MUST pass an `aria-label` — the component does not
fabricate one. Includes `btn-press` (scale on active), `hover:` color + bg
lift, `focus-visible:` parity. Forwards ref. No
`onMouseEnter`/`onMouseLeave` needed.

### `<Card>` — widget surface

Generic card with border + soft green glow. Sidebar widget bodies and
sub-panels reuse this instead of re-declaring the shadow/border triad.

```tsx
import { Card } from '@/components/ui';
<Card>{children}</Card>
<Card dashed>{children}</Card>  {/* edit-mode hint */}
```

> `<Card>`'s internal surface alias is **legacy** (`bg-muted`). New code
> that needs a card-shaped panel should compose the Figma surface tokens
> directly — see §4 Color tokens + §5 Modal & overlay surface format.

### `<EmptyState>` — "no data yet" row

Replaces the ad-hoc `<div>icon + muted label</div>` pattern used by every
sidebar widget. Wraps in `<Card>` by default.

```tsx
import { EmptyState } from '@/components/ui';
<EmptyState icon={<BellIcon />} text="No alerts set" />
```

### `<SectionLabel>` — mini uppercase header

The muted, tracked, semibold label for "Alerts (3)", "Watchlist", etc.

### Animation primitives

#### `<Popover>` — `web/src/components/Popover.tsx`

Fade + slight scale for dropdowns, menus, floating panels. Keeps the node
mounted during exit so content doesn't yank.

```tsx
<Popover open={menuOpen} origin="top-right" slideY={4} duration={160}>
  {…}
</Popover>
```

Accepts `ref` (forwardRef). Always render it — the component handles the
mount/unmount lifecycle. Don't gate it with `{open && <Popover …>}` or the
exit animation is lost.

#### `<AnimatedNumber>` — `web/src/components/AnimatedNumber.tsx`

Tweens a number over 320ms (easeOutCubic) when it changes. Use for values
that update frequently (prices, PnL, countdown).

```tsx
<AnimatedNumber value={equity} format={formatUsd} duration={320} />
```

Respects `prefers-reduced-motion` automatically. Formatter must be stable
across renders or the tween will restart every update.

#### `<LoadingScreen>` — `web/src/components/LoadingScreen.tsx`

Full-viewport loading state for auth/reconnect flows. Ring + dots + message.

```tsx
<LoadingScreen phase="connecting" detail="Pairing with the Ghost daemon…" />
```

---

## 4. Color tokens

Source of truth: the **AgentGhost Figma palette** wired in
`web/src/index.css` under `@theme`. Tailwind v4 auto-generates utilities
from every `--color-*` key. Brand is mint `#3bf7bf`.

### Surface — backgrounds, layered shallow → deep

| Utility | Value | Use for |
| --- | --- | --- |
| `bg-surface-canvas` | `#0A0A0B` | page/app shell, sidebar bg |
| `bg-surface-base` | `#111114` | modals, dialogs, primary cards |
| `bg-surface-raised` | `#17181b` | sub-panels inside modals, popovers |
| `bg-surface-overlay` | `#1f2024` | pills, count badges, chips |
| `bg-[var(--color-surface-scrim)]` | `rgba(0,0,0,0.7)` | modal scrim (use with `backdrop-blur-[4px]`) |

### Border

| Utility | Value | Use for |
| --- | --- | --- |
| `border-border-subtle` | `#1f2024` | hairline dividers inside a surface (rows, sub-cards) |
| `border-border-default` | `#2a2c31` | outer border on modals/cards |
| `border-border-strong` | `#3a3c42` | dashed separators, emphasis dividers |
| `border-border-focus` | `#3bf7bf` (brand) | active/focused input, selected pill |

### Text

| Utility | Value | Ratio @ 13px on `surface-base` | Use for |
| --- | --- | --- | --- |
| `text-text-primary` | `#f5f6f8` | ≈14:1 AAA | titles, primary body |
| `text-text-secondary` | `#b0b4bd` | ≈8:1 AAA | labels, meta, body inside cards |
| `text-text-tertiary` | `#6e7480` | ≈3.6:1 AA-large | placeholder, dim controls — **≥14px only** |
| `text-text-muted` | `#4a4f58` | ≈2:1 FAIL | decorative dividers/glyphs only |
| `text-text-on-brand` | `#0A0A0B` | n/a | text on brand-default bg |

### Brand (mint)

| Utility | Value | Use for |
| --- | --- | --- |
| `bg-[var(--color-brand-subtle)]` | `rgba(59,247,191,0.08)` | hover tint on tertiary items |
| `bg-[var(--color-brand-soft)]` | `rgba(59,247,191,0.16)` | pressed/active fill |
| `bg-brand-default` | `#3bf7bf` | primary CTA, "Enable Trading" |
| `bg-[var(--color-brand-hover)]` | `#5dfac9` | CTA hover |
| `bg-[var(--color-brand-pressed)]` | `#28d9a4` | CTA active |
| `text-brand-default` / `border-brand-default` | `#3bf7bf` | brand text, focused borders |

### Status / severity (info, success, warning, error)

Each family has 4 variants. Convention:

| Variant | Token | Use on |
| --- | --- | --- |
| `*-subtle` | `rgba(...,0.10)` | badge / pill BACKGROUND |
| `*-soft` | `rgba(...,0.20)` | hover/pressed surface |
| `*-default` | solid hex | status dot, icon stroke |
| `*-text` | lighter hex | text inside `*-subtle` badge |

Available families: `info` (#3b82f6 / #60a5fa), `success` (#22c55e /
#4ade80), `warning` (#f59e0b / #fb923c), `error` (#ef4444 / #f87171).

Example — "Limit BUY" badge from Orders container:
```tsx
<span className="bg-info-subtle text-info-text px-[9px] rounded-[2px] text-[12px]">Limit BUY</span>
```

### Legacy aliases — **DEPRECATED, do not use in new code**

These shadcn-era aliases are still present in `@theme` to keep 35 existing
files compiling. New components MUST use the Figma tokens above instead.
When you next touch one of these files, migrate:

| Legacy | → New | Note |
| --- | --- | --- |
| `bg-background` | `bg-surface-canvas` | |
| `bg-muted` | `bg-surface-base` (modal) or `bg-surface-raised` (sub-panel) | |
| `bg-card` | `bg-surface-base` | |
| `text-foreground` | `text-text-primary` | |
| `text-muted-foreground` | `text-text-secondary` | |
| `text-primary` (cyan #00d4ff) | `text-brand-default` (mint #3bf7bf) | brand hue changed |
| `text-destructive` | `text-error-text` | |
| `border-border` | `border-border-default` | |

If you spot a legacy alias in code you're editing, swap it as part of the
change set — don't leave half-migrated surfaces.

---

## 5. Modal & overlay surface format

The Telegram Connect modal (`web/src/components/TelegramSetupModal.tsx`,
commit a7b1fb3e) is the canonical reference. Any modal/dialog/drawer
without its own dedicated Figma frame MUST adopt this stack.

### Anatomy

```tsx
{/* 1. Scrim — portals to body, see §6 */}
<div className="fixed inset-0 z-[100] bg-[var(--color-surface-scrim)] backdrop-blur-[4px] flex items-center justify-center">

  {/* 2. Card — outer modal surface */}
  <div className="bg-[var(--color-surface-base)] border border-[var(--color-border-default)] rounded-[2px] shadow-[0_8px_32px_rgba(0,0,0,0.5)] w-[420px]">

    {/* 3. Header row — text-text-primary, 14px medium */}
    <header className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
      <h2 className="text-[14px] font-medium text-text-primary">Title</h2>
      <button aria-label="Close" className="…btn-press text-text-secondary hover:text-text-primary">✕</button>
    </header>

    {/* 4. Body */}
    <div className="p-4 space-y-3 text-text-secondary text-[13px]">

      {/* 5. Sub-section / row container — slightly recessed */}
      <div className="bg-[var(--color-surface-canvas)] border border-[var(--color-border-subtle)] rounded-[4px] p-3">…</div>

      {/* 6. Input — focused border lifts to brand */}
      <div className="flex items-center bg-surface-canvas border border-border-subtle rounded-[4px] h-9 px-4 focus-within:border-brand-default transition-colors duration-fast ease-out">
        <input className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted outline-none" />
      </div>

      {/* 7. Primary CTA — brand mint */}
      <button className="bg-brand-default hover:bg-[var(--color-brand-hover)] h-9 px-3 rounded-[4px] text-text-on-brand text-[13px] font-medium btn-press">Submit</button>
    </div>
  </div>
</div>
```

### Rules

1. **Outer card radius = `rounded-[2px]`** (Figma sharp corners). Buttons
   and sub-panels inside use `rounded-[4px]`. See §6 Spacing & Radius.
2. **Scrim is always portalled to `<body>`** (§7) — even if the modal
   currently has no transformed ancestor, the rule keeps drift in check.
3. **Body text defaults to `text-text-secondary`** at 13px. Titles and
   user-entered values use `text-text-primary`.
4. **Sub-sections recess one shade**: outer card on `surface-base`,
   inner rows on `surface-canvas` or `surface-raised`.
5. **Inputs have no global focus ring** (§9). The border lifting to
   `border-brand-default` via `focus-within:` is the focus signal.

### Migration targets

These modals still use the legacy `bg-muted` / `border-border` /
`rounded-lg` stack. Migrate on next touch:

| File | Status |
| --- | --- |
| `web/src/components/TelegramSetupModal.tsx` | ✓ canonical |
| `web/src/components/TerminalModal.tsx` | base modal — default `bg-muted` rounded-[12px], used by many; migrate cautiously |
| `web/src/components/chat/SettingsModal.tsx` | **target** — `bg-[#080c14]` `rounded-lg` legacy |
| `web/src/components/XAuthModal.tsx` | target — mix of new + legacy |
| `web/src/components/SkillUploadModal.tsx` | target |

---

## 6. Spacing & Radius

Source of truth: **AgentGhost Figma foundation** (file `NtCS871WnU04r2uQMrsO2k`,
node `30:15`) — 7 spacing tokens + 4 radius tokens. Use these for every new
component; everything outside the scale is a smell.

### Spacing — 7 tokens

The Figma scale aligns with Tailwind's default 0.25rem step. Use the standard
Tailwind utilities (`p-`, `m-`, `gap-`, `space-x-`, `space-y-`) — no arbitrary
values like `p-[10px]` or `gap-[14px]`.

| Token | px | Tailwind utility | Use for |
| --- | --- | --- | --- |
| `space/4` | 4 | `p-1`, `gap-1`, `m-1`, `space-y-1` | hairline gaps, icon+label inline pairs |
| `space/8` | 8 | `p-2`, `gap-2`, `m-2`, `space-y-2` | row internal padding, tight stacks |
| `space/12` | 12 | `p-3`, `gap-3`, `m-3`, `space-y-3` | card body padding, default stack rhythm |
| `space/16` | 16 | `p-4`, `gap-4`, `m-4`, `space-y-4` | modal body padding, section gaps |
| `space/24` | 24 | `p-6`, `gap-6`, `m-6`, `space-y-6` | hero padding, large gaps between sections |
| `space/32` | 32 | `p-8`, `gap-8`, `m-8`, `space-y-8` | full-page hero padding, top-level layout |
| `space/48` | 48 | `p-12`, `gap-12`, `m-12`, `space-y-12` | empty-state vertical breathing room |

```tsx
// ✗ Don't
<div className="p-[14px] gap-[10px]" />
<div style={{ padding: 14 }} />

// ✓ Do — round to the closest token
<div className="p-4 gap-2" />
```

If Figma confirms a value outside this scale (e.g. `gap-[14px]`), use
`gap-[14px]` and flag it for review — repeated novel values mean the scale
needs revisiting, not a one-off bypass.

### Radius — 4 tokens

Figma trims the project's old 6-step radius (1/2/3/4/5/20/full) down to
**4 tokens**. The 3/5/20 px values currently in code are **legacy** —
migrate per-touch.

| Token | px | Tailwind utility | Use for |
| --- | --- | --- | --- |
| `radius/1` | 1 | `rounded-[1px]` | hairline accents, hover indicators |
| `radius/2` | 2 | `rounded-[2px]` | modals, widget shells, primary cards, badges |
| `radius/4` | 4 | `rounded-[4px]` | buttons, inputs, sub-panels, list rows |
| `radius/full` | — | `rounded-full` | dots, avatars, pills, circular CTAs |

```tsx
// ✗ Don't — non-token values
<div className="rounded-[6px]" />  // not in Figma
<div className="rounded-[3px]" />  // legacy

// ✓ Do
<div className="rounded-[2px]" />        // modal/card
<button className="rounded-[4px]" />     // button
<div className="rounded-full size-2" />  // status dot
```

### Legacy radius values — **DEPRECATED**

These appear in the existing code but are NOT in the new Figma foundation.
Migrate per-touch (don't sweep globally):

| Legacy | → New | Note |
| --- | --- | --- |
| `rounded-[3px]` | `rounded-[2px]` (card) or `rounded-[4px]` (input/row) | role-dependent |
| `rounded-[5px]` | `rounded-[4px]` | buttons consolidate to 4px |
| `rounded-[20px]` | `rounded-[4px]` (small pill) or `rounded-full` (capsule) | depends on shape |
| `rounded-md` (6) | `rounded-[4px]` | shadcn alias |
| `rounded-lg` (8) | `rounded-[4px]` or `rounded-[2px]` | shadcn alias |

If you spot a legacy radius in code you're editing, swap it as part of the
change set.

---

## 7. Overlays — always portal to body

Any modal, dropdown, tooltip, or fullscreen overlay with `fixed` positioning
MUST use `createPortal(node, document.body)`.

**Why:** chat messages use a CSS animation with `transform: translateY(…)`.
That promotes each `.mb-row` to a compositor layer. Sibling branches with
promoted layers paint above any z-index applied to an ancestor of the modal,
so z-index alone cannot win the paint-order battle. Portaling moves the
overlay to a direct child of `<body>`, outside the chat subtree.

Components using this pattern correctly:

- `TerminalModal` — base modal
- `ChartWidget`'s `FullscreenOverlay`
- `WatchlistWidget`'s chart view + edit dropdown
- `Tooltip`, `IndicatorPopover`, `LevelPopover` (via Radix)

Dropdowns INSIDE widgets that don't escape the widget (e.g. the widget
settings menu inside the Sidebar `<aside>`) don't need portaling IF no
transformed ancestor blocks them. When in doubt: portal.

### Z-index scale

Hard-coded per overlay today. Rough convention:

| Range | Kind |
| --- | --- |
| 10 | intra-widget (legend, tool-call chip) |
| 50–100 | dropdowns, tooltips |
| 100 | base modals (`TerminalModal`) |
| 9999 | fullscreen overlays (chart) |
| 10002 | dropdowns that must beat fullscreen (watchlist edit) |

When adding a new overlay, place it near an existing peer in this table, not
at an ad-hoc number.

---

## 8. Button press feedback

Add `className="btn-press"` to any button where a subtle `scale(0.96)` on
`:active` reads well. The class handles a consistent `transform` transition
at `duration-fast` / `ease-out` and is disabled under reduced-motion.

`<IconButton>` already includes `btn-press`. For custom buttons, add it
explicitly.

Don't add `btn-press` to toggle buttons whose visual state already
communicates press (e.g. a pill that flips color on click).

---

## 9. Hover / focus states — no JS

**Rule:** never use `onMouseEnter` / `onMouseLeave` to toggle colors,
backgrounds, or borders. Use Tailwind variants:

```tsx
// ✗ Don't
<button
  onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
  onMouseLeave={(e) => (e.currentTarget.style.color = '#7f8f9e')}
/>

// ✓ Do
<button className="text-muted-foreground hover:text-white focus-visible:text-white transition-colors duration-fast ease-out" />
```

Keyboard users get `focus-visible:` automatically, which the imperative
version never covered. If the style has to animate a ref-measured distance,
see the utility classes in `index.css` (`.sidebar-icon-btn`,
`.settings-manage-btn`, `.widget-header`).

### Focus rings — global on, muted for inputs (product decision)

Buttons, links, anchors: keep the global `2px solid #4ea4ff` outline.
Keyboard users must be able to track focus across every interactive
surface.

Form inputs (`<input>`, `<textarea>`): owner wants them to read identically
focused vs idle — no outline, no border shift, no glow. The caret and
text cursor are the only focus indicator. Scope the opt-out locally:

```tsx
// XAuthModal INPUT_CLS — reference pattern (file still has rounded-[3px]
// at write; migrate to rounded-[4px] per §6 on next touch)
'w-full bg-[#0a0e18] border border-border rounded-[4px] px-2 py-1.5 ' +
'text-foreground text-xs font-mono outline-none ' +
'focus:outline-none focus-visible:outline-none'
```

This is a deliberate WCAG 2.4.7 tradeoff at the product level. If you're
adding a new input and suspect it should have a ring, flag to the owner
before rolling it in — don't deviate silently. Never generalise the
opt-out past form inputs.

---

## 10. Status dots

For a "live" green connection dot (Gateway connected, X.com connected, etc.)
use the `.status-dot-live` class in addition to inline `background` colour.
It adds a 2.4s breathing box-shadow. Omit the class when disconnected.

```tsx
<span
  className={connected ? 'status-dot-live' : undefined}
  style={{ background: connected ? '#00ff88' : '#3a4a5a' }}
/>
```

---

## 11. Widget value updates

For number updates driven by polling, wrap in `<AnimatedNumber>` so the
value tweens instead of snapping. For countdown progress (ring / bar) where
a React state tick is 1 Hz but the animation should run at frame rate:

1. Compute the `animation-delay` once with `useMemo` keyed on the cycle's
   start timestamp. Do NOT recompute on every tick — it restarts the CSS
   animation each render and looks choppy.
2. Let CSS drive the visual via `@keyframes` with `animation-iteration-count:
   infinite` (ring) or `forwards` (one-shot bar).
3. Keep React's tick purely for text display.

See `PortfolioRefreshBtn` and `ConfirmationCard` progress bar for reference
implementations.

---

## 12. Chat scroll during streaming

During LLM streaming, tokens arrive many times per second. Calling
`scrollIntoView({ behavior: 'smooth' })` on every token makes the browser
cancel each in-flight smooth scroll, producing stutter.

Pattern (see `useAgentChat.ts`):

1. Batch scroll requests via `requestAnimationFrame`.
2. Use `behavior: 'auto'` (instant) during streaming.
3. Reserve `behavior: 'smooth'` for the user-triggered "jump to bottom"
   button.

---

## 13. Locale + i18n

The `LocaleContext` default is `'en'` (see `App.tsx`). For new UI that
renders timestamps, month names, or formatted numbers, call
`.toLocaleString(locale, …)` with the locale from `useLocaleContext()` —
don't hardcode English arrays.

Known gap: `MessageBubble.tsx` still uses a hardcoded `MONTHS` array.
Migrate when next touched; acceptable for the English-only UI today.

---

## 14. Accessibility checklist (per component)

- Interactive icon button: `aria-label` (not just `title`).
- Status that changes asynchronously: `aria-live="polite"` on the wrapper.
- Modal: `role="dialog"` + `aria-label`; overlay: `aria-modal="true"`.
- Keyboard reachability: every mouse interaction should have a focus path.
- Hover styling: prefer Tailwind `hover:` + `focus-visible:` over JS
  `onMouseEnter/Leave` so keyboard users get parity (see §7).

---

## 15. Language policy

All code, comments, strings, and docs are **English-only**. The product
itself is global and the agent can respond in the user's language at
runtime, but the source tree stays English. Translated UI strings go
through `setLocale()` / `useLocaleContext()` — don't hardcode alternate
languages in inline strings or comments.

---

## 16. Linting & checks

The web workspace ships ESLint with `typescript-eslint`, `react-hooks`, and
`react-refresh` plugins:

```bash
bun run check       # tsc --noEmit
bun run lint        # eslint .
bun run lint:fix    # eslint . --fix
```

Run all three before opening a PR. The flat config lives in
`web/eslint.config.js`.

---

## 17. Writing conventions

- **No mixing** static styling in both `className` and `style` on the same
  element. Pick one per property.
- **Static → className; dynamic → style.** If a value comes from state or
  a computed source (animation-delay from a timestamp, opacity from focus),
  keep it in `style={{}}`. Otherwise it belongs in `className`.
- **Named exports** everywhere. The only exceptions today are page
  components (`web/src/pages/*`) and top-level layout shells
  (`Layout`, `Header`, `Sidebar`). New leaf components must use named exports.
- **Stable format functions** — `useMemo` if derived from props, module-
  level const otherwise. `<AnimatedNumber>` depends on this.
- **Commit messages** follow the project convention: `prefix(scope): short
  description`. Allowed prefixes: `feat, fix, refactor, chore, style, test,
  docs`.
