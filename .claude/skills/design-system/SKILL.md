---
name: design-system
description: >-
  The Ledger design language this product is built in — surfaces and elevation,
  the emerald/gold identity, the semantic YES/NO scale, the type ramp, radius,
  motion, the z-index ladder, and the dark/light parity rule. Also the primitive
  inventory and the reuse ladder. Use when designing or restyling a screen or
  component, choosing a colour or spacing, judging whether something looks native
  to the product, or deciding whether a new component is justified.

  Trigger on: "design", "look", "visual", "make it nicer", "redesign", "style
  guide", "brand", "palette", "elevation", "shadow", "typography", "new
  component", "does this fit".
---

# Ledger — the design system

Defined in `application/src/styles/tokens.css`. That file is the source of truth
for colour, radius, motion, easing, z-index and fonts. Read it before designing
anything; components consume tokens and never invent values.

## The one rule that catches most mistakes

**Dark is the base scale and the product's identity. Light is a complete parallel
scale, not a derived tint.** They flip on `data-theme` on `<html>` and they fail
independently. Every visual decision has to be made twice and looked at twice.

Concrete traps this has already caused:

- In dark, the elevation step goes **up** from the ground (`--surface` →
  `--raised` → `--overlay`). In light it goes **down** from white: `--raised` is
  `#FFFFFF` and `--overlay` is the tint that makes hover fills, active pills and
  the skeleton shimmer visible. Collapse those two in light and all of it
  disappears.
- `--chrome` (the translucent sticky header and buy bar) is per-theme and *more
  opaque* in light. A gray-green 85% surface over white content lets scrolled
  text ghost through the blur as a dirty smear.
- `.hover-tint` brightens on dark and darkens on light. A raw `brightness(1.25)`
  washes pastels toward white on a light surface.

## Surfaces and elevation

```
--surface       the ground (ink green-black / near-white)
--raised        cards, rows, inputs
--overlay       menus, sheets, hover fills, active pills
--line          hairline borders
--line-strong   emphasised borders, scrollbar thumbs
```

**Elevation is a hairline border plus a tint step, not a heavy shadow.** Reach for
`shadow-2xl` only on genuinely floating chrome (menu panels, `overlay` cards); a
drop shadow on an in-flow card reads as foreign here.

## Identity and semantics

- `--brand` emerald **acts** — primary buttons, active states, the focus ring,
  chart series 1.
- `--gold` **distinguishes** — featured, awards, treasury, chart series 2. It is
  the accent, not a second primary.
- `--yes` / `--no` are the market semantics (emerald / rose) with `-soft` fills
  for backgrounds. **Colour never carries meaning alone**: YES/NO and status
  always travel with an icon or a label.
- `--warn` is gold; there is no separate info colour.
- `--on-brand` / `--on-gold` are the only legal foregrounds on those fills.

## Type

- Latin: **Inter Variable**, self-hosted. Persian/Arabic: **Vazirmatn Tuned**, a
  metric-overridden face (`ascent 97% / descent 30%`) — the stock Vazirmatn box
  parks the baseline ~0.12em high and floats Persian text above icon centres in
  every icon+text row. Do not swap it for the stock face.
- Ramp: `text-text` for content, `text-muted` for secondary, `text-faint` for
  tertiary/placeholder. Three steps is the whole vocabulary.
- Sizes the primitives use: `text-[13px]` (sm controls), `text-[14px]` (rows,
  tabs), `text-[15px]` (md controls), `text-base`, and
  `text-2xl font-bold tracking-tight` for page titles. Follow the neighbours
  rather than inventing a step.
- Every changeable number gets `.nums` (tabular figures). Charts get
  `.latin-nums`.

## Shape

`--radius-control: 10px` (buttons, inputs, icon buttons) ·
`--radius-card: 14px` (cards, panels, menus) ·
`--radius-sheet: 20px` (bottom sheets). Pills use `rounded-full`. There is no
fourth radius.

## Motion

`--motion-fast 120ms`, `--motion-base 200ms`, `--motion-slow 320ms`, all on
`--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`.

| Animation | For |
|---|---|
| `rise` | content entering the page (8px up + fade) |
| `fade` | secondary content, backdrops |
| `pop` | menus and dropdowns (scale 0.96) |
| `sheet-up` | bottom sheets — enters from its own full height, not the generic 8px |
| `shimmer` | skeletons |
| `flash-up` / `flash-down` | price changes in the Ticker, a wash that decays |

Entrances carry `motion-safe:`. Animate `transform`/`opacity` only.

## The layer ladder

```
--z-buybar 30 · --z-header 40 · --z-menu 50 · --z-sheet 50 · --z-toast 60 · --z-tooltip 70
```

These order **body-level** layers against each other. A raw z-index only orders
siblings inside its own stacking context, so a layer that must beat the page has
to escape to the body first — that is why Tooltip portals. Bumping a number does
not rescue a nested element.

Chrome geometry has one variable too: `--tabbar-h: 3.5rem`. The sticky trade bar
and the footer clearance both read it, so they cannot drift.

## The primitive library

`src/components/ui/` already covers: Button, Card, Chip, Badge, Input, Select,
Tabs, Sheet, Skeleton, SkeletonList, Toggle, Tooltip, Pagination, EmptyState,
StatTile, MenuPanel, MenuItem, Rail, PillGroup, Ticker, Chart, ChanceRing,
SettingRow, Toasts.

Domain layers sit above it in `components/market/`, `components/layout/` and
`components/admin/`.

```
existing component → reuse → extend if needed → create only if justified
```

A near-duplicate is a review finding. Before adding a component, be able to say
which existing one failed to cover the case and why extending it was worse. New
shared UI goes in `components/ui/`, consumes tokens, and puts its class strings
in `variants.ts`.

Icons come from `src/icons/registry.ts` by kebab name via `<Icon name="…" />` (src/icons/icon.tsx).
Never import lucide directly — the registry is what keeps the bundle to the icons
actually in use, and it also carries the `MIRRORED` set that flips directional
icons under RTL.

## Designing a new screen so it looks native

1. Wrap the page in `.shell` and open with
   `<h1 class="mb-5 text-2xl font-bold tracking-tight motion-safe:animate-rise">`.
2. Build from primitives; reach for `cardClass(...)` and `MARKET_GRID` rather
   than fresh layout.
3. Give every async region a designed loading state (skeletons in the final
   layout's shape, not a spinner) and a designed empty state (`EmptyState` with
   icon, title, hint and a recovery action).
4. Keep the density mobile-first: `p-3 sm:p-3.5` tiles, `gap-3 sm:gap-4` grids.
5. Look at it in dark and light before you call it finished.
