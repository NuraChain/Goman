---
name: azerothjs
description: Agent reference for building with AzerothJS in this monorepo - the .azeroth language, runtime, server stack, tooling and house conventions. Dense by design.
---

# AzerothJS - agent reference

Fine-grained fullstack TS framework. No VDOM, no diff: a signal write re-runs only the effects that read it; each effect owns its DOM nodes. Components = `component` blocks in `.azeroth`; one compiled artifact renders client DOM, serializes SSR HTML, hydrates.
Monorepo `azerothjs-monorepo` v2.1.0: npm workspaces `packages/*`, editors `editors/*`, no root `src/`. Lockstep versions, exact inter-package pins. ESM-only, zero third-party runtime deps. Node: repo dev >=24 + npm 11; consumers frontend >=22, backend/fullstack >=24 (run TS source, no build).

## Packages
- `azerothjs` - whole frontend: signals, control flow, stores, resources, forms, router, SSR, `useHead`, i18n, `<Image>`. Only runtime import a frontend needs.
- `@azerothjs/compiler` - `.azeroth` compiler + `azeroth()` Vite plugin (devDep; peer `typescript >=5 <7`, `vite >=8`).
- `@azerothjs/schema` - validation for both halves; `Infer<typeof s>`.
- `@azerothjs/http` - server kernel; `/node` = `serve`; typed contracts `/api`; browser-safe client `/api/shared`. `azerothjs` is a required peer (ONE instance per process).
- `@azerothjs/kit` - per-route SSR/static/stream/client over the router table: `mountPages`, `/ssr createPageRenderer`, `/client bootClient`, `/dev devPages`, `/dev/entry SSR_SOURCE_ENTRY`, `/prerender prerender`.
- `@azerothjs/ws attachWebSockets` | `@azerothjs/cron createScheduler` | `@azerothjs/logger createLogger` (file sinks `/node`).
- `@azerothjs/cli` `azeroth dev|check|build|test|upgrade|doctor|info` (no config file) | `create-azeroth` scaffolder.
- `@azerothjs/testing renderTest cleanup leakGuard fire` | `@azerothjs/eslint-plugin` | `@azerothjs/language-server` (LSP, `azeroth-tsc`, `azeroth-docgen`) | `@azerothjs/typescript-plugin` (tsserver only, not tsc) | `@azerothjs/devtools` (`installDevtools`, `/server attachDevtools`).
- Never import `azerothjs/internal` or anything documented internal.

## Repo commands / layout
`npm ci` | `npm test` (vitest against src, no build) | `test:watch` | `lint` / `lint:fix` | `typecheck` | `build` | `verify` (build+lint+typecheck+publint+test) | `dev` (typecheck watch).
PR gate: lint, typecheck, test, build green. New behaviour -> test; bug fix -> regression test; published behaviour change -> `CHANGELOG.md [Unreleased]`.
- `packages/azerothjs/src/{reactivity,component,renderer,ssr,router,form,i18n}` = runtime.
- `packages/compiler/src/project.ts` (`generateVirtualCode`) = THE `.azeroth`->TS lowering (LS, TS plugin, decl emit, ESLint are adapters). `keyword-spec.ts` = keyword->helper table. `GRAMMAR.md` normative; `STABILITY.md` syntax policy; `examples/*.azeroth` canonical components.
- `packages/create-azeroth/templates/{frontend,backend,fullstack}` = reference app wiring (their specs ship to users, not run here; eslint ignores them).
- Tests: `packages/*/tests/*.spec.ts` only.

## Scaffold / CLI
`npm create azeroth@latest my-app [-- --template frontend|backend|fullstack] [--router] [--tailwind]` (flags => no prompts). NOT `npx azeroth` (unrelated package). Scripts = CLI verbs.
Shape detection: vite config + `azerothjs` = frontend; `@azerothjs/http|ws|cron` w/o vite = backend (decorator ORM => built via tsc, else native); root with exactly one of each = fullstack (`--app <dir> --server <dir>` disambiguates). `--print` prints child commands, runs nothing; `--raw` verbatim, adds no `NODE_ENV`. Fullstack root `"azeroth": { "dev": "server" }` => `azeroth dev` runs server half only, vite inside it, one origin. Exit 0 ok / 1 gate or child failed / 2 usage.
Fullstack layout: `application/src/{routes.ts, App.azeroth, pages/*.azeroth, api.ts, entry.server.ts, main.azeroth}`, `server/src/{schemas.ts (client-safe), app.ts (pure buildApp), main.ts (env, log, pipeline, serve, shutdown), deploy-env.ts}`, `server/tests/app.spec.ts`, `server/.env` (`PORT CLIENT_DIR SSR_ENTRY DEVTOOLS_TOKEN`).
Manual Vite: `plugins: [azeroth()]` (`azeroth({ typeCheck: false, extension: '.azeroth' })`); `render(() => App(), document.getElementById('root')!)`; `.azeroth` import extension optional. Fullstack app vite: `ssr: { noExternal: true, external: ['azerothjs'] }`.

## `.azeroth` language
File = TS module + `component` decls + at most one module-level `style { }`. Outside components = opaque TS, verbatim. Body = reactive decls, plain TS, markup in statement position (usually last). Props = ONE TS parameter (`props: T` | `{ a = 1 }: T` | inline type); destructured props stay reactive. `component Foo()` propless; `<Foo/>` -> `Foo()`. Uppercase or dotted tag = component, else element. Local non-exported components are usable as tags.

