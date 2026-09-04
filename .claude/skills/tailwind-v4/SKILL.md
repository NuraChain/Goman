---
name: tailwind-v4
description: >-
  Styling rules for this repository, which uses TailwindCSS 4 with no config
  file — the design tokens are CSS custom properties mapped through `@theme
  inline`. Covers where a class may be written, the scanner constraint that
  forces variant maps, the shared utilities (.shell, .rail, .nums), logical
  properties, and how to add a token without breaking a theme. Use whenever you
  write or change a `class=` attribute, a variant map, or anything in
  src/styles/.

  Trigger on: "styling", "class", "utility", "Tailwind", "CSS", "spacing",
  "colour", "color", "theme", "tokens.css", "variants.ts", "responsive class",
  "dark mode", "light mode".
---

# Tailwind 4 in this repository

Tailwind v4 via `@tailwindcss/vite`. **There is no `tailwind.config.js` and there
must not be one.** The theme is CSS: `src/styles.css` imports Tailwind, then
`styles/tokens.css` (the design system) and `styles/base.css` (fonts, document
ground, shared utilities).

`tokens.css` declares the raw custom properties on `:root` and
`:root[data-theme='light']`, then exposes them to Tailwind through `@theme
inline`. That mapping is what makes `bg-surface`, `text-muted`, `rounded-card`
and `animate-rise` exist as utilities.

For upstream v4 syntax questions (`@theme`, `@source`, `@utility`, `@custom-variant`,
v3→v4 differences) query Context7 at **`/websites/tailwindcss`** — the v3 docs in
your training data are actively wrong for this project.

## The scanner constraint — the rule that shapes everything

Tailwind generates CSS by scanning source text for **complete literal class
names**. A name assembled at runtime does not exist:

```ts
`bg-${ tone }-soft`        // never generated — dead style
`text-${ size > 2 ? 'lg' : 'sm' }`  // never generated
```

So every variant in this app is **one full literal string picked from a map**, and
those maps live in `src/components/ui/variants.ts`:

```ts
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
    primary: 'bg-brand text-on-brand hover:bg-brand-press',
    outline: 'border border-line-strong bg-transparent text-text hover:bg-overlay',
    …
};
```

Read `variants.ts` before styling a primitive. It already holds `buttonClass`,
`badgeClass`, `chipClass`, `tabClass`, `cardClass`, `iconButtonClass`,
`MENU_PANEL` and `MARKET_GRID`. A long utility string repeated across files
belongs there, not inline.

`base.css` still ends with an `@source inline(...)` list of state-flag classes.
It existed for the old framework's `class:` directives, which no longer exist, so
nothing references those names today - leave it or delete it, but do not add to
it. A class name React composes at runtime has the same problem the directives
did, and the fix is the same: a full literal string from a map.

## Logical properties only

This app ships ten languages, two of them RTL. Physical horizontal utilities are
defects:

| Never | Always |
|---|---|
| `ml-` `mr-` | `ms-` `me-` |
| `pl-` `pr-` | `ps-` `pe-` |
| `left-` `right-` | `start-` `end-` |
| `text-left` `text-right` | `text-start` `text-end` |

The exceptions are genuinely physical: chart/time axes, media timelines, and
Latin or numeric runs (addresses, hashes, tx ids, tickers) — wrap those in
`dir="ltr"` rather than reaching for a physical margin. Vertical utilities
(`mt-`, `pb-`, `top-`) are unaffected.

## Shared utilities in base.css — use these, do not re-roll them

| Class | What it is |
|---|---|
| `.shell` | **THE** content container: `max-width: 80rem`, `padding-inline: 1rem`, centred. Header, sections, rails and the footer all align to it. Never hand-roll `max-w-* px-*` for page chrome. |
| `.rail` / `.rail-bleed` / `.rail-fade` | horizontal carousels: momentum scroll, hidden scrollbar, snap; bleed to the screen edge on mobile and collapse from `lg` |
| `.nums` | tabular figures — put it on **every number that can change** so tickers do not wiggle |
| `.latin-nums` | forces Latin tabular digits (charts opt out of Persian numerals this way) |
| `.skeleton` | the shimmering loading wash |
| `.hover-tint` | soft-fill hover that brightens on dark and *darkens* on light |
| `.icon-mirror` | flips with `[dir='rtl']` — applied automatically by `<Icon>` for icons in the `MIRRORED` set |

## Tokens: what you may write, and what you may not

Consume tokens. Never invent a hex value, a raw pixel radius, or an ad-hoc
duration in a component.

```
bg-surface bg-raised bg-overlay          border-line border-line-strong
text-text text-muted text-faint          bg-brand text-on-brand bg-brand-soft
bg-yes-soft text-yes  bg-no-soft text-no bg-gold text-on-gold bg-gold-soft
rounded-control rounded-card rounded-sheet
motion-safe:animate-rise | -fade | -pop | -sheet-up | -shimmer | -flash-up | -flash-down
z-[var(--z-header)]  (and --z-buybar --z-menu --z-sheet --z-toast --z-tooltip)
```

Motion and z-index have no Tailwind alias — reference the variable directly:
`duration-[var(--motion-base)]`, `z-[var(--z-menu)]`.

### Adding a token

1. Add it to `:root` in `tokens.css` **and** to `:root[data-theme='light']`. A
   token defined in only one scale is a broken theme, not a shortcut.
2. Add the `--color-*` / `--radius-*` line to the `@theme inline` block so a
   utility exists.
3. Look at both themes before calling it done — see the `design-system` skill for
   why light is not a derived tint.

## Arbitrary values

Allowed where the design genuinely has no scale step — the type sizes the
primitives use (`text-[13px]`, `text-[15px]`) and variable references
(`z-[var(--z-menu)]`, `max-w-[calc(100vw-1rem)]`) are deliberate. A one-off
`w-[137px]` where a scale value would do is a finding, and so is an arbitrary
colour when a token exists.

## Motion

Animate `transform` and `opacity`, never `width`/`height`/`top`/`left`. Prefix
entrance animations with `motion-safe:` — `base.css` also neutralises animation
globally under `prefers-reduced-motion`, but the prefix keeps intent local and
visible.

## Before you finish

Both themes fail independently, and so do both directions. A class change is
checked at `data-theme="dark"` and `data-theme="light"`, in `ltr` and `rtl` —
see the `ui-patterns` skill for the verification loop.
