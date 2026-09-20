---
name: azeroth
description: >-
  How to write and change components, stores, resources and routes in this
  repository's AzerothJS client. Covers the `.azeroth` language, the reactive
  declarations, the store primitive, the resource gating rule, the router, the
  inferred API client, server rendering through kit, the house style, and the
  traps left over from the React version this app used to run on. Use before creating or editing any .azeroth
  file, any *.store.ts, any hook in src/hooks/, or routes.ts.

  Trigger on: "component", "page", "store", "state", "props", "derived",
  "effect", "fetch data", "route", "router", "re-render", ".azeroth".
---

# AzerothJS in this repository

The client is **AzerothJS 2.1** with `@azerothjs/kit` rendering the public pages on
the server. `application/src` is 79
`.azeroth` components plus the `.ts` modules they lean on; `skills.md` at the
repo root is the framework reference and is more current than any summary here.

This app was written in React 19 + React Router 8 until the port back to
AzerothJS - see **Migration traps** at the bottom for the shapes that left
behind, all of which are now bugs rather than idioms.

Every `.azeroth` file goes through `azeroth-tsc`, never `tsc`: TypeScript cannot
parse the markup region. `npm run check` runs it over both workspaces.

## Component anatomy

A component's body runs **ONCE**. That is the whole difference from React, and
nothing warns when it is forgotten:

```azeroth
export default component MarketCard(props: { market: Market; compact?: boolean })
{
    const { t, lang } = useLocale();          // stable handle, read once

    state open = false;                        // createSignal
    derived title = text(props.market.title);  // createMemo - RE-READS
    const slug = marketPath(props.market);     // plain value, never changes

    effect (props.market)                      // on(), explicit deps
    {
        track('market.seen', props.market.id);
    }

    <article class="card" class:is-open={ open }>
        <h3>{ title }</h3>
        <button onClick={ () => open = !open }>{ t('market.details') }</button>
    </article>
}
```

- `state x = v` is a signal; `x` reads it and `x = v` writes it.
- **`derived` is not optional.** Any body binding whose value depends on `state`,
  `props` or a store getter must be `derived`, or it freezes at its first value
  forever. `const` is for values that genuinely never change.
- `effect (a, b) { }` lists its dependencies; `mount { }` runs once after the
  tree is connected; `cleanup { }` inside an effect runs before its next run and
  at disposal.
- `props` is read through, never destructured in the body. `const { open } =
  props;` freezes `open` - the parameter form `component X({ open }: T)` is the
  one that stays reactive.
- Markup is the last statement of the body, unwrapped: no `return`.

## Control flow

Markup has no `&&`, no `?:` over elements and no `.map()`:

```azeroth
<Show when={ market.winningOutcomeId } let={ id }>...</Show>
<Show when={ rows.length === 0 } fallback={ <List rows={ rows } /> }>...</Show>
<Switch>
    <Match when={ !session.connected() }>...</Match>
    <Match when={ true }>...</Match>
</Switch>
<For each={ rows } key={ (row) => row.id } let={ row } index={ at }>...</For>
```

- `let={ x }` on `Show`/`Match` binds the **narrowed** value; it is how a branch
  reads something the guard proved non-nullish, with no `!` and no snapshot.
  A sibling `Match` arm does **not** narrow for the arms below it.
- A `<For>` row must be exactly one **host** element. A component row gets a
  `<div class="contents">` wrapper (or `<g>` inside an `<svg>`), because the
  reconciler moves rows by element identity and cannot see through a component.
- An early `return` from a component body is a branch taken once and kept
  forever. Guards are `<Switch>` arms, in the order the returns were written.

## Stores

`application/src/stores/*.store.ts` - thirteen of them, plain `createStore`
factories. The factory runs once per store scope, lazily, inside its own root:

```ts
export const useLocale = createStore(() =>
{
    const [lang, setLang] = createSignal<Lang>(readLang());
    return { lang, setLang, t: (key: string) => translate(lang(), key) };
});
```

Call `useStore()` anywhere - a component body, a module function, an event
handler. There is no hook rule and no `.peek()`: the handle **is** the non-hook
accessor. Granularity is per signal, not per store.

`create-draft.store.ts` (632 lines) is deliberately a store rather than form
state: the draft survives switching console sections, round-trips through a
querystring, and is submittable as a proposal.

## Async data

`createResource(source, fetcher)` - the source is the fetch key:

```ts
const positions = createResource(
    () => (session.connected() ? session.address() : false),
    (address: string) => client.portfolio.positions({ query: { address } })
);
positions.data();      // T | undefined
positions.loading();   // true while a fetch with no value to show is in flight
positions.error();     // unknown, or null
positions.refetch();   // Promise<void>
```

**The gate is load-bearing.** A source of `false`, `null` or `undefined` skips
the fetch and resets `data()` to undefined; `0` and `''` are valid keys. It is
what stops the admin console calling its endpoints before a session exists, and
what keeps a half-built key out of a URL - so a guard must test the sentinel the
source actually produces (`marketId !== ''`, not `!== undefined`).

