---
name: visual-qa
description: >-
  Repeatable visual QA pass for this repository — build, run, and drive the app
  with Playwright across the three target viewports in both LTR and RTL, then
  inspect what actually rendered. Use after any UI change, before opening a PR,
  or when asked to check how something looks, whether a layout is responsive, or
  whether the Persian/Arabic direction still works.

  Trigger on: "visual QA", "check the UI", "screenshot", "does this look right",
  "responsive", "test RTL", "check mobile", "viewport", "before the PR".
---

# Visual QA

A UI change is not finished when the markup compiles. It is finished when you
have seen it render correctly at every target size, in both directions.

## Targets for this repo

| Viewport | Size |
|---|---|
| Desktop | 1440 × 900 |
| Tablet | 1024 × 768 |
| Mobile | 390 × 844 |

Directions: **LTR** (`en`) and **RTL** (`fa` and `ar` — this app ships both).

Six combinations. The mobile × RTL cell is where defects hide, because it
combines wrapping with mirroring; never skip it.

## Running the app

```sh
npm run dev      # vite on :6001, API on :6000 with /api proxied
```

Open `http://localhost:6001`. Read-only pages render without a wallet or a
chain — browse, market, leaderboard, settings all work standalone, which is
enough for visual QA. Trading flows need a wallet and are out of scope here.

If the chain is not running the pages still render; do not report "no data" as a
visual defect.

## The pass

For each viewport, and within each viewport for each direction:

1. `browser_resize` to the target size.
2. `browser_navigate` to the page under test.
3. Set the direction without needing the UI:

   ```js
   () => {
     document.documentElement.lang = 'fa';
     document.documentElement.dir  = 'rtl';
   }
   ```

   via `browser_evaluate`. Use `en`/`ltr` for the LTR pass. Switching through the
   real language picker is also valid and exercises more of the app — prefer it
   when the picker itself is what changed.
4. `browser_take_screenshot`.
5. `browser_snapshot` for the accessibility tree.
6. Inspect both before moving on.

## What to look for

**Layout** — clipping at the inline-start edge (the signature of a hardcoded
`padding-left`), unexpected wrapping, horizontal scrollbars that appear only in
RTL, overlapping elements where an absolute `left:` was not converted, container
width blowouts.

**Direction** — arrows and chevrons pointing the wrong way, back/forward
reversed, addresses or hashes with `0x` on the wrong end, punctuation drifting to
the wrong side of a mixed-script sentence.

**Typography** — Persian and Arabic rendering in Vazirmatn rather than a fallback,
adequate line-height for diacritics, no tofu boxes, mixed Latin/Persian digits
inside one column.

**Components** — buttons, inputs, selects, cards, tables, dialogs, sheets, tabs,
tooltips at each width. Sheets and menus are the usual mobile casualties.

**States** — default, hover, focus (tab to it and look at the ring), active,
disabled, loading skeletons, empty states, error states.

**Motion** — transitions that animate `transform`/`opacity` rather than layout;
`prefers-reduced-motion` respected.

## Accessibility spot-check

From `browser_snapshot`, confirm every interactive node has a non-empty
accessible name and a correct role. Then tab through the primary flow and watch
the focus ring — focus that disappears or jumps is a real defect that no
screenshot will show.

## Reporting

Report per cell, and be explicit about what you did not check:

```
1440×900  LTR  ✅
1440×900  RTL  ✅
1024×768  LTR  ✅
1024×768  RTL  ⚠  filter rail overflows; `pl-6` on the container should be `ps-6`
 390×844  LTR  ✅
 390×844  RTL  ❌ sheet header clipped at inline-start
```

Never mark a cell green without having looked at its screenshot.