### Keywords (contextual, shape-gated, none reserved)
| decl | lowers to | read |
|---|---|---|
| `state x = v;` | `createSignal(v)` | bare `x`; `x = v` stores AS GIVEN (fn included); `x++` `x += 1` derive from prev |
| `derived y = e;` | `createMemo(() => e)` | bare, read-only |
| `deferred z = e with { delay?, name? };` | `createDeferred(() => e, o)` | bare; idle priority |
| `resource r = (s) => f(s) with { source: x };` / `resource r = () => f();` | `createResource(() => x, fetcher)` / `createResource(fetcher)` | `r.data() loading() refreshing() error() refetch()` |
| `stream s = (src, signal) => fetch(u, { signal }) with { source: x, parse: 'sse'\|'json'\|fn, initial?, name? };` | `createStream(() => x, fetcher, o)` | `s.partial() done() error() cancel() refetch()`; idle while source falsy, restarts on change, accumulates one string; `'sse'` unframes to `[DONE]` |
| `store st = { .. };` / `= () => ({ .. });` | `createStore(() => ..)` | `st()` instance; lazy singleton, per-request under SSR |
| `selector sel = x with { equals? };` | `createSelector(() => x, o)` | `sel(key)` boolean |
| `form f = { ..init } with { validate, validateForm, validateAsync, asyncDebounceMs, schema, onSubmit };` | `createForm` | `f.field` read, `bind:value={ f.field }`; rest explicit (Forms) |
| `form rows[] = blank with { initial, validate, validateArray };` | `createFieldArray` | `rows.rows() append() remove(i) move() values() isValid() error() validateAll() reset()`; row: `row.key`, `bind:value={ row.field }`, `row.form.errors()/touched()` |
| `effect { }` / `effect with { name } { }` | `createEffect(fn, o)` | auto-tracked |
| `effect (a, b) (cur, prev) with { skipInitial: true } { }` | `on([() => a, () => b], fn, o)` | explicit deps only; 2nd parens optional |
| `batch { }` `untrack { }` `cleanup { }` `dispose { }` `mount { }` | `batch` `untrack` `onCleanup` `onRootDispose` `onMount` | `cleanup` before effect re-run/dispose; `dispose` once; `mount` post-connection |
- Decls MUST end with `;` (no ASI); missing `;` before markup reads `<` as less-than.
- `store.get()`, `selector(x)`, a var named `state`, `effect(call);` = plain TS.
- A decl value may hold markup inside brackets (arrow body, parenthesised ternary, array/object literal, call arg); depth-0 markup is not part of the value.
- Sources/effect/wrappers work top-level AND nested (callbacks, IIFEs, module composables); factories (`resource stream store selector form`) top-level only.
- Omitted initializer = no-arg form (`state x;` -> `createSignal(undefined)`); always give one.
- `.ts`: call the same runtime fns directly.

### Markup
- Holes `{ expr }` = raw TS; nested markup compiles; comment-only hole dropped. Style: one space inside (`{ x }`, lint autofix), spreads tight `{...p}`.
- Host element: dynamic `{expr}` -> getter re-applied; handlers, fn literals, bare refs, array/object literals verbatim. Component tag: every prop a getter entry, read as `props.name`.
- Directives: `class:name={ c }`, `style:prop={ v }` (merge with static `class`/`style`; claim the base key), `bind:value={ f.field }` / `bind:checked={ s }` (write-back on `input` / `change`; an authored handler on the same key runs AFTER write-back), `ref={ cb | createRef() }` (element type follows tag + namespace; `null|undefined|false` = none).
- `classList({})` / `styleMap({})` only for whole computed sets; `css` template for computed scoped names.
- Merge = source order, later wins. Spread = SNAPSHOT at creation (values, not reactivity). Duplicate names (case-folded; `bind:p` claims `p` + its write-back key; `children` is a key) = compile error.
- Text = HTML text (entities decode; newline whitespace collapses; same-line spacing kept). No `<!-- -->` (hole with TS comment). Void elements childless. Fragments `<>..</>`.
- `innerHTML`/`textContent` own content (children = error); `innerHTML` unescaped, everything else escaped.
- Auto-imported: `Show For Switch Match Portal Dynamic Suspense ErrorBoundary Transition Outlet`. From `azerothjs`: `Link Routes RouterProvider Form Image ...`.
- `let={ n }` on Show/Match/For binds the narrowed value; `index={ i }` on For. Bare reads in markup (`{ i + 1 }`); in `.ts` `h()` they are getters `item()` `index()`.
- Events: `on*` = function position. OK: `onClick={ save }`, `() => count++`, `makeHandler(id)`. Compile error: assignment, `++`/`--`, zero-arg call of a name/path (`save()`, `props.onClose()`, `getHandler()`). `null|undefined|false` = no handler. camelCase (`onClick onKeyDown`); lowercase `onclick` on a host = reserved-name error. Component `on*` props typed by the component.
- `style { }`: plain CSS, module level, max one, never parsed; only `.class` selectors rewritten together with the module's static `class="a b"`/`class:name` to one hashed name; element/id/attr selectors and `@keyframes` names stay global; undefined classes untouched (Tailwind ok); `class={ expr }` not rewritten. Outgrown -> `import './x.css'`.
- TSX rules: `value as Foo` (no `<Foo>` casts); generic arrows `<T,>(v: T) => v`; call-position type args fine. Markup inside template `${ }` is NOT compiled.

