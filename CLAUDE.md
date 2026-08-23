# AuctionHouse — working notes for Claude

An on-chain prediction market. This file records what the repository actually is
and the rules that are not visible from any single file. Everything here was read
out of the codebase; if a statement here and the code disagree, the code wins —
fix this file.

## Stack

| Layer | What |
|---|---|
| Framework | **AzerothJS 2.0.0-beta.2** — `.azeroth` components, not React |
| Build | Vite 8, `@azerothjs/compiler`, `@tailwindcss/vite` |
| Styling | TailwindCSS 4 — **no `tailwind.config.js`**; tokens are CSS custom properties |
| Language | TypeScript 6 (`strict`, `noUnusedLocals`, `noUnusedParameters`) |
| Tests | Vitest 4 + happy-dom + `@azerothjs/testing` |
| Server | `@azerothjs/http`, Node ≥ 24 running TypeScript directly, `node:sqlite` index |
| Chain | viem; ABIs in `application/src/lib/abis/` |
| CI | GitHub Actions — `azeroth check`, `azeroth build`, `azeroth test` |

The Solidity lives in its **own repository** (`auctionhouse-contracts`). What
crosses the boundary is the exported ABI JSON. Do not add contracts here.

## Commands

```sh
npm run dev      # vite :6001 + API :6000, /api proxied
npm run check    # azeroth-tsc + eslint, both workspaces
npm test         # vitest, both workspaces
npm run build    # client bundle + SSR bundle + prerender
npm start        # run the built app (NODE_ENV=production)
```

`npm run check` currently fails on this Windows checkout for a reason unrelated
to any change: `core.autocrlf=true` checks files out as CRLF while eslint enforces
LF, so untouched files report thousands of `linebreak-style` errors. Use
`npm run build` and `npm test` as the real gates until a `.gitattributes` lands.

Two tests in `application/tests/session.spec.ts` fail under the full parallel run
(EIP-6963 discovery timeouts) and pass in isolation. This predates current work —
verify against a clean checkout before treating it as a regression.

## Architecture

```
application/            web client
  src/styles/           tokens.css (THE design system), base.css
  src/i18n/             langs.ts (THE language registry), one dictionary per
                        language, format.ts (THE number module)
  src/icons/            Icon component + lucide registry + RTL mirror list
  src/components/ui/    the primitive library — check here before building
  src/components/       layout/  market/  admin/
  src/pages/            one .page.azeroth per route
  src/stores/           createStore singletons (locale, theme, session, …)
  src/routes.ts         ONE route table; per-route render mode
server/                 @azerothjs/http — the declared API
  src/schemas.ts        the wire vocabulary (client-safe)
  src/app.ts            feature() declarations
  src/derive.ts         read models
  src/chain/            indexer + sqlite store
```

The browser's API client is **inferred from the server's route declarations**, so
a handler and its caller cannot drift. Do not hand-write client types.

## Design system

`application/src/styles/tokens.css` is the source of truth for colour, radius,
motion, easing, z-index and fonts. Components consume tokens; they never invent
values. There is no Tailwind config file — Tailwind 4 reads the tokens from CSS.

Shared class strings live in `src/components/ui/variants.ts`, not inline and not
duplicated.

Two full parallel colour scales flip on one `data-theme` attribute. Light is a
first-class theme, not a derived tint — check both.

### Component rules

The primitive library already covers: Button, Card, Chip, Badge, Input, Select,
Tabs, Sheet, Skeleton, SkeletonList, Toggle, Tooltip, Pagination, EmptyState,
StatTile, MenuPanel, MenuItem, Rail, PillGroup, Ticker, Chart, ChanceRing,
SettingRow, Toasts.

```
Existing component → reuse → extend if needed → create only if justified
```

Creating a near-duplicate is a review finding. Shared UI goes in
`components/ui/` and consumes tokens.

### AzerothJS idioms

