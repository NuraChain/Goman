// Which security headers this process owns, and which belong to the edge.
//
// TLS terminates at nginx, so nginx is the only hop that knows the scheme the browser used
// and the only one entitled to declare a TLS policy. This app must not send a second
// Strict-Transport-Security alongside the one nginx stamps: RFC 6797 has the browser honour
// whichever header arrives first, which would leave the policy in force decided by header
// order. The rest of the hardening is this app's, and is pinned so turning HSTS off did not
// quietly take anything else with it.
import { describe, it, expect } from 'vitest';

import { buildApp } from '../src/app.ts';
import { IndexStore } from '../src/chain/store.ts';
import type { ChainGateway } from '../src/chain/client.ts';

const gateway: ChainGateway = {
    env: {
        rpcUrl: 'stub',
        chainId: 31337,
        factory: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        deployBlock: 0,
        dbPath: ':memory:',
        pollMs: 1000
    },
    hasAdminRole: async () => false,
    nativeBalance: async () => 0
};

const hardened = buildApp({
    dev: false,
    store: new IndexStore(':memory:'),
    chain: gateway,
    treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    hardened: true
});

const headers = async (): Promise<Record<string, unknown>> => {
    const response = await hardened.inject({ method: 'GET', url: '/api/healthz' });
    expect(response.statusCode).toBe(200);
    return response.headers;
};

describe('hardening', () => {
    it('leaves the TLS policy to nginx', async () => {
        expect(await headers()).not.toHaveProperty('strict-transport-security');
    });

    // Nothing here answers a cross-origin caller: the client is served from this same origin
    // and asks for relative /api paths. An Access-Control-* header would be the app claiming a
    // policy nginx owns, for traffic that does not exist.
    it('sends no CORS headers, because nothing is cross-origin', async () => {
        const sent = Object.keys(await headers());
        expect(sent.filter((name) => name.startsWith('access-control-'))).toEqual([]);
    });

    it('still sends the headers that ARE this app to send', async () => {
        const sent = await headers();
        expect(sent['x-content-type-options']).toBe('nosniff');
        expect(sent['x-frame-options']).toBe('SAMEORIGIN');
        expect(sent['referrer-policy']).toBe('no-referrer');
    });

    it('sends no security headers at all when not hardened', async () => {
        const bare = buildApp({
            dev: false,
            store: new IndexStore(':memory:'),
            chain: gateway,
            treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
        });
        const response = await bare.inject({ method: 'GET', url: '/api/healthz' });
        expect(response.headers).not.toHaveProperty('x-frame-options');
        await bare.close();
    });
});
