// Vitest setup for the client suite. React Testing Library only auto-cleans when the test
// framework exposes a global `afterEach`, which `globals: true` in vite.config.ts provides -
// this file makes that dependency explicit rather than implicit.
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@azerothjs/testing';

// No spec may reach the network.
//
// happy-dom serves pages from `http://localhost:3000`, so a component that mounts and asks the
// typed client for anything resolves that origin and really tries to connect. Nothing is
// listening, so the suite printed a wall of ECONNREFUSED AggregateErrors on every run - noise
// loud enough that a reader stops reading it, attached to no test and failing nothing. The
// worse half is what happens when something IS listening on port 3000: a unit test quietly
// becomes an integration test against whatever that happens to be.
//
// So `fetch` is replaced rather than left to fail. A spec that wants an answer stubs it itself,
// which is the shape that says out loud what it expects back; a spec that did not mean to fetch
// gets a rejection naming the url instead of a stack that names nobody.
//
// Installed at MODULE scope, and that part is load-bearing. The request making the noise is the
// typed client fetching its route manifest at IMPORT time - once per spec file, while the file
// is still being loaded, before any hook has run. Installed in a `beforeEach` this stub is in
// place for everything EXCEPT the one call that was actually going out.
const offline = (input: RequestInfo | URL): Promise<Response> =>
{
    const url = typeof input === 'string'
        ? input
        : input instanceof URL ? input.href : input.url;

    return Promise.reject(new Error(
        `the test suite does not reach the network - ${ url } was requested. `
        + 'Stub `fetch` in the spec that needs it.'
    ));
};

globalThis.fetch = offline as typeof globalThis.fetch;

beforeEach(() =>
{
    // Restored for every test, so a spec that stubs `fetch` for its own purposes cannot leak
    // that stub into the next one.
    globalThis.fetch = offline as typeof globalThis.fetch;
});

afterEach(() =>
{
    vi.restoreAllMocks();
    cleanup();
});
