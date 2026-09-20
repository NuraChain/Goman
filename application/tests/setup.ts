// Vitest setup for the client suite. React Testing Library only auto-cleans when the test
// framework exposes a global `afterEach`, which `globals: true` in vite.config.ts provides -
// this file makes that dependency explicit rather than implicit.
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@azerothjs/testing';

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
    globalThis.fetch = offline as typeof globalThis.fetch;
});

afterEach(() =>
{
    vi.restoreAllMocks();
    cleanup();
});