Create resources inside a scope - a component body or a store factory. Unowned,
neither the effect nor an in-flight fetch is cleaned up.

## Routing

`application/src/routes.ts` is the one route table, data rather than markup, and
`App.azeroth` hands it to `createRouter`. Adding a page is one row plus the page.

- `useParams()` and `useQuery()` return **getters**: `params().slug`.
- `useNavigate()` returns the whole API - `const { navigate } = useNavigate()`.
- `lib/search-params.ts` gives the six `URLSearchParams` readers their old shape
  over `useQuery`; the params are a getter there too.
- `<Link activeClass="is-active">` **appends** a class and sets `aria-current`.
  The active look is a rule in `base.css`, in `@layer utilities` - from
  `components` it would lose to the `text-muted` utility it overrides.
- A market's address is its question: `/market/<slug>-<id>`. `marketIdFromSlug`
  reads the id off the end and answers `''` for a path that names no market.

## Server rendering

`@azerothjs/kit` renders the PUBLIC pages on the server; the wallet-gated ones ship a shell.
`routes.ts` says which is which, and `render` is the only field the browser ignores.

- `entry.server.ts` exports the route table and `createPageRenderer(App, routes)`. It is built
  by `vite build --ssr` into `dist-server/` and imported - never bundled - by the server.
- `main.ts` mounts it: `mountPages(app, { routes, renderer, clientDir, manifest, locales })`,
  registered **LAST**, because its asset fallback owns `/*path`.
- Dev is the same thing from source: `devPages` runs vite inside the server, so `npm run dev`
  serves pages, assets and the API on ONE origin and a developer exercises SSR on every reload.
  Dev hydration currently falls back to a clean client render with one console warning; the
  built client adopts the markup cleanly.
- **Loaders** (`loaders.ts`) run before the render, through the in-process api bridge: no
  socket, the page's own origin, the visitor's identity. Their result rides to the browser in
  the handoff, so hydration never refetches it.
- A loader seeds its resource with `initialValue`, and the options bag must be **omitted**
  when there is nothing to seed - a resource treats the mere presence of the key as "already
  settled" and skips its first fetch.
- `useHead` derives from the loader, never from inside Suspense: head facts that arrive after
  the shell never reach a crawler. `throw notFound()` is what makes a bad URL a real 404
  rather than a 200 carrying a not-found page.
- **The language is the server's.** It negotiates cookie > `Accept-Language` > `en` and stamps
  `<html lang dir>` on what it sends; the locale store adopts that and `setLang` writes the
  cookie the next request is negotiated from. `index.html` carries no `lang` of its own, so an
  absent one means "nobody decided" - the dev shell and an offline cache hit.
- The service worker is network-first for navigations and **never caches one**: a rendered page
  under the shell key would be handed to every other route offline.

## The API client

`application/src/api.ts` is ~10 lines: `createClient<Api>` over the manifest the
server publishes at `/api/_manifest`, typed from `server/src/app.ts`'s exported
`Api`. Adding a route on the server is all it takes for the client to have it -
there is nothing to write here.

## House style

- Allman braces, 4-space indent, single quotes, semicolons, no trailing commas.
- `{ expr }` with one space inside; `{...spread}` tight; camelCase events.
- `class`, not `className`. `class:name={ cond }` for state flags - the flag
  names are declared for Tailwind in `base.css`'s `@source inline(...)`.
- `styleMap({ ... })` for a computed style set; a raw object is not a style.
- Markup has no `//` comments - use `{ /* ... */ }`, outside the tag.
- Text keeps same-line spacing and collapses a newline to a space, so a literal
  that must sit against a hole stays on its line: `>+{ count }</button>`.
- `.ts` imports carry their extension; `.azeroth` imports carry `.azeroth`.

## Migration traps

Every one of these is a React habit that compiles and then misbehaves:

| Written | Does | Instead |
|---|---|---|
| `const x = props.a + 1` | freezes at the first value | `derived x = ...` |
| `const { a } = props` | freezes every field | read `props.a` |
| `if (x) { return <A/> }` | picks a branch once, forever | `<Switch>`/`<Match>` |
| `onChange` on a text input | fires on blur, not per keystroke | `onInput` |
| `onFocus` on a wrapper | `focus` does not bubble | `onFocusIn`/`onFocusOut` |
| `{ rows.map(...) }` | rebuilds the list on every change | `<For>` |
| `key={ x }` on an element | is not a prop | `<For key={ (r) => r.id }>` |
| `useRef(null)` for an element | no `ref` wiring | `createRef<T>()` + `ref={ }` |
| a module-level id counter | differs between server and client | derive the id |

`useCallback` and `useMemo` have no counterpart and need none: there is no
identity to stabilise, and a body that runs once makes a `let` a ref.

## Gates

```sh
npm run check   # azeroth-tsc over both workspaces, then eslint .
npm run build
npm test
```

`eslint .` carries the layout rules and forwards the compiler's own diagnostics
through the `.azeroth` processor; `--fix` settles indentation and interpolation
spacing. There is no formatter - markup layout is the linter's job, and the
language server's inside an editor.
