// Image uploads: what the bytes ARE decides the answer, never what the client claims. The
// route is admin-signed like every other write, and a rejected image must read as the
// caller's mistake (4xx), not as a server fault.
import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';

import { buildApp } from '../src/app.ts';
import { uploadMessage } from '../src/schemas.ts';
import { sniffImage, contentName, storeImage, MAX_IMAGE_BYTES, type Uploader } from '../src/uploads.ts';
import { IndexStore } from '../src/chain/store.ts';
import type { ChainGateway } from '../src/chain/client.ts';

const ADMIN = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const STRANGER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const SVG = new TextEncoder().encode('<svg onload="alert(1)"></svg>');

const gateway: ChainGateway = {
    env: {
        rpcUrl: 'stub',
        chainId: 31337,
        factory: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
        deployBlock: 0,
        dbPath: ':memory:',
        pollMs: 1000
    },
    hasAdminRole: async (account) => account.toLowerCase() === ADMIN.address.toLowerCase(),
    nativeBalance: async () => 0
};

const kept: Array<{ name: string; bytes: number }> = [];
const uploader: Uploader = {
    put: async (data, extension) => {
        const name = contentName(data, extension);
        kept.push({ name, bytes: data.length });
        return `/uploads/${name}`;
    }
};

const store = new IndexStore(':memory:');
store.ensureChain('0xgenesis');
const app = buildApp({
    dev: false,
    store,
    chain: gateway,
    treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    uploader
});

async function post(
    file: Uint8Array,
    signer = ADMIN,
    filename = 'art.png',
    at = new Date().toISOString()
): Promise<Response> {
    const body = new FormData();
    body.append('address', signer.address);
    body.append('issuedAt', at);
    body.append('signature', await signer.signMessage({ message: uploadMessage(at) }));
    body.append('file', new Blob([file as BufferSource]), filename);

    // FormData does the multipart encoding; Fastify is handed the encoded bytes and the
    // boundary header, because `inject` takes a payload rather than a fetch Request.
    const encoded = new Request('http://local/api/uploads', { method: 'POST', body });
    const injected = await app.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { 'content-type': encoded.headers.get('content-type') ?? '' },
        payload: Buffer.from(await encoded.arrayBuffer())
    });
    const bodiless = injected.statusCode === 204 || injected.statusCode === 304;
    return new Response(bodiless ? null : injected.body, { status: injected.statusCode });
}

describe('image uploads', () => {
    it('reads the format from the magic bytes, not the extension', () => {
        expect(sniffImage(PNG)).toEqual({ type: 'image/png', extension: 'png' });
        expect(sniffImage(JPEG)).toEqual({ type: 'image/jpeg', extension: 'jpg' });
        expect(sniffImage(WEBP)).toEqual({ type: 'image/webp', extension: 'webp' });
    });

    it('refuses SVG - it is a script-carrying document, and we would serve it same-origin', async () => {
        expect(sniffImage(SVG)).toBeNull();
        await expect(storeImage(uploader, SVG)).rejects.toThrow(/PNG, JPEG/);
    });

    it('content-addresses the bytes, so the same image uploads to the same name', () => {
        expect(contentName(PNG, 'png')).toBe(contentName(new Uint8Array(PNG), 'png'));
        expect(contentName(PNG, 'png')).not.toBe(contentName(JPEG, 'jpg'));
    });

    it('rejects an empty file and one over the cap', async () => {
        await expect(storeImage(uploader, new Uint8Array(0))).rejects.toThrow(/empty/);
        const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
        huge.set(PNG.slice(0, 8));
        await expect(storeImage(uploader, huge)).rejects.toThrow(/2 MiB/);
    });

    it('stores an admin-signed PNG and answers with its URI', async () => {
        const response = await post(PNG);
        expect(response.status).toBe(200);
        const saved = (await response.json()) as { uri: string; type: string; bytes: number };
        expect(saved.type).toBe('image/png');
        expect(saved.bytes).toBe(PNG.length);
        expect(saved.uri).toBe(`/uploads/${contentName(PNG, 'png')}`);
        expect(kept.some((entry) => entry.name === contentName(PNG, 'png'))).toBe(true);
    });

    it('refuses an upload signed by a non-admin', async () => {
        expect((await post(PNG, STRANGER)).status).toBe(403);
    });

    it('refuses a stale signature', async () => {
        const old = new Date(Date.now() - 30 * 60_000).toISOString();
        expect((await post(PNG, ADMIN, 'art.png', old)).status).toBe(400);
    });

    it('answers 4xx - not 500 - for a file that is not an image we accept', async () => {
        const response = await post(SVG, ADMIN, 'art.png');
        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.status).toBeLessThan(500);
    });

    it('a PNG renamed .jpg is stored by what it IS', async () => {
        const response = await post(PNG, ADMIN, 'trust-me.jpg');
        const saved = (await response.json()) as { uri: string; type: string };
        expect(saved.type).toBe('image/png');
        expect(saved.uri.endsWith('.png')).toBe(true);
    });
});