## Runtime (`.ts`)
```ts
const [count, setCount] = createSignal(0);
const doubled = createMemo(() => count() * 2);
createEffect(() => console.log(count(), doubled()));
setCount((c) => c + 1);        // fn arg = updater
setCount.set(Component);       // .set stores as given
batch(() => { setCount(1); setCount(2); }); untrack(() => count());
on([() => count()], ([c], [prev]) => {}, { skipInitial: true });
const dispose = createRoot((dispose) => { createEffect(() => {}); onCleanup(() => {}); return dispose; });
```
Also `createContext provideContext useContext getOwner runWithOwner componentScope onMount catchError onUncaughtError`.
Store: `export const useCart = createStore(() => { const [items, setItems] = createSignal<string[]>([]); return { items, add: (id: string) => setItems([...items(), id]) }; });` -> `useCart().add('x')`.
Data: `createResource`, `createStream`, `cached(key, fetcher)` + `revalidate(fetcher)`. `createMutation((input, signal) => write, { optimistic: (input, patch) => patch(getCart, (c) => ..), invalidates?, policy: 'parallel'|'drop'|'restart'|'queue' })` -> `pending() error() run(input, { signal }) -> { ok, data } | { ok: false, error | cancelled } cancel()`. `run` never rejects; guess lives in the CACHE (all readers move); rollback per run; scope dispose does not cancel; cancel still invalidates; patch must be pure.
Render: `render(fn, el)`, `hydrate(fn, el)` (mismatch -> `HydrationMismatchError`, dev warn, clean client render), `renderToString(fn, { markers: false }?)`, `renderToDocument(fn, { title, head, lang, bodyAttrs })` (head/bodyAttrs unescaped), `renderToStream(fn, { signal })`, `h(tag, props, ...children)`, `island`/`hydrateIslands`, `collectStyleSheet`/`resetStyleSheet`, `useRequest()` (server only; null in browser).

## Control flow
```azeroth
<Show when={ user } let={ u } fallback={ <a href="/login">Sign in</a> }><p>{ u.name }</p></Show>
<For each={ items } key={ (it) => it.id } let={ it } index={ i }><li>{ i + 1 }. { it.label }</li></For>
<Switch fallback={ <NotFound /> }><Match when={ tab === 'a' }><A /></Match></Switch>
<ErrorBoundary fallback={ (error, reset) => <button onClick={ reset }>Retry</button> }><Risky /></ErrorBoundary>
<Suspense fallback={ <p>Loading</p> } on={ [orders, offers] }><List rows={ orders.data() ?? [] } /></Suspense>
```
`For`: `key` REQUIRED; keyed reuse (values baked at creation stay - read reactive names inside the row). `Suspense on` required, captured once, stable resource refs (never a signal-built array), empty = immediate; buffered SSR emits fallback and client swaps after hydration; stream mode streams chunks. `Dynamic component={}`; `Portal target={ el }` (default body); `Transition`, `TransitionGroup`; `VirtualList`/`createVirtualizer`.

## Forms
Validators (from `@azerothjs/schema`, re-exported): `required minLength maxLength min max pattern email url oneOf phone` + `combine`; all but `required` pass empty. `FieldValidator = (value) => string | null`.
```azeroth
form login = { email: '', password: '', remember: true } with
{
    validate: { email: combine(required('Email is required'), emailRule('Enter a valid email')), password: combine(required(), minLength(8)) },
    validateForm: (v) => ({ confirm: v.confirm !== v.password ? 'Passwords must match' : null }),
    validateAsync: { username: async (value, signal) => ((await (await fetch(`/api/u?u=${ value }`, { signal })).json()).available ? null : 'Taken') },
    asyncDebounceMs: 400,
    onSubmit: async (values) => { try { await props.onAuthenticate(values); } catch { login.setError('password', 'Invalid'); } }
};
<form onSubmit={ login.handleSubmit }>
    <input type="email" bind:value={ login.email } />
    <Show when={ login.touched().email }><span class="field-error">{ login.errors().email }</span></Show>
    <input type="checkbox" bind:checked={ login.remember } />
    <button type="submit" disabled={ login.submitting() || login.isValidating() }>{ login.submitting() ? '...' : 'Sign in' }</button>
</form>
```
- API: `values() errors() touched() submitting() validating() isValidating() isValid() submitError() handleSubmit setValue setError reset register('f')`.
- `schema:` = whole-object `@azerothjs/schema` node (the one the server enforces). Per-field error beats cross-field. Numeric initial stays `number` (coerced). `onSubmit` may be a `createMutation` itself (pass it, not a wrapper): refusal -> `submitError()` + field map on fields.
- Radios: `checked={ f.plan === 'pro' } onChange={ () => f.plan = 'pro' }`; select: `onChange={ (e: Event) => f.c = (e.target as HTMLSelectElement).value }` + `selected={}` options. Server 422 -> `applyFieldErrors(form, error)` (`@azerothjs/http/api/shared`).

