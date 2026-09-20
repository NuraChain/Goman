// The service worker: what makes Goman installable, and what keeps a dropped connection from
// replacing the page with the browser's error screen mid-session.
//
// Runtime-only by design. There is no precache manifest and no build step behind this file:
// Vite fingerprints everything it emits, so a URL under /assets/ never changes meaning and can
// be served from a cache forever, while a new build simply asks for new URLs. A generated
// precache list would be one more thing to keep in sync, and wrong the first time it drifted.
//
// What is NEVER cached is the API. Prices, positions and balances ARE the product, and a
// yesterday's price served instantly is worse than no price at all.

/** The empty client shell. A navigation is answered by the network - the public routes are
 *  rendered on the server now - and falls back to this only when there is no network. */
const ENTRY = '/index.html';

/** Bump either version to retire what it holds - that is the only way to evict a stale copy. */
const SHELL = 'goman-shell-v2';
const ASSETS = 'goman-assets-v1';

const KEEP = [SHELL, ASSETS];

/**
 * The shell's assets, DISCOVERED rather than declared: the entry document names its own
 * script and stylesheet, and both are fingerprinted, so reading them out of the HTML at
 * install time yields a precache that cannot drift from the build that produced it. This is
 * what makes the app work offline after ONE visit instead of two - a worker only starts
 * seeing requests once it has taken over, by which point the first load is long finished.
 */
async function warm(html) {
    const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((match) => match[1]);
    if (urls.length === 0) {
        return;
    }
    const cache = await caches.open(ASSETS);
    // One request per entry rather than cache.addAll, which rejects the WHOLE set if any
    // single fetch fails - a missing asset must not cost the visitor the entire worker.
    await Promise.all(urls.map((url) => cache.add(url).catch(() => undefined)));
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        (async () => {
            // `reload` skips the HTTP cache: an install that primes itself from a stale copy
            // of index.html would precache the PREVIOUS build's assets.
            const response = await fetch(ENTRY, { cache: 'reload' });
            const shell = await caches.open(SHELL);
            await shell.put(ENTRY, response.clone());
            await warm(await response.text());
        })()
    );
    // Without this a new worker waits for every tab to close, which on a trading app people
    // leave open is days. The caches it replaces are versioned, so taking over early is safe.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const names = await caches.keys();
            await Promise.all(names.filter((name) => !KEEP.includes(name)).map((name) => caches.delete(name)));
            await self.clients.claim();
        })()
    );
});

/**
 * The network decides; the cache is the safety net. Used for the document and for the
 * unfingerprinted files in public/ - a flag, a font, the icons - so replacing one of those
 * takes effect on the next online load rather than on the next cache version.
 */
async function networkFirst(request, cacheName, key) {
    const cache = await caches.open(cacheName);
    try {
        const response = await fetch(request);
        if (response.ok) {
            await cache.put(key, response.clone());
        }
        return response;
    } catch (error) {
        // `ignoreVary`: the warm-up fetch and the document's own request send different
        // Accept headers, and a response served with `Vary` would otherwise never be found
        // again by the request that needs it.
        const cached = await cache.match(key, { ignoreVary: true });
        if (cached !== undefined) {
            return cached;
        }
        throw error;
    }
}

/**
 * A navigation: the network answers, and the warmed shell is the offline fallback. Nothing is
 * written here - see the fetch handler for why a rendered page must not become the shell.
 */
async function navigation(request) {
    try {
        return await fetch(request);
    } catch (error) {
        const cached = await caches.open(SHELL).then((cache) => cache.match(ENTRY, { ignoreVary: true }));
        if (cached !== undefined) {
            return cached;
        }
        throw error;
    }
}

/** For fingerprinted builds only: the URL is the version, so a hit can never be stale. */
async function cacheFirst(request) {
    const cache = await caches.open(ASSETS);
    const cached = await cache.match(request, { ignoreVary: true });
    if (cached !== undefined) {
        return cached;
    }
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
    }
    return response;
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    // The API and the uploaded market art both answer for something that changes; neither
    // belongs in a cache this worker controls.
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
        return;
    }

    // Navigations are network-first, and the network's answer is now a RENDERED page rather
    // than one shared index.html - so the response is served but never cached. Caching it
    // would put one page's markup under the shell key and hand it to every other route
    // offline, where it would hydrate against the wrong URL.
    //
    // The cached shell stays what the install step warmed: the empty document, which boots
    // the client router and lets it render whatever route the visitor is on.
    if (request.mode === 'navigate') {
        event.respondWith(navigation(request));
        return;
    }

    if (url.pathname.startsWith('/assets/')) {
        event.respondWith(cacheFirst(request));
        return;
    }

    event.respondWith(networkFirst(request, ASSETS, request));
});