- `export default component Name(props: {...}) { ... }`, markup last
- `state x = …`, `derived y = …`, `resource r = …`
- `<Show when={…} fallback={…}>`
- `<For each={…} key={…} let={row}>` — a `let=` binding, **not** a callback, and
  `each` must be a **mutable** array (a `readonly` tuple from `as const` fails
  the compiler's prop-type check)
- Stores: `const { t, lang } = useLocale()`

House style: Allman braces, one import per module, comments that state a
constraint the code cannot show.

## RTL / LTR rules

This app ships **ten languages**, two of them RTL (Persian, Arabic). Direction is
read from the registry row in `src/i18n/langs.ts` and stamped on `<html>` by
`src/stores/locale.store.ts` — nowhere else.

- **Logical properties only**: `ms-` `me-` `ps-` `pe-` `start-` `end-`
  `text-start` `text-end`. Any `ml-` `mr-` `pl-` `pr-` `left-` `right-`
  `text-left` `text-right` is a defect unless deliberately physical.
- Deliberately physical: charts with a time axis, media timelines, and
  Latin/numeric runs — wrap those in `dir="ltr"` (addresses, hashes, tickers).
- Do not write new `lang === 'fa'` conditionals for direction. Ask the registry;
  Arabic is RTL too.
- Only icons that are directional mirror — the mirror list is explicit in
  `src/icons/`.

## i18n rules

- All copy goes through `t('section.key')`. An inline user-facing string is a
  review comment.
- A key added to `src/i18n/en.ts` must gain a twin in **every** sibling
  dictionary (fa, ar, es, pt, hi, zh, ru, fr, tr). `Record<Lang, Dictionary>` in
  the locale store makes a missing one a compile error.
- Adding a language is two edits: a row in `langs.ts` and a dictionary bound to
  its code in `locale.store.ts`. Nothing else enumerates languages.
- **All numbers and dates go through `src/i18n/format.ts`.** Never call `Intl` or
  `toLocaleString` in a component — that is how Latin digits leak into the
  Persian UI. Persian gets Persian-Indic digits, scale words and the Jalali
  calendar; every other language gets its own `Intl` locale with numerals pinned
  to Latin via `-u-nu-latn`.
- Market titles, rules and outcome labels ride **on chain** as `{ en, fa }`. That
  payload does not grow when the UI gains a language; other locales fall back to
  the English variant.

## Accessibility rules

- Prefer native semantics over ARIA. Do not add ARIA speculatively.
- Never colour alone — YES/NO and status always carry an icon or a label.
- WCAG AA contrast in **both** themes; they fail independently.
- Visible focus via `:focus-visible`; never bare `outline: none`.
- Sheets and dialogs manage and restore focus.

## Responsive rules

Target viewports: **1440×900**, **1024×768**, **390×844**. Mobile gets a bottom
tab bar, drag-handled sheets, a sticky trade bar and 44 px targets; desktop gets
hover, density and keyboard paths. One component, two presentations — not a
scaled-down desktop.

## Visual QA workflow

After any UI change, run the `visual-qa` skill: build, start, then Playwright
across the three viewports **in both LTR and RTL** — six cells. Screenshot and
inspect each; never mark a cell green unseen. Mobile × RTL is where defects hide.

## Testing rules

Use Vitest and `@azerothjs/testing` — do not introduce a second runner. Component
tests use `renderTest`/`fire`/`cleanup`. Stores are app singletons, so any test
that flips one must restore it. `application/tests/format.spec.ts` pins exact
rendered strings on purpose: the failure mode in this domain is a mixed-script
number that looks plausible.

For a bugfix, the regression test must fail before the fix.

## Performance rules

Measure before optimising; a change without a before/after number is a guess.
Animate `transform`/`opacity`, not layout properties. Respect
`prefers-reduced-motion`. The client bundle is already ~681 kB (160 kB gzipped),
dominated by viem — check the chunk report before adding a heavy dependency.

## Security

- Money rules are enforced server-side: the charged amount comes from the stored
  row, never the request; settlement is idempotent; a resolved market cannot be
  resolved twice; admin routes are key-gated.
- Never commit `.env`. `server/.env.example` and `application/.env.example` list
  every key that is read — keep them in step.