## Router
Routes = data; location = signal; one table drives client, SSR, handoff.
```ts
export const routes: Route[] = [
    { path: '/', component: Home },
    { path: '/users', component: UsersLayout,
      guard: ({ request, from }) => auth.signedIn() ? true : '/login',
      loader: async ({ params, query, signal, parent, request }) => fetchUsers(signal),
      children: [{ path: '', component: UserList }, { path: ':id', lazy: () => import('./pages/user-profile.azeroth') }] }
];
```
```azeroth
export default component App(props: { url?: string; handoff?: LoaderHandoff })
{
    const router = createRouter({ routes, history: props.url !== undefined ? createMemoryHistory(props.url) : undefined, initialLoaderData: props.handoff });
    <RouterProvider router={ router }>
        <nav><Link to="/" activeClass="active" end>Home</Link><Link to="/users" prefetch="hover">Users</Link></nav>
        <Routes fallback={ () => <h1>Not found</h1> } blocked={ (s) => <h1>{ s.status === 401 ? 'Sign in' : 'No access' }</h1> } />
    </RouterProvider>
}
```
- Layout: `component L(props: { children?: MountNode }) { <Outlet children={ props.children } /> }`.
- Composables (inside provider, no arg; `useRoute(router)` for tests): `useRoute useMatch useParams useQuery useNavigate useLoader useSearch useRevalidate useActionResult`; `router.pending() navigate replace back forward href block(fn) prefetch(to)`.
- `defineRoute('/users/:id', { lazy, loader, search: object({..}) })` -> typed `useLoader(h)`, `useSearch(h)` (coerced; invalid query -> `{}` + one warn), `h.to({ id }, { search })`.
- Loaders: all matched levels run PARALLEL; `await parent` only if dependent; re-run on own inputs (params at/above its level + declared query); abort via `signal`; throw `redirect('/x')` / `notFound()`. Descendant params: `useParams()` in the component.
- Guards root-to-leaf BEFORE loaders: `true` | target/`redirect()` | `false`/`forbidden()`/`unauthorized()`; async holds; first veto wins; denial settles AT the target URL in blocked state (`<Routes blocked>`; SSR answers 401/403). `request` null on client and shared renders -> fail closed. `router.block(fn)` leave blocker (pop best-effort).
- Actions: `action: async ({ form }) => ..`: `undefined` -> 303 same URL (PRG); value -> 422 re-render, `useActionResult()`; throw `redirect()` (off-origin refused; `unsafeUrl()` opts out); no action -> 405; page guards run first; CSRF via hidden `_csrf` (stripped before the action); not on static pages nor routes with children. `<Form>` renders the token and enhances the submit (JSON, in-place revalidate, `onSettled`).
- `<Link>` = real `<a>`: `activeClass` (+`aria-current`), `end` exact, `to={ () => .. }` reactive, `prefetch="hover"|"viewport"|"render"` (opt-in; shares the loader cache; 30 s hold).
- `useRoute()()`: `pathname navigationKind delta key`. Scroll restore + `data-route-focus` focus on by default; `createRouter({ scroll: false, focus: false, scrollBehavior, base })`, `navigate(to, { scroll: false })`.
- Manual SSR: `matchAndLoad(routes, url, { signal })` (`'redirect' in result` -> 302) -> `renderToDocument(fn, { head: loaderHandoffScript(result) })`; client `initialLoaderData: readLoaderHandoff()`. `createBrowserHistory` / `createMemoryHistory`.

## Kit (SSR / prerender / hydrate)
`PageRoute` = route + `render`: `'server'` (default with renderer; per request, uncached) | `'static'` (build; params need `staticParams: () => Promise<{..}[]>`, unlisted -> live; browser-safe closure) | `'stream'` (shell first, Suspense chunks out of order, no refetch) | `'client'` (SPA shell; default without renderer). Modes inherit to children. `revalidate: 300` = ISR: stale answers, ONE bg render, failure keeps old copy; cache `MemoryPageCache` (process-local) / `FilePageCache` / own `PageCache`, `maxEntries` 1000; query string is part of the key (order normalised); entries stamped with build identity (deploy = cold); `x-azeroth-cache: hit|stale|miss|live`.
```ts
// application/src/entry.server.ts (vite build --ssr): export { routes }; export const renderPage = createPageRenderer(App, routes);
// application/src/main.azeroth: bootClient(App);
// server: mountPages(app, { routes, clientDir, renderer: renderPage, manifest: manifestOf(api), images: true, csrf, locales, scriptNonce, cache, onError, shell }); // register LAST
```
Build: `vite build && vite build --ssr src/entry.server.ts --outDir dist-server && azeroth-kit-prerender --entry dist-server/entry.server.js --client dist` (= `azeroth build`; failed build rolls back). Dev: `devPages({ root, entry: SSR_SOURCE_ENTRY, pages, routes: (app) => registerApi(app), app: { dev, observe, onError }, serverAnchor? })` -> `{ app, before, attach(server), close() }`; HMR on the same origin; refuses `server.proxy`, `base != '/'`, `server.watch: null`, `server.ws|hmr.{port,clientPort,host}`; vite major 8, declared as devDep by the half running the session. Dev divergences: static renders live, `cache` ignored, `images` is a mount error (register `/_image` with `imageHandler({ root })`), api route at a page path wins silently, GET+POST catch-alls.
Rules: a guard in the chain refuses `static`/ISR below it (build AND mount); reading the request (loader `request`, even destructured; non-null `useRequest()`; in-process api call) => `private, no-store`; shared renders (prerender, ISR regen/first render) get NO request (static page needing identity fails the build; unenumerated ISR fails live 500); `useRequest()` null in browser -> markup from it cannot hydrate (read identity in the loader instead); kit `revalidate('/path')` marks an ISR page (any spelling) vs azerothjs `revalidate(fetcher)`; CSP: `scriptNonce` and the nonce in BOTH `script-src` and `style-src`; `images: true` serves `/_image` (passthrough w/o `ImageAdapter`); edge `rateLimit` is load-bearing for ISR (renders are not bounded by connections).
`<Image src alt width height sizes optimize={ true } />` (`ImageConfig` provider alternative).

