---
name: react
description: >-
  How to write and change components, stores, resources and routes in this
  repository's React client. Covers the store primitive built on
  useSyncExternalStore, the useResource data hook and its gating rule, React
  Router usage, the house style, and the migration traps left over from the
  framework this app used to run on. Use before creating or editing any .tsx
  file, any *.store.ts, any hook in src/hooks/, or routes.tsx.

  Trigger on: "component", "page", "store", "state", "props", "hook", "fetch
  data", "route", "router", "re-render", "useEffect", "useState", ".tsx".
---

# React in this repository

The client is **React 19 + React Router 8**, a plain Vite SPA. There is no SSR
half: every route rendered on the client already, so `dist/` is static files and
the server serves them with an index.html fallback.

This app was previously written in AzerothJS, a bespoke reactive framework, and
was migrated wholesale. Nothing of it remains in `application/`, but the shapes
it left behind are the reason several things look the way they do - see
**Migration traps** at the bottom.

For upstream React and React Router questions, query Context7:
**`/reactjs/react.dev`** and **`/remix-run/react-router`**. The router is v8, not
v6 - `react-router-dom` is not installed and everything imports from
`react-router`.

## Component anatomy

One component per file, default-exported, props typed inline:

```tsx
export default function Button(props: {
    variant?: ButtonVariant;
    loading?: boolean;
    onClick?: () => void;
    children?: ReactNode;
}) {
    const inert = props.loading === true || props.disabled === true;

    return (
        <button className={buttonClass(...)} disabled={inert}>
            {props.children}
        </button>
    );
}
```

JSX expressions are unspaced - `{value}`, not `{ value }`. That is oxfmt's
output and not negotiable per-file: run `npm run fmt` rather than hand-placing
whitespace.

## Stores

Twelve app-global singletons in `src/stores/*.store.ts`, built on the primitive in
`src/lib/reactive.ts`:

```ts
export const useLocale = createStore((): LocaleApi => {
    const [lang, setLang] = createSignal<Lang>(initialLang());
    return { lang, setLang: …, t: … };
});
```

- Consumed as `const { t } = useLocale();` at the top of a component. Reads are
  function calls - `lang()`, `theme()` - not bare values.
- `useX.peek()` is the NON-hook accessor, for module scope, effects and tests.
  Calling `useX()` outside a render breaks the rules of hooks.
- Granularity is **per store**: any change re-renders every component that called
  that store's hook. That is why the stores are split by concern.
- A store factory may read another store (`useCategories` reads `useLocale`).
  That does not subscribe - it **links** them, so a change in the inner store
  bumps the outer one too. The linking happens automatically; just call the hook.
- Because stores are singletons, **any test that flips one must restore it.**

Why not Context: twelve providers would buy nothing but a tree to thread them
through, and the pre-paint script in `index.html` stamps the same document
attributes `theme.store` and `locale.store` own.

## Async data

Two shapes, ONE set of semantics:

| Where | Use |
|---|---|
| inside a store | `createResource(source, fetcher)` from `lib/reactive.ts` |
| inside a component | `useResource(source, fetcher)` from `hooks/use-resource.ts` |

Both return the same `Resource<T>`: `.data()`, `.loading()`, `.error()`,
`.refetch()`.

```tsx
const markets = useResource(
    () => `${ search }|${ category }|${ sort }|${ page }`,
    () => client.markets.list({ query: { … } })
);
```

Two rules that are load-bearing:

- **The source is the whole dependency declaration.** Everything the fetcher
  reads must appear in what `source` returns, or the request silently goes stale.
- **A falsy source means NOT READY** - returning `false`, `null` or `undefined`
  fetches nothing. This is the gate that stops the admin console calling its
  endpoints before a session exists, and stops the market page fetching
  `/api/markets/undefined/activity` while navigating away.

`.error()` is `null` when there is no error, never `undefined` - call sites test
`error() !== null`.

## Routing

`src/routes.tsx` is the one route table; `src/app.tsx` renders it inside
`<BrowserRouter>`. Adding a page is one row plus the page file.

- `useParams()`, `useSearchParams()`, `useNavigate()`, `Link`, `NavLink` all come
  from `react-router`.
- `NavLink`'s className takes a function: `({ isActive }) => …`.
- `app.tsx` exports `AppFrame` (the frame WITHOUT a router) so tests can mount it
  under `MemoryRouter`.
- The catch-all `<Route path="*">` renders the 404 page; a thrown render error is
  caught by `ErrorBoundary` (`src/components/error-boundary.tsx`), the only class
  component in the app, because React has no hook form of it.

## The API client

`src/api.ts` is one explicit method per server route, typed from
`server/src/wire.ts`. The server asserts every TypeBox schema against that same
interface at compile time, so the two halves still cannot drift - but the client
surface is now hand-written, so **a new server route needs a new method here.**

Multipart uploads bypass the client and post `FormData` to `/api/uploads`
directly, because a browser posts a file natively.

## House style

4-space indent, single quotes, semicolons, no trailing commas, LF endings, one
import per module, `interface` over `type` for object shapes, `import type` for
types, union literals instead of `enum`, `#private` instead of `private`, no
`any`.

Two tools split the job. **oxfmt** owns everything whitespace-shaped - braces
land K&R, 120-column wrap, `endOfLine: lf` - and it has no brace-style option,
which is why the allman braces this repo was written in are gone. **oxlint**
owns the semantic half: the TypeScript discipline above plus `rules-of-hooks`
and `exhaustive-deps`. It implements no formatting rules at all, so a style
argument has exactly one answer - whatever `npm run fmt` produces.

The two bans oxlint cannot express, `enum` and TypeScript `private`/`protected`,
are convention now rather than a check.

Comments state a constraint the code cannot show - why a value is what it is, or
what breaks otherwise. Do not narrate what the next line does.

## Migration traps

Habits from the old framework that are now silent bugs:

- **`Rail` takes `itemKey`, not `key`.** React reserves `key` on every element,
  so a prop by that name never reaches the component.
- **No side effects in the render body.** `admin.refresh()` used to sit in the
  component body; in React that bumps the store, which re-renders, which
  refreshes again. It lives in a mount `useEffect` now.
- `class=` is `className=`, `for=` is `htmlFor=`, `onInput` is usually
  `onChange`, and SVG attributes are camelCase (`strokeWidth`, `stopColor`).
- `style` takes an object: `style={{ background: … }}`, not a string.
- Inline `style` with a template string, `<Show>`, `<For>`, `bind:value` and
  `class:` directives are all gone. The `@source inline(...)` list at the bottom
  of `base.css` existed for `class:` and is now dead - leave it or remove it, but
  do not add to it.

## Gates

```sh
npm run dev      # vite :6001 + fastify :6000, /api and /uploads proxied
npm run build    # client bundle only
npm test         # vitest, both workspaces
npm run check    # tsc + oxlint per workspace, then oxfmt --check
npm run fmt      # oxfmt, writes in place
```

`npm run check` reports five `react/purity`, `react/refs` and
`react/set-state-in-effect` warnings in `use-resource.ts`, `create-market-form`
and `resolve-dialog`. They are React Compiler rules held at warn until those four
sites are fixed; they do not fail the build.

Tests are Vitest 4 + happy-dom + **@testing-library/react** in
`application/tests/`. `render(<X />)`, `fireEvent.click(el)`, and cleanup runs
from `tests/setup.ts`. For a bugfix, the regression test must fail before the fix.
