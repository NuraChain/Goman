---
name: ui-patterns
description: >-
  The correctness rules for UI in this app — RTL/LTR direction, i18n and number
  formatting, accessibility, component states, responsive behaviour at the three
  target viewports, and the Playwright pass that verifies all of it. Use when
  building or changing any screen, when adding user-facing copy or a number, and
  before calling a UI change done.

  Trigger on: "RTL", "Persian", "Arabic", "direction", "translate", "i18n",
  "accessibility", "a11y", "focus", "keyboard", "screen reader", "responsive",
  "mobile", "viewport", "loading state", "empty state", "check the UI",
  "screenshot", "does this look right".
---

# UI correctness in this app

Markup that compiles is not a finished UI change. This app ships ten languages,
two directions, two themes and three viewports, and each of those axes fails
independently.

## Direction — RTL/LTR

Direction is read from the registry row in `src/i18n/langs.ts` and stamped on
`<html>` by `src/stores/locale.store.ts`. **Nowhere else writes `lang` or `dir`.**

- **Logical properties only.** `ms-` `me-` `ps-` `pe-` `start-` `end-`
  `text-start` `text-end`. Any `ml-` `mr-` `pl-` `pr-` `left-` `right-`
  `text-left` `text-right` is a defect unless the element is deliberately
  physical.
- Deliberately physical: charts with a time axis, media timelines, and Latin or
  numeric runs. Wrap addresses, hashes, tx ids and tickers in `dir="ltr"`.
- **Never write a new `lang === 'fa'` conditional for direction.** Ask the
  registry — Arabic is RTL too, and that conditional breaks the moment it is
  used.
- Only genuinely directional icons mirror. The `MIRRORED` set in
  `src/icons/registry.ts` is the explicit list; `<Icon>` applies `.icon-mirror`
  from it, and `base.css` flips it under `[dir='rtl']`.
- The flip is instant by design — `dir-flipping` suppresses transitions for one
  frame, because an animated mirror reads as breakage.

## i18n

- **All copy goes through `t('section.key')`.** An inline user-facing string is a
  review comment.
- A key added to `src/i18n/en.ts` needs a twin in **every** sibling dictionary
  (fa, ar, es, pt, hi, zh, ru, fr, tr). `Record<Lang, Dictionary>` in the locale
  store makes a missing one a compile error — let it.
- Adding a language is two edits: a row in `langs.ts` and a dictionary bound to
  its code in `locale.store.ts`. Nothing else enumerates languages.
- **All numbers and dates go through `src/i18n/format.ts`.** Never call `Intl` or
  `toLocaleString` in a component — that is exactly how Latin digits leak into
  the Persian UI. Persian gets Persian-Indic digits, Persian scale words and the
  Jalali calendar; every other language gets its own `Intl` locale with numerals
  pinned to Latin via `-u-nu-latn`.
- Market titles, rules and outcome labels ride **on chain** as `{ en, fa }`. Read
  them with `text(...)` from the locale store; other locales fall back to English.

## Accessibility

- Prefer native semantics over ARIA. An interactive `<div>` or `<span>` where a
  `<button>` or `<a href>` belongs is a defect; speculative ARIA on an element
  whose native role already says it is also a defect.
- Icon-only controls need an accessible name — `Button` carries a `label` prop
  for exactly this case.
- **Never colour alone.** YES/NO and status carry an icon or a label.
- WCAG AA contrast in **both** themes.
- Visible focus through `:focus-visible` (already global in `base.css`). Never a
  bare `outline: none`.
- Sheets and dialogs carry `role="dialog"` plus `aria-modal` and an accessible
  name, and they manage and restore focus. `useDismiss` in
  `src/hooks/use-dismiss.ts` is the shared outside-press / Escape /
  focus-restore contract — use it rather than re-implementing dismissal.
- In-flight work says so: `Button`'s `loading` prop swaps the icon for a spinner,
  makes the control inert and sets `aria-busy`. On-chain actions must use it — a
  wallet prompt can sit behind the browser window for thirty seconds while the
  page looks merely broken.

## States

Every async region needs all of these designed, not just the happy path:

- **Loading** — skeletons in the shape of the final layout (`Skeleton`,
  `SkeletonList`), not a bare spinner. Distinguish first load from refetch:
  `markets.loading() && markets.data() === undefined`.
- **Empty** — `EmptyState` with icon, title, hint, and a recovery action (a
  "clear filters" button, not a dead end).
- **Error** — the router-level `ErrorBoundary` in `app.tsx` catches
  a throwing page; per-region failures still need their own message.
- **Disabled / busy** — inert *and* visibly inert.

## Responsive

Targets: **1440×900**, **1024×768**, **390×844**.

Mobile gets a bottom tab bar, drag-handled sheets, a sticky trade bar and 44px
touch targets. Desktop gets hover affordances, density and keyboard paths. **One
component, two presentations — not a scaled-down desktop.** The filter control in
`browse.page.tsx` is the reference: an inline row from `sm`, a `Sheet` below
it.

The scroll region is the inner div in `app.tsx`, not the window, so
the scrollbar stops where the tab bar starts. Anything that offsets against the
tab bar reads `--tabbar-h`.

## Verifying — the six-cell pass

Three viewports × two directions. Never mark a cell green without having looked
at its screenshot; **mobile × RTL is where defects hide.**

```sh
npm run dev      # vite :6001, API :6000
```

Read-only pages render without a wallet or a chain — browse, market, leaderboard
and settings are enough for a visual pass. If the chain is not running, "no data"
is not a visual defect.

Per cell: `browser_resize` → `browser_navigate` → set the direction →
`browser_take_screenshot` → `browser_snapshot` → **look at both**.

```js
() => {
  document.documentElement.lang = 'fa';
  document.documentElement.dir  = 'rtl';
}
```

via `browser_evaluate` (use `en`/`ltr` for the LTR pass). Prefer the real
language picker when the picker itself is what changed.

What to look for: clipping at the inline-start edge (the signature of a hardcoded
`padding-left`), horizontal scrollbars that appear only in RTL, chevrons pointing
the wrong way, `0x` on the wrong end of an address, mixed Latin and Persian digits
in one column, tofu boxes, sheets and menus overflowing on mobile, and focus that
disappears or jumps when you tab through.

Report per cell, and say plainly what you could not check:

```
1440×900  LTR  OK
1440×900  RTL  OK
1024×768  LTR  OK
1024×768  RTL  WARN  filter rail overflows; `pl-6` should be `ps-6`
 390×844  LTR  OK
 390×844  RTL  FAIL  sheet header clipped at inline-start
```