## Server - `@azerothjs/http`
Handler `(context) => Response`; context: `request params url path` (decoded matched path - decide policy on `path`, not `url.pathname`) + middleware additions. Request = reactive root (per-request `createStore`, `onWorkUnitCleanup` always runs, `request.signal` = disconnect).
```ts
const app = new App({ dev, observe: logRequests(log), onError, serializeError: ({ error, expose }) => ({ .. }), responseTimeoutMs });
app.get('/u/:id', (c) => json({ id: c.params.id }));
app.post('/a', async ({ request }) => json(await readValidated(request, schema, { mode: 'first' }), { status: 201 }));
const authed = app.with((c) => { const t = c.request.headers.get('authorization'); if (t === null) { throw new UnauthorizedError('..'); } return { userId: t }; });
authed.get('/me', (c) => json({ id: c.userId }));      // fork: only its routes run the middleware
app.get('/ev', (c) => sse(c.request, (send) => send({ data: 'x' })));
app.query('/search', async ({ request }) => json(await search(await readJson(request))));   // RFC 10008: safe, body-carrying, no mutation
const served = await serve(pipeline(app, requestId(), securityHeaders(), cors({ origin: ['https://a.example'], credentials: true }), csrfCookie(csrf), rateLimit({ limit: 100, windowMs: 60_000 })),
    { port, hostname, timeouts: { headersMs, keepAliveMs, requestMs, checkIntervalMs }, trustProxy, before });
handleShutdownSignals(served, { beforeShutdown, beforeExit });   // served.shutdown() drains, then destroys held sockets
```
- Middleware returns additions (merged, typed; never `request/params/url`) | `Response` (short-circuit) | nothing; no `next()`; lexical order; `app.use` = everything after; `app.with` = fork. Edge middleware (`requestId securityHeaders cors rateLimit csrfCookie compressResponse`) composes via `pipeline()` OUTSIDE the app. `rateLimit` never in `app.use` (in-process leg has no peer -> 500 `rate-limit-key-unavailable`); behind a proxy `trustProxy`/`trustedHops` else one shared bucket; non-Node runtime needs explicit `key`. `cors` never reflects arbitrary origins with credentials.
- Errors: `{ error: { code, message, details? } }`; 4xx messages cross, 5xx hidden (`dev: true` exposes); `ValidationError.details.fields` = form `setError` map; `UnauthorizedError`; route conflicts fail boot; 405 + `Allow`; `serializeError` reshapes once (404s included).
- Bodies limited by default: `readJson readValidated`, urlencoded, raw, multipart, `streamMultipart` (pull-based); static files traversal-safe (`containedFile`), etag/304/206; cookies (`__Host-`/SameSite validated); `clientIp(request, { trustProxy, trustedHops })`; `loadConfig({ port: num('PORT', { default: 3000 }), env: oneOf('NODE_ENV', [..], { default: 'production' }), s: str('X') })` = one boot error; `toFetchHandler(app)` for Bun/Deno/Workers (`app.handle` returns the kernel response, not a host `Response`); `forwardIdentity(from, to)`.
- CSRF: `csrfCookie(csrf)` at the edge + `csrfProtect(csrf)` guard on mutations; `csrf: CsrfOptions = dev ? { secure: false } : {}` shared by both and the typed client (`x-azeroth-csrf` header mirrored automatically); safe methods skip; `allowedOrigins`; `Sec-Fetch-Site`/`Origin` rules (same-site refused; `Origin: null` judged by `Sec-Fetch-Site`). Tests: `csrfToken()` -> cookie `__Host-azcsrf=T` + header `x-azeroth-csrf: T`.
- Streaming: reading a body in edge middleware buffers it; skip responses with `x-accel-buffering: no`; `clone()` tees. `responseTimeoutMs` bounds handler time (503), not streaming bodies.
- Dev loop: `node --watch src/main.ts` (strip-only TS; relative imports carry `.ts`; tsconfig `module`/`moduleResolution: nodenext`, `allowImportingTsExtensions`, `noEmit`, `strict`, `types: ["node"]`); `tsc --noEmit` separate gate; decorator ORM => build. `NODE_ENV` unset = production; the runtime reads it at module eval (`.env` too late) -> `node --import ./src/deploy-env.ts` with `process.env.NODE_ENV ??= 'production'`; `process.loadEnvFile()` in try.
- Test: `app.handle(new Request('http://local/path', init))`.

### Typed API - `@azerothjs/http/api`
```ts
export const api = { keys: feature('/keys', [requireAuth], (routes) => ({
    list: routes.get('/', { output: array(key) }, (c) => list(c.accountId)),
    create: routes.post('/', { input: keyInput, output: key, responses: { 201: key }, docs }, (c) => reply(201, mint(c.input), { location: '..' })),
    revoke: routes.del('/:keyId', {}, (c) => revoke(c.params.keyId)),
    sign: routes.with(csrfProtect(csrf)).action('/sign', { input, output }, ({ input }) => ..),   // POST-only, param-free, client calls it as a fn
    upload: routes.form('/f', { fields, limit, maxParts, maxFileSize }, h), hook: routes.raw('POST', '/w', {}, h),
    feed: routes.stream('/s', {}, async (c, connection) => { connection.send('x '); connection.close(); }),   // SSE; connection.signal
    health: routes.only().get('/healthz', {}, () => ({ ok: true }))   // only() REPLACES the chain (drops guards); with() ADDS
})) };
register(app, api);                                            // ONE register per App
app.get('/api/_manifest', () => json(manifestOf(api)));        // fallback when no page embeds it (manifestScript() for non-kit HTML)
app.register(openapiPlugin({ features: api, info: { title, version } }));   // /openapi.json + /docs; NODE_ENV=development only (public: true)
```
```ts
// application/src/api.ts - `import type { api } from '../../server/src/app.ts'` (type-only, erased)
const manifest: Manifest = typeof document === 'undefined' ? {} : readManifest() ?? await fetch('/api/_manifest').then((r) => r.json() as Promise<Manifest>).catch(() => ({}));
export const client = createClient<typeof api>(manifest, { baseUrl: '/api', headers?, fetch? });
await client.keys.create({ input: { label: 'ci' } });   // JSON route: { input, query, params }
await client.posts.create({ title: 'x' });              // action: the input IS the argument
```
- `guard((c) => ok ? { accountId } : new Response(null, { status: 401 }))` infers additions (conditional bare return => optional). Verbs `get post put patch del query method`. Factories closing over state: `export type Api = { comments: ReturnType<typeof commentsFeature> }` (type alias, not interface); `register` returns the record.
- Input/query validate at the boundary -> 422 `details.fields`; output validates AND STRIPS undeclared fields (off-contract = hidden 500 `contract-violation`); raw `Response` passes through; `reply(204)`; undeclared status with body = compile error. Any Standard Schema v1 validator works (OpenAPI degrades). `Date` arrives as ISO string (`Wire<T>`). Form/raw/stream routes inherit guards + appear in manifest/OpenAPI but are filtered from the typed client (browser posts `FormData` / opens `EventSource`). `uncontracted(app, features)` lists uncovered routes. QUERY routes listed under `x-azerothjs-query`.
- In-process: a relative-`baseUrl` client called inside a page request (guard walk, loader, per-request render, action body) dispatches through `app.handle` with `forwardIdentity` (cookie, authorization, accept-language only); GET/HEAD only; enters at `app.handle` (outer `pipeline` skipped); nested root, inherits signal + remaining deadline; redirects not followed; no ambient request -> named error. Tests: `createClient<typeof api>(manifestOf(api), { baseUrl: '/api', fetch: (r) => app.handle(r) })`.

### `@azerothjs/schema`
```ts
const entryFields = { name: string({ min: 2, max: 40 }), message: string({ min: 1, max: 280 }) };
export const entryInput = object(entryFields);
export const entry = object({ ...entryFields, id: number({ int: true }), at: date() });   // date() = ISO wire codec
export type Entry = Infer<typeof entry>;
entryInput.safeParse(x);   // { ok: true, value (normalized) } | { ok: false, errors: flat path map, issues: [{ path, code, message }] }; parse() throws; { mode: 'first' }
```
`string({ trim, lowercase, nonempty, min, max, pattern, format: 'email'|'url'|'uuid'|'datetime', codes, messages })`, `number({ int, min, max, coerce })`, `boolean literal enumOf array object record union date({ min })`, `.optional()`, `.refine(fn | fieldValidator, { code, message })`. `object()` strips unknown keys. String check order: required, type, normalize, nonempty, min, max, pattern, format, refine. Errors shape = `{ 'items.0.email': 'msg' }`.

### ws / cron / logger
- `attachWebSockets(server, { path, verifyOrigin: (o) => bool, heartbeatMs, onConnection(socket) { socket.send(strOrBytes); socket.onMessage = (d) => ..; socket.onClose = (code, reason) => ..; socket.bufferedAmount; await socket.drain(); socket.close(1001) } })` -> `detach()`. Beside http: `attachWebSockets((await serve(app)).server, ..)`; `handleShutdownSignals(served, { beforeShutdown: () => detach() })`.
- `createScheduler({ onError })`: `schedule(name, '0 3 * * *', fn, { timeZone, overlap: 'concurrent'? })`, `at(name, '08:30', fn)`, `every(name, ms, fn)`, `jobs()`, `runNow(name)`, `stop({ drain })` (from inside a job: `drain: false`). Overlapping ticks skipped by default; DST honest; missed occurrences never replayed; bad expr/timezone/duplicate throws at `schedule()`. `parseExpression`/`nextOccurrence` exported.
- `createLogger({ redact, fields, sink | stream, face })`: `trace debug info warn error`, `child(fields)`, `enabled(level)`; sinks `terminalSink() prettySink({ hide }) teeSink(a, b)`, `/node`: `fileSink(dirOrUrl) fileStream(dir, { maxFileBytes, maxFiles })` (batched, rotation, drops on backpressure); `printBanner({ version, subtitle, entries, readyMs })`; env `AZEROTH_LOG=debug|json|pretty:trace`, `NO_COLOR`, `FORCE_COLOR`, `NODE_ENV=production` => NDJSON. Request lines: `new App({ observe: logRequests(log) })`. Errors serialize with `cause` chain.

## Head / i18n
- `useHead({ title | getter, titleTemplate: '%s - Acme', meta: [{ name|property|httpEquiv, content, media }], links: [{ rel, href, .. }], jsonLd })`. Nesting precedence (leaf wins, restores on unmount); template applies to titles declared later (two calls). Must resolve in the sync main pass: derive from `useLoader()`, never inside Suspense on `'stream'` (dropped, dev warning). `http-equiv=refresh` off-origin refused (`unsafeUrl()`). Unserializable values dropped.
- `mountPages(app, { locales: { supported: ['en', 'fa'], default?, cookie: false?, acceptLanguage: false?, routing: 'prefix'? } })`: cookie (`setLocale`) > `Accept-Language` in preference order > default (`supported[0]`); regional tags map to language; stamps `<html lang dir>` (+`data-azeroth-base` under prefix); `Vary: accept-language, cookie` unless prefix. `routing: 'prefix'`: `/en/about`, bare `/about` 302s, reciprocal hreflang + `x-default`, routes stay `/about`, `<Link>`/redirects/`<Form>` auto-prefixed (`router.href()`; secondary router `base: ''`); `setLocale` navigates to the sibling URL. Prerender: `prerender({ .., locales: [..], routing: 'prefix' })` writes `index.<lang>.html`. ISR keys include language.
- Components: `useLocale() useDirection() setLocale('fa', { cookie: false }?)`; `createMessages({ en: { k: 'v {name}', p: { one: '..', other: '..' } }, fa: { .. } })` -> `t(k, { name })` (first catalogue = the type; missing key falls back to it; plurals via `Intl`: `one few many other`); `useNumberFormat() useDateFormat() useRelativeTimeFormat() useListFormat()` (explicit per call, never ambient). Outside pages: `negotiateLocale(request, { supported })`. CSS: logical properties.

## Testing
vitest + happy-dom; `// @vitest-environment node` at top for SSR/compiler specs. `renderTest(fn) -> { container, unmount }` (attached; delegated events fire); `cleanup()` (auto `afterEach` when runner globals on - repo config has `globals: true`; templates write `afterEach(cleanup)`); `fire(el, 'click', init?)` bubbling cancelable; `leakGuard(...getters)` -> check fn that throws on leaked subscriptions. Raw `render`/`hydrate` only when testing them.
```ts
afterEach(cleanup);
it('counts', () => { const { container } = renderTest(() => App({ url: '/' })); const b = container.querySelector('button')!; fire(b, 'click'); expect(b.textContent).toContain('count = 1'); });
```
Server: `buildApp({ dev: false }).handle(new Request('http://local/api/healthz'))`; CSRF-guarded posts send the `csrfToken()` pair.

## Tooling
- Type gate: `azeroth-tsc [-p tsconfig] [--watch]` (`azeroth check` runs it), never `tsc` (cannot parse `.azeroth`); one program over `.ts` + `.azeroth`; no `declare module '*.azeroth'` shim; no `vite/client` types entry needed. Editors: tsconfig `"plugins": [{ "name": "@azerothjs/typescript-plugin" }]` (+ VS Code "Use Workspace Version"). Consumer build: `azeroth-tsc && vite build`.
- ESLint 9 flat: `...azeroth.configs.recommended` LAST. `.ts` rules `azeroth/no-self-write-in-effect require-effect-disposal handler-call`; `.azeroth` processor forwards compiler diagnostics + markup rules `interpolation-spacing duplicate-attr event-case` (`--fix`); layout/type-aware rules only on `.ts`. Editors: VS Code ships `eslint.validate: ["azeroth"]`; WebStorm add `azeroth` to "Run for files".
- Compiler build diagnostics: lint (dup attrs, lowercase events - warn), semantic (inert effect / constant derived - warn; duplicate props, write to derived - error), `azeroth/unused-import`, TS type check (handlers, props incl. cross-file/missing required, built-in control-flow props; markup children NOT checked; sound, no false errors).
- Devtools: before mount: `if (import.meta.env.DEV) { try { const { installDevtools } = await import('@azerothjs/devtools'); installDevtools({ server: location.origin }); } catch (e) { console.warn(e); } }`. Server: `attachDevtools(served.server, { token, allowNonDevelopment?, allowRemoteClients? })` only under literal `NODE_ENV=development`, loopback peer, localhost Origin; token from `.env DEVTOOLS_TOKEN` (16+ chars). `with { name }` / `{ name }` option labels nodes. `createAgent()` headless.
- Editors: `editors/vscode`, `editors/jetbrains` (LSP: completion, keyword hover docs, cross-file nav/rename, semantic tokens `component tag attribute event string delimiter`, inlay hints, formatting = TS regions only, markup verbatim). TextMate grammar `@azerothjs/compiler/azeroth.tmLanguage.json`.
- `azeroth doctor` (Node floor, decorator ORM w/o `emitDecoratorMetadata`, missing `@types/node`, stale extension, stale `.azeroth/types`, version skew across halves, `shell: true` spawns, dev capability, dev vite copy); `azeroth upgrade <v>` (every pin, install, doctor); `azeroth info`.

## Conventions (eslint.config.ts / CI)
- Allman braces; 4-space indent (`SwitchCase: 1`); single quotes (`avoidEscape`); semicolons; no trailing commas; LF; max 1 blank line, none at BOF/EOF; no trailing spaces; `{ a }` and `${ x }` spacing; `curly: all`; `space-before-blocks`; `no-unexpected-multiline` off (Allman call parens).
- `interface` for object shapes, `type` for unions/mapped/conditional; no `enum`/`namespace`; top-level `import type` (not inline); classes: explicit `public` (ctor none), native `#private`, no `private`/`protected`, no ctor param properties, `readonly` where true; exhaustive `switch`; `satisfies Record<K, ..>` tables; `no-explicit-any` error; unused `_x`; explicit return types warn (off in tests/js/`.azeroth`); template numbers allowed; `no-non-null-assertion` off in tests; `require-await` off in tests.
- Comments ASCII-only; no ADR/milestone/ticket refs in doc comments (external RFCs fine); doc comments explain WHY. Each keyword stays a separate first-class concept (never fold into another's option); keyword set frozen per major (`STABILITY.md`); grammar = public API, every syntax change carries a `GRAMMAR.md` diff.
- Markup `{ expr }` spacing; camelCase events; `bind:` for mirrors, `value` + `onInput` when transforming. Server: `.ts` import extensions; `app.ts` = pure `buildApp(deps)`; `main.ts` = env/log/pipeline/serve/shutdown.
- Tests `packages/<pkg>/tests/*.spec.ts` (not `.test.ts`); prefer `@azerothjs/testing`.
- Commits: Conventional, scope = repo PATH: `feat(packages/form): ..`, `feat(packages): ..` (several), `feat(editors/vscode)`, `feat(editors)`, `chore(ci|actions|scripts|build|deps|deps-dev|github|hooks)`, `docs(changelog|readme|contributing)`, `docs(changelog,readme)` (comma list), `chore(release): vX`; `!` + `BREAKING CHANGE:` footer; header < ~100 chars; hook nudges. Not wired to versioning.
- Releases (maintainer): `npm run release -- alpha|beta|rc|pre|stable|patch|minor|major|<version> [--channel stable] [--dry-run] [--no-changelog] [--no-publish]`; lockstep bump (packages, editors, doc examples), promotes `[Unreleased]`, lockfile, build/lint gate, commit+tag, publish (dist-tag from channel; idempotent) BEFORE push, sync VS Code lockfile. Not changesets. Deprecations: announced, kept one major cycle, removed in a later major (codemods via `azeroth upgrade`).

## Examples
```azeroth
export default component Counter(props: { start?: number })
{
    state count = props.start ?? 0;
    derived parity = count % 2 === 0 ? 'even' : 'odd';
    effect { document.title = `${ count } now`; }
    <button class="btn" class:positive={ count > 0 } onClick={ () => count++ }>Count: { count } ({ parity })</button>
}
```
```azeroth
component TodoRow(props: { todo: Todo; onToggle: (id: number) => void })   // local component
{
    <li class:done={ props.todo.done }><input type="checkbox" checked={ props.todo.done } onChange={ () => props.onToggle(props.todo.id) } /> { props.todo.text }</li>
}
export default component Todos()
{
    state todos = [] as Todo[];
    state draft = '';
    derived remaining = todos.filter((t) => !t.done).length;
    let nextId = 1;                                                            // plain non-reactive local
    const add = () => { const text = draft.trim(); if (text === '') { return; } todos = [...todos, { id: nextId++, text, done: false }]; draft = ''; };
    const toggle = (id: number) => { todos = todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)); };
    <input value={ draft } onInput={ (e) => draft = (e.target as HTMLInputElement).value } onKeyDown={ (e) => { if (e.key === 'Enter') { add(); } } } />
    <span style:color={ remaining === 0 ? '#080' : '#c00' }>{ remaining } left</span>
    <ul><For each={ todos } key={ (t) => t.id } let={ todo }><TodoRow todo={ todo } onToggle={ toggle } /></For></ul>
}
```
```azeroth
export default component Account(props: { userId: string })   // async: resource + Suspense, SSE stream
{
    resource orders = () => fetchOrders(props.userId);
    state asked: string | false = false;
    stream reply = (question: string, signal: AbortSignal) => fetch(`/api/assistant?q=${ encodeURIComponent(question) }`, { signal })
        with { source: asked, parse: 'sse' };
    <Suspense fallback={ <p>Loading</p> } on={ [orders] }><OrderList rows={ orders.data() ?? [] } /></Suspense>
    <button onClick={ () => asked = 'hello' } disabled={ asked !== false && !reply.done() }>Ask</button>
    <Show when={ asked !== false }><p>{ reply.partial() }</p><button onClick={ () => reply.cancel() }>Stop</button></Show>
}
```
```azeroth
export default component GuestBook()   // route page: SSR loader + shared schema + server action
{
    const entries = useLoader<Entry[]>();                       // seeded by the handoff; no refetch on hydration
    form sign = { name: '', message: '' } with
    {
        schema: entryInput,
        onSubmit: async (values) =>
        {
            try { await client.guestbook.sign(values); sign.reset(); void entries.refetch(); }
            catch (error) { if (!applyFieldErrors(sign, error)) { sign.setError('message', 'Could not reach the server'); } }
        }
    };
    <form onSubmit={ sign.handleSubmit }>
        <input bind:value={ sign.name } /><Show when={ sign.touched().name && sign.errors().name }><small>{ sign.errors().name }</small></Show>
        <input bind:value={ sign.message } /><button type="submit" disabled={ sign.submitting() }>Sign</button>
    </form>
    <Switch><Match when={ entries.loading() }><p>Loading</p></Match><Match when={ entries.error() }><button onClick={ () => void entries.refetch() }>Retry</button></Match></Switch>
    <For each={ entries.data() ?? [] } key={ (e) => e.id } let={ e }><li>{ e.name }: { e.message }</li></For>
}
```
```ts
// h() by hand (what markup compiles to)
h('section', { class: classList({ panel: true, open }) },
    Show({ when: open, fallback: () => h('p', {}, 'hidden'), children: () => For({ each: items, key: (i: string) => i, children: (item) => h('li', {}, item) }) }));
```

## Pitfalls
- Missing `;` after a reactive decl before markup -> `<` is less-than.
- `onClick={ save() }` / `{ count++ }` -> compile error; use `onClick={ save }` / `() => ..`.
- `<Foo>value` casts and comma-less `<T>(v) =>` are markup; use `as` and `<T,>`.
- Spread forwards VALUES, not reactivity - pass live props explicitly.
- `<For>` needs `key`; `<Suspense>` needs a stable `on` list.
- Effect reading a state and writing it back = loop; timers/listeners without `cleanup { }` leak.
- `useRequest()`/guards reading identity make a page private; markup from `useRequest()` cannot hydrate.
- Guard above `render: 'static'`/ISR is refused at build and mount; action not on static/with children.
- Two `revalidate`s: kit `('/path')` vs azerothjs `(cachedFetcher)`.
- In-process api = GET/HEAD only; `rateLimit` in `pipeline()`, never `app.use()`; behind a proxy set `trustProxy`.
- `tsc` cannot see `.azeroth` -> `azeroth-tsc` / `azeroth check`.
- One `azerothjs` instance per server process (`ssr.external: ['azerothjs']`).
- `NODE_ENV` unset = production; `.env` cannot set it in time - use `--import deploy-env.ts` / process env.
- Devtools: before `render`, behind `import.meta.env.DEV`, inside `try`.
- Head facts inside Suspense on streamed routes never reach crawlers - derive from loaders.
- `npm create azeroth`, not `npx azeroth`.

## Reference
`README.md`; `packages/azerothjs/README.md` + `docs/{reactivity,renderer,component,form,router,head,i18n,server}.md`; `packages/compiler/{README,GRAMMAR,STABILITY}.md`; `packages/http/README.md` + `docs/api.md`; `packages/{kit,schema,cli,create-azeroth,testing,eslint-plugin,language-server,typescript-plugin,devtools,logger,cron,ws}/README.md`; `CONTRIBUTING.md`, `VERSIONING.md`, `CHANGELOG.md`. Every export is documented at its definition.
