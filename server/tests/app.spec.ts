// The API over a seeded in-memory index and a stubbed chain gateway: envelopes, filters,
// portfolio math, the signed admin feature toggle. What the browser client actually gets.
import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';

import { buildApp } from '../src/app.ts';
import { createAdminSession } from '../src/admin-session.ts';
import {
    campaignMessage,
    categoryDeleteMessage,
    categoryMessage,
    creatorMessage,
    creatorRemoveMessage,
    proposalMessage,
    proposalDecideMessage,
    proposalTitle,
    featureMessage,
    marketEditMessage,
    marketRevertMessage,
    joinMessage,
    sessionMessage,
    type AdminMarketPage,
    type CategoryCount,
    type CreatorAccess,
    type MarketCreator,
    type Proposal,
    type ProposalResult,
    type Market,
    type MarketPage,
    type PortfolioSummary,
    type Position,
    type ReferralCampaign,
    type ReferralDashboard
} from '../src/wire.ts';
import { IndexStore } from '../src/chain/store.ts';
import { marketTags, seedTags } from '../src/derive.ts';
import type { ChainGateway } from '../src/chain/client.ts';

/** The factory a fixture index is built from; the store starts over when it changes. */
const FACTORY = '0xfac70aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const ADMIN = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const STRANGER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

/** Two more wallets, used to build a two-tier referral chain: ADMIN -> REFERRED -> FRIEND. */
const REFERRED = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const FRIEND = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');

function seededStore(): IndexStore
{
    const store = new IndexStore(':memory:');
    store.ensureChain('0xgenesis', FACTORY);
    const now = Math.floor(Date.now() / 1000);

    store.insertMarket(
        {
            id: 0,
            address: '0x0000000000000000000000000000000000000010',
            status: 0,
            category: 'crypto',
            title_json: JSON.stringify({ en: 'Bitcoin above $150k?', fa: 'بیت‌کوین بالای ۱۵۰ هزار؟' }),
            emoji: '₿',
            rules_json: JSON.stringify({ en: 'Resolves on the CoinGecko close.', fa: 'بر اساس قیمت کوین‌گکو.' }),
            image: '',
            creator: '0xcafe',
            created_at: now - 4000,
            lock_time: now + 4000,
            resolve_time: now + 8000,
            outcome_count: 2,
            volume: 0,
            liquidity: 100,
            collected: 0,
            winning_outcome: null,
            featured: 1,
            search_text: 'bitcoin above 150k بیت‌کوین yes no crypto',
            kind: 0
        },
        [
            {
                market_id: 0,
                idx: 0,
                oid: 'yes',
                label_json: JSON.stringify({ en: 'Yes', fa: 'بله' }),
                icon: '',
                price: 0.6
            },
            {
                market_id: 0,
                idx: 1,
                oid: 'no',
                label_json: JSON.stringify({ en: 'No', fa: 'خیر' }),
                icon: '',
                price: 0.4
            }
        ]
    );

    store.insertMarket(
        {
            id: 1,
            address: '0x0000000000000000000000000000000000000011',
            status: 3,
            category: 'iran-football',
            title_json: JSON.stringify({ en: 'Winner of the derby?', fa: 'برنده دربی؟' }),
            emoji: '⚽',
            rules_json: JSON.stringify({ en: 'The Tehran derby result.', fa: 'نتیجه دربی تهران.' }),
            image: '',
            creator: '0xcafe',
            created_at: now - 2000,
            lock_time: now - 1000,
            resolve_time: now - 500,
            outcome_count: 3,
            volume: 0,
            liquidity: 40,
            collected: 0.5,
            winning_outcome: 0,
            featured: 0,
            search_text: 'winner of the derby دربی esteghlal persepolis draw iran-football',
            kind: 0
        },
        [
            {
                market_id: 1,
                idx: 0,
                oid: 'esteghlal',
                label_json: JSON.stringify({ en: 'Esteghlal', fa: 'استقلال' }),
                icon: '',
                price: 1
            },
            {
                market_id: 1,
                idx: 1,
                oid: 'persepolis',
                label_json: JSON.stringify({ en: 'Persepolis', fa: 'پرسپولیس' }),
                icon: '',
                price: 0
            },
            {
                market_id: 1,
                idx: 2,
                oid: 'draw',
                label_json: JSON.stringify({ en: 'Draw', fa: 'مساوی' }),
                icon: '',
                price: 0
            }
        ]
    );

    const trader = ADMIN.address.toLowerCase();
    store.insertTrade({
        id: 't1',
        market_id: 0,
        account: trader,
        outcome_idx: 0,
        action: 'buy',
        amount: 25,
        shares: 44,
        price: 25 / 44,
        fee: 0,
        at: now - 3000,
        block: 5
    });
    store.applyBalanceDelta(trader, 0, '0', 44, now - 3000);
    store.setPrices(0, [0.6, 0.4], 124.75, now - 3000);
    store.insertTrade({
        id: 't2',
        market_id: 1,
        account: trader,
        outcome_idx: 0,
        action: 'buy',
        amount: 10,
        shares: 20,
        price: 0.5,
        fee: 0,
        at: now - 1800,
        block: 7
    });
    store.applyBalanceDelta(trader, 1, '0', 20, now - 1800);
    store.insertClaim('c1', 1, trader, 20, now - 400);
    store.applyBalanceDelta(trader, 1, '0', -20, now - 400);

    // Filed as the indexer files them: from the envelope, plus the pre-registry category
    // word. Both markets are ABOUT more than one thing, which is the point of tags.
    store.setMarketTags(0, marketTags(seedTags(['Bitcoin', 'Price'], 'crypto')));
    store.setMarketTags(1, marketTags(seedTags(['Football', 'Iran', 'Derby'], 'iran-football')));
    return store;
}

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
    nativeBalance: async () => 9974.5
};

const store = seededStore();
store.setCursor(42);
// The admin surface is behind a session, so the suite builds one exactly as production
// does: the wallet signs a nonce, the chain confirms the role. Reading the console with no
// cookie is a 401, which is what the guard exists to make true.
const adminSession = createAdminSession({
    secureCookie: false,
    async verify(address, message, signature)
    {
        const signed = await verifyMessage({
            address: address as `0x${ string }`,
            message,
            signature: signature as `0x${ string }`
        }).catch(() => false);
        return signed ? gateway.hasAdminRole(address as `0x${ string }`) : false;
    }
});

const { app } = buildApp({
    dev: false,
    store,
    chain: gateway,
    treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    adminSession
});

// `app.handle` IS the integration story: a web-standard Request in, a real Response out. The
// shim that used to rebuild Fastify's light-my-request result into a Response is gone, and
// every assertion below still reads `.status`, `.json()` and `.headers.get(..)` unchanged.
const send = (path: string, init: RequestInit = {}): Promise<Response> =>
    app.handle(new Request(`http://local${ path }`, init));

const get = (path: string, cookie?: string): Promise<Response> =>
    send(path, { headers: cookie === undefined ? {} : { cookie } });

const post = (path: string, body: object, cookie?: string): Promise<Response> =>
    send(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie === undefined ? {} : { cookie }) },
        body: JSON.stringify(body)
    });

const request = (path: string, method: 'DELETE' | 'POST', body: object): Promise<Response> =>
    send(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** Opens a real admin session and returns the Cookie header to replay. */
async function signIn(account = ADMIN): Promise<string>
{
    const issuedAt = new Date().toISOString();
    const response = await post('/api/admin/session', {
        address: account.address,
        issuedAt,
        signature: await account.signMessage({ message: sessionMessage(issuedAt) })
    });
    expect(response.status).toBe(204);
    const setCookie = response.headers.get('set-cookie') ?? '';
    return setCookie.split(';')[0] ?? '';
}

describe('auctionhouse api over the index', () =>
{
    it('answers the health probe with the cursor', async () =>
    {
        const response = await get('/api/healthz');
        expect(response.status).toBe(200);
        expect(((await response.json()) as { lastBlock: number }).lastBlock).toBe(42);
    });

    it('lists markets in a paged envelope, bilingual, binary-collapsed', async () =>
    {
        const response = await get('/api/markets');
        const page = (await response.json()) as MarketPage;
        // One of the two seeded markets is resolved, and a default listing is of markets that
        // can still be traded - see the ended-markets suite below.
        expect(page.total).toBe(1);
        expect(page.pages).toBe(1);
        const btc = page.rows.find((row) => row.id === '0');
        expect(btc?.title.fa).toContain('بیت‌کوین');
        expect(btc?.outcomes.length).toBe(1);
        expect(btc?.outcomes[0]?.id).toBe('yes');
        expect(btc?.noIndex).toBe(1);
        expect(btc?.featured).toBe(true);
    });

    describe('tags', () =>
    {
        const ids = async (path: string): Promise<string[]> =>
            ((await (await get(path)).json()) as MarketPage).rows.map((row) => row.id);

        it('reports a market with its tags, slug and name both', async () =>
        {
            const btc = (await (await get('/api/markets/0')).json()) as Market;
            expect(btc.tags).toEqual([
                { slug: 'bitcoin', name: 'Bitcoin' },
                { slug: 'crypto', name: 'crypto' },
                { slug: 'price', name: 'Price' }
            ]);
        });

        it('filters a listing by one tag', async () =>
        {
            expect(await ids('/api/markets?tags=bitcoin')).toEqual(['0']);
            // A tag filter is the caller asking for those rows BY NAME, so a market whose
            // trading is over is not hidden from it the way it is from a plain listing.
            expect(await ids('/api/markets?tags=derby')).toEqual(['1']);
        });

        it('normalises a written tag in the query string', async () =>
        {
            expect(await ids('/api/markets?tags=Iran%20Football')).toEqual(['1']);
        });

        it('takes either tag by default and both under tagMode=all', async () =>
        {
            expect([...(await ids('/api/markets?tags=bitcoin,derby'))].sort()).toEqual(['0', '1']);
            expect(await ids('/api/markets?tags=bitcoin,derby&tagMode=all')).toEqual([]);
            expect(await ids('/api/markets?tags=football,derby&tagMode=all')).toEqual(['1']);
            expect((await get('/api/markets?tags=x&tagMode=maybe')).status).toBe(422);
        });

        it('finds a market by a tag its title never mentions', async () =>
        {
            // `derby` IS in this market's title, so the probe is `football`, which is not -
            // it reaches the market only through the tag folded into the haystack.
            expect(await ids('/api/markets?search=football')).toEqual(['1']);
        });

        it('completes a tag prefix, most-used first', async () =>
        {
            const found = (await (await get('/api/tags?q=ir')).json()) as Array<{ slug: string; count: number }>;
            expect(found.map((tag) => tag.slug)).toEqual(['iran', 'iran-football']);
            expect(found[0].count).toBe(1);
        });

        it('lists the whole vocabulary when nothing is typed, and nothing for a dead prefix', async () =>
        {
            const all = (await (await get('/api/tags')).json()) as Array<{ slug: string }>;
            expect(all.map((tag) => tag.slug)).toContain('bitcoin');
            expect(await (await get('/api/tags?q=zzzz')).json()).toEqual([]);
        });
    });

    it('searches Persian text and filters custom categories server-side', async () =>
    {
        const search = (await (await get('/api/markets?search=%D8%AF%D8%B1%D8%A8%DB%8C')).json()) as MarketPage;
        expect(search.rows.map((row) => row.id)).toEqual(['1']);
        // Browsing a category is a listing like any other, so the resolved market in it is
        // not shown until the caller asks for that status by name.
        const category = (await (await get('/api/markets?category=iran-football')).json()) as MarketPage;
        expect(category.total).toBe(0);
        const settled = (await (await get('/api/markets?category=iran-football&status=resolved')).json()) as MarketPage;
        expect(settled.total).toBe(1);
        expect((await get('/api/markets?status=bogus')).status).toBe(422);
    });

    it('serves one market, resolved metadata included, and 404s unknowns', async () =>
    {
        const market = (await (await get('/api/markets/1')).json()) as Market;
        expect(market.status).toBe('resolved');
        expect(market.winningOutcomeId).toBe('esteghlal');
        expect(market.noIndex).toBeNull();
        expect((await get('/api/markets/99')).status).toBe(404);
    });

    it('serves a series pinned to the live price and rejects bad ranges', async () =>
    {
        const response = await get('/api/markets/0/series?outcome=yes&range=1w');
        const series = (await response.json()) as { points: Array<{ p: number }> };
        expect(series.points.length).toBe(40);
        expect(series.points[series.points.length - 1]?.p).toBeCloseTo(0.6, 5);
        expect((await get('/api/markets/0/series?outcome=yes&range=1y')).status).toBe(422);
    });

    it('lists categories with counts, custom ones included', async () =>
    {
        const rows = (await (await get('/api/categories')).json()) as Array<{
            id: string;
            count: number;
            retired: boolean;
        }>;
        expect(rows.find((row) => row.id === 'iran-football')).toMatchObject({ count: 1, retired: false });
    });

    it('a category registered before its first market still lists, at count 0', async () =>
    {
        // The whole reason categories became a table: derived purely from markets, a new
        // category could not exist until an entire market-creation transaction had landed.
        const issuedAt = new Date().toISOString();
        const response = await post('/api/categories', {
            id: 'Esports',
            label: { en: 'Esports', fa: 'ورزش الکترونیک', tr: 'Espor' },
            sortOrder: 5,
            retired: false,
            address: ADMIN.address,
            issuedAt,
            signature: await ADMIN.signMessage({ message: categoryMessage('esports', issuedAt) })
        });
        expect(response.status).toBe(200);
        // The id is normalized, because it must match the lower-cased string markets carry.
        expect(((await response.json()) as { id: string }).id).toBe('esports');

        const rows = (await (await get('/api/categories')).json()) as Array<{
            id: string;
            count: number;
            label: { en: string; fa?: string; tr?: string };
        }>;
        expect(rows.find((row) => row.id === 'esports')).toMatchObject({
            count: 0,
            label: { en: 'Esports', fa: 'ورزش الکترونیک', tr: 'Espor' }
        });
    });

    it('deletes a category row without touching the markets that carry its id', async () =>
    {
        const issuedAt = new Date().toISOString();
        const del = async (id: string, signer: typeof ADMIN): Promise<Response> =>
            request('/api/categories/remove', 'POST', {
                id,
                address: signer.address,
                issuedAt,
                signature: await signer.signMessage({ message: categoryDeleteMessage(id, issuedAt) })
            });

        // An edit signature must not double as a delete signature.
        const replayed = await request('/api/categories/remove', 'POST', {
            id: 'esports',
            address: ADMIN.address,
            issuedAt,
            signature: await ADMIN.signMessage({ message: categoryMessage('esports', issuedAt) })
        });
        expect(replayed.status).toBe(403);

        expect((await del('esports', STRANGER)).status).toBe(403);
        expect((await del('esports', ADMIN)).status).toBe(200);

        const rows = (await (await get('/api/categories')).json()) as Array<{ id: string; label: { en: string } }>;
        expect(rows.find((row) => row.id === 'esports')).toBeUndefined();

        // 'crypto' is carried on-chain by a seeded market, so deleting its presentation row
        // leaves the category itself listing - under its raw id.
        expect((await del('crypto', ADMIN)).status).toBe(200);
        const after = (await (await get('/api/categories')).json()) as Array<{ id: string; label: { en: string } }>;
        expect(after.find((row) => row.id === 'crypto')?.label.en).toBe('crypto');
    });

    it('refuses a category edit signed by a non-admin', async () =>
    {
        const issuedAt = new Date().toISOString();
        const response = await post('/api/categories', {
            id: 'crypto',
            label: { en: 'Hijacked' },
            sortOrder: 0,
            retired: false,
            address: STRANGER.address,
            issuedAt,
            signature: await STRANGER.signMessage({ message: categoryMessage('crypto', issuedAt) })
        });
        expect(response.status).toBe(403);
    });

    it('exposes the chain config the frontend boots from', async () =>
    {
        const config = (await (await get('/api/chain')).json()) as { factory: string; lastBlock: number };
        expect(config.factory).toBe(gateway.env.factory);
        expect(config.lastBlock).toBe(42);
    });

    it('portfolio positions embed their market and flag claimables', async () =>
    {
        const rows = (await (await get(`/api/portfolio/positions?address=${ ADMIN.address }`)).json()) as Position[];
        expect(rows.length).toBe(1);
        expect(rows[0].market.title.en).toContain('Bitcoin');
        expect(rows[0].side).toBe('yes');
        expect(rows[0].avgPrice).toBeCloseTo(25 / 44, 5);
        expect(rows[0].claimable).toBe(false);
    });

    it('stops offering a claim once the account has redeemed, by any route', async () =>
    {
        // Its own index: the claim below would move every profit figure this suite pins.
        const voided = seededStore();
        const { app: voidedApp } = buildApp({
            dev: false,
            store: voided,
            chain: gateway,
            treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
        });
        const read = async <T>(path: string): Promise<T> =>
            (await (await voidedApp.handle(new Request(`http://local${ path }`))).json()) as T;
        const positions = `/api/portfolio/positions?address=${ ADMIN.address }`;

        // A voided redeem refunds the deposit and leaves the shares where they were.
        voided.setStatus(0, 4, null);
        expect((await read<Position[]>(positions))[0]?.claimable).toBe(true);

        voided.insertClaim('c2', 0, ADMIN.address.toLowerCase(), 25, Math.floor(Date.now() / 1000));
        expect((await read<Position[]>(positions))[0]?.claimable).toBe(false);

        // Market 1's winning shares were burned by its redeem; only the claim remembers it.
        expect(await read<string[]>(`/api/portfolio/claimed?address=${ ADMIN.address }`)).toEqual(['1', '0']);

        // Winning shares sent in AFTER that redeem are still owed - a resolved redeem is not
        // one-shot, it pays whatever is held.
        voided.applyBalanceDelta(ADMIN.address.toLowerCase(), 1, '0', 5, Math.floor(Date.now() / 1000));
        const resolved = (await read<Position[]>(positions)).find((row) => row.marketId === '1');
        expect(resolved?.claimable).toBe(true);
        expect(await read<string[]>(`/api/portfolio/claimed?address=${ STRANGER.address }`)).toEqual([]);
    });

    it('portfolio summary carries real balance and lifetime profit', async () =>
    {
        const summary = (await (await get(`/api/portfolio?address=${ ADMIN.address }`)).json()) as PortfolioSummary;
        expect(summary.balance).toBe(9974.5);

        // Spent 35, claimed 20, holds 44 shares at 0.6: profit = -35 + 20 + 26.4.
        expect(summary.profit).toBeCloseTo(11.4, 1);
        expect(summary.invested).toBeCloseTo(25, 5);
    });

    it('ranks the leaderboard from real flows', async () =>
    {
        const rows = (await (await get('/api/leaderboard?period=all')).json()) as Array<{
            address: string;
            profit: number;
        }>;
        expect(rows[0]?.address).toBe(ADMIN.address.toLowerCase());
        expect(rows[0]?.profit).toBeCloseTo(11.4, 1);
    });

    it('admin stats aggregate the whole index, for a signed-in admin', async () =>
    {
        const cookie = await signIn();
        const stats = (await (await get('/api/admin/stats', cookie)).json()) as {
            markets: number;
            resolved: number;
            tvl: number;
        };
        expect(stats.markets).toBe(2);
        expect(stats.resolved).toBe(1);
        expect(stats.tvl).toBeCloseTo(164.75, 2);
    });

    it('EVERY admin route refuses an anonymous caller - the guard is on the feature', async () =>
    {
        // The console's reads used to be open: /admin/stats returned fees, TVL and trader
        // counts to anyone who asked. They are guarded now because of the feature they
        // land in, so a route added later inherits the refusal instead of needing a line.
        for (const path of [
            '/api/admin/stats',
            '/api/admin/activity',
            '/api/admin/markets',
            '/api/admin/markets/0/edit'
        ])
        {
            expect((await get(path)).status, `${ path } must refuse an anonymous caller`).toBe(401);
        }
        const toggle = await post('/api/admin/feature', {
            marketId: '1',
            featured: true,
            address: ADMIN.address,
            issuedAt: new Date().toISOString(),
            signature: '0xdead'
        });
        expect(toggle.status).toBe(401);
    });

    it('refuses a session to a stranger, and to a bad signature from a real admin', async () =>
    {
        const issuedAt = new Date().toISOString();
        const stranger = await post('/api/admin/session', {
            address: STRANGER.address,
            issuedAt,
            signature: await STRANGER.signMessage({ message: sessionMessage(issuedAt) })
        });
        expect(stranger.status).toBe(401);

        const forged = await post('/api/admin/session', { address: ADMIN.address, issuedAt, signature: '0xdead' });
        expect(forged.status).toBe(401);
    });

    it('signing out ends the session it was issued for', async () =>
    {
        const cookie = await signIn();
        expect((await get('/api/admin/stats', cookie)).status).toBe(200);

        const out = await send('/api/admin/session', { method: 'DELETE', headers: { cookie } });
        expect(out.status).toBe(204);
        expect((await get('/api/admin/stats', cookie)).status).toBe(401);
    });

    describe('editing a market that is already deployed', () =>
    {
        /** The whole text, with `patch` applied - what the dialog submits. */
        const body = async (patch: Record<string, unknown>, account = ADMIN) =>
        {
            const issuedAt = new Date().toISOString();
            return {
                marketId: '0',
                title: { en: 'Bitcoin above $150k?', fa: 'بیت‌کوین بالای ۱۵۰ هزار؟' },
                emoji: '₿',
                rules: { en: 'Resolves on the CoinGecko close.', fa: 'بر اساس قیمت کوین‌گکو.' },
                image: '',
                category: 'crypto',
                tags: ['bitcoin', 'crypto'],
                outcomes: [
                    { label: { en: 'Yes', fa: 'بله' }, icon: '' },
                    { label: { en: 'No', fa: 'خیر' }, icon: '' }
                ],
                ...patch,
                address: account.address,
                issuedAt,
                signature: await account.signMessage({ message: marketEditMessage('0', issuedAt) })
            };
        };

        it('rewrites what the site serves and leaves the chain alone', async () =>
        {
            const cookie = await signIn();
            const saved = await post(
                '/api/admin/market',
                await body({ title: { en: 'Bitcoin above $150,000?' } }),
                cookie
            );
            expect(saved.status).toBe(200);
            expect(((await saved.json()) as { edited: boolean }).edited).toBe(true);

            const market = (await (await get('/api/markets/0')).json()) as Market;
            expect(market.title.en).toBe('Bitcoin above $150,000?');

            const state = (await (await get('/api/admin/markets/0/edit', cookie)).json()) as {
                origin: { title: { en: string } };
            };
            expect(state.origin.title.en).toBe('Bitcoin above $150k?');
        });

        it('puts the on-chain text back', async () =>
        {
            const cookie = await signIn();
            await post('/api/admin/market', await body({ image: 'https://cdn.example/new.png' }), cookie);

            const issuedAt = new Date().toISOString();
            const reverted = await post(
                '/api/admin/market/revert',
                {
                    marketId: '0',
                    address: ADMIN.address,
                    issuedAt,
                    signature: await ADMIN.signMessage({ message: marketRevertMessage('0', issuedAt) })
                },
                cookie
            );
            expect(reverted.status).toBe(200);
            expect(store.marketById(0)?.image).toBe('');
        });

        // Renaming the legs of a Yes/No market flips the whole trading UI under people who
        // already hold positions in it.
        it('refuses a rename that would stop a market reading as Yes/No', async () =>
        {
            const cookie = await signIn();
            const response = await post(
                '/api/admin/market',
                await body({
                    outcomes: [
                        { label: { en: 'Definitely' }, icon: '' },
                        { label: { en: 'No' }, icon: '' }
                    ]
                }),
                cookie
            );
            expect(response.status).toBe(409);
        });

        it('refuses an outcome list that is not the market width', async () =>
        {
            const cookie = await signIn();
            const response = await post(
                '/api/admin/market',
                await body({
                    outcomes: [
                        { label: { en: 'Yes' }, icon: '' },
                        { label: { en: 'No' }, icon: '' },
                        { label: { en: 'Maybe' }, icon: '' }
                    ]
                }),
                cookie
            );
            expect(response.status).toBe(400);
        });

        it('refuses a signature from a wallet that is not an admin', async () =>
        {
            const cookie = await signIn();
            const response = await post(
                '/api/admin/market',
                await body({ title: { en: 'Hijacked' } }, STRANGER),
                cookie
            );
            expect(response.status).toBe(403);
            expect(store.marketById(0)?.title_json).not.toContain('Hijacked');
        });

        it('will not accept an edit signature as a revert', async () =>
        {
            const cookie = await signIn();
            const issuedAt = new Date().toISOString();
            const response = await post(
                '/api/admin/market/revert',
                {
                    marketId: '0',
                    address: ADMIN.address,
                    issuedAt,
                    signature: await ADMIN.signMessage({ message: marketEditMessage('0', issuedAt) })
                },
                cookie
            );
            expect(response.status).toBe(403);
        });
    });

    it('feature toggle demands a fresh signature from a real admin', async () =>
    {
        const issuedAt = new Date().toISOString();
        const message = featureMessage('1', true, issuedAt);

        const cookie = await signIn();
        const signed = await post(
            '/api/admin/feature',
            {
                marketId: '1',
                featured: true,
                address: ADMIN.address,
                issuedAt,
                signature: await ADMIN.signMessage({ message })
            },
            cookie
        );
        expect(signed.status).toBe(200);
        expect(store.marketById(1)?.featured).toBe(1);

        const stranger = await post(
            '/api/admin/feature',
            {
                marketId: '1',
                featured: false,
                address: STRANGER.address,
                issuedAt,
                signature: await STRANGER.signMessage({ message: featureMessage('1', false, issuedAt) })
            },
            cookie
        );
        expect(stranger.status).toBe(403);

        const stale = new Date(Date.now() - 10 * 60_000).toISOString();
        const old = await post(
            '/api/admin/feature',
            {
                marketId: '1',
                featured: false,
                address: ADMIN.address,
                issuedAt: stale,
                signature: await ADMIN.signMessage({ message: featureMessage('1', false, stale) })
            },
            cookie
        );
        expect(old.status).toBe(400);

        const forged = await post(
            '/api/admin/feature',
            {
                marketId: '1',
                featured: false,
                address: ADMIN.address,
                issuedAt,
                signature: await STRANGER.signMessage({ message: featureMessage('1', false, issuedAt) })
            },
            cookie
        );
        expect(forged.status).toBe(403);
    });

    it('404s cleanly outside /api when no client is mounted', async () =>
    {
        expect((await get('/nope')).status).toBe(404);
    });
});

// Activity and holders page on the SERVER. Both used to answer with a fixed slice and no
// total: a market's trade tail past 40 was unreachable, and the holders cap of 8 sat BELOW
// the client's page size, so that list could never report more than one page and its
// pagination control was unreachable markup. These pin the window and the count.
describe('market activity + holders paging', () =>
{
    const paged = new IndexStore(':memory:');
    paged.ensureChain('0xgenesis', FACTORY);
    const at = Math.floor(Date.now() / 1000);

    paged.insertMarket(
        {
            id: 0,
            address: '0x0000000000000000000000000000000000000020',
            status: 0,
            category: 'crypto',
            title_json: JSON.stringify({ en: 'Busy market', fa: 'بازار شلوغ' }),
            emoji: '🔥',
            rules_json: JSON.stringify({ en: 'Rules.', fa: 'قواعد.' }),
            image: '',
            creator: '0xcafe',
            created_at: at - 9000,
            lock_time: at + 9000,
            resolve_time: at + 9500,
            outcome_count: 2,
            volume: 0,
            liquidity: 100,
            collected: 0,
            winning_outcome: null,
            featured: 0,
            search_text: 'busy market',
            kind: 0
        },
        [
            {
                market_id: 0,
                idx: 0,
                oid: 'yes',
                label_json: JSON.stringify({ en: 'Yes', fa: 'بله' }),
                icon: '',
                price: 0.5
            },
            {
                market_id: 0,
                idx: 1,
                oid: 'no',
                label_json: JSON.stringify({ en: 'No', fa: 'خیر' }),
                icon: '',
                price: 0.5
            }
        ]
    );

    // 25 trades from 12 distinct holders: more than two pages of each at the default window.
    for (let index = 0; index < 25; index++)
    {
        const account = `0x${ String(index % 12).padStart(40, '0') }`;
        paged.insertTrade({
            id: `p${ index }`,
            market_id: 0,
            account,
            outcome_idx: 0,
            action: 'buy',
            amount: 1,
            shares: index + 1,
            price: 0.5,
            fee: 0,
            at: at - (100 - index),
            block: index + 1
        });
        paged.applyBalanceDelta(account, 0, '0', index + 1, at - (100 - index));
    }

    const { app: pagedApp } = buildApp({
        dev: false,
        store: paged,
        chain: gateway,
        treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
    });
    const fetchPage = (path: string): Promise<Response> =>
        pagedApp.handle(new Request(`http://local${ path }`));

    it('reports the whole trade count and walks the tail past the old fixed slice', async () =>
    {
        const first = await fetchPage('/api/markets/0/activity?page=1&limit=10');
        const firstPage = (await first.json()) as { rows: unknown[]; total: number; page: number; pages: number };
        expect(firstPage.total).toBe(25);
        expect(firstPage.pages).toBe(3);
        expect(firstPage.page).toBe(1);
        expect(firstPage.rows).toHaveLength(10);

        const last = await fetchPage('/api/markets/0/activity?page=3&limit=10');
        const lastPage = (await last.json()) as { rows: { id: string }[]; page: number };
        expect(lastPage.page).toBe(3);
        expect(lastPage.rows).toHaveLength(5);

        // Every id is distinct across pages - the window moves, it does not re-serve page 1.
        const ids = new Set([...(firstPage.rows as { id: string }[]), ...lastPage.rows].map((row) => row.id));
        expect(ids.size).toBe(15);
    });

    it('pages holders past one page, which the old 8-row cap made impossible', async () =>
    {
        const response = await fetchPage('/api/markets/0/holders?page=1&limit=10');
        const page = (await response.json()) as { rows: unknown[]; total: number; pages: number };
        expect(page.total).toBe(12);
        expect(page.pages).toBe(2);
        expect(page.rows).toHaveLength(10);

        const second = await fetchPage('/api/markets/0/holders?page=2&limit=10');
        expect(((await second.json()) as { rows: unknown[] }).rows).toHaveLength(2);
    });

    it('defaults to the first page when no window is given', async () =>
    {
        const page = (await (await fetchPage('/api/markets/0/activity')).json()) as { page: number; rows: unknown[] };
        expect(page.page).toBe(1);
        expect(page.rows).toHaveLength(10);
    });
});

// ----------------------------------------------------------------------------------------
// Ended markets
//
// A market whose trading is over leaves the default listing but stays reachable by every
// route that asked for it by name. The status is flipped and restored around the assertions
// so the rest of the suite still sees the seed it was written against.
// ----------------------------------------------------------------------------------------

describe('markets whose trading is over', () =>
{
    async function listing(path: string, cookie?: string): Promise<string[]>
    {
        const page = (await (await get(path, cookie)).json()) as { rows: Array<{ id: string }> };
        return page.rows.map((row) => row.id);
    }

    it('leaves the default listing but stays findable', async () =>
    {
        const before = ((await (await get('/api/markets')).json()) as MarketPage).total;
        const cookie = await signIn();

        // 3 = resolved. Market 0 is the Bitcoin market the rest of the suite reads.
        store.setStatus(0, 3, 0);
        try
        {
            const page = (await (await get('/api/markets')).json()) as MarketPage;
            expect(page.total).toBe(before - 1);
            expect(page.rows.map((row) => row.id)).not.toContain('0');

            // Searched for by name, asked for by status, asked for by id, and the console -
            // every caller that named it still gets it.
            expect(await listing('/api/markets?search=bitcoin')).toContain('0');
            expect(await listing('/api/markets?status=resolved')).toContain('0');
            expect(await listing('/api/markets?ids=0')).toContain('0');
            expect(await listing('/api/admin/markets', cookie)).toContain('0');

            // The market's own page never depended on the listing rule.
            expect((await get('/api/markets/0')).status).toBe(200);
        }
        finally
        {
            store.setStatus(0, 0, null);
        }
    });

    it('keeps a paused market listed - trading is suspended, not over', async () =>
    {
        store.setStatus(0, 1, null);
        try
        {
            expect(await listing('/api/markets')).toContain('0');
        }
        finally
        {
            store.setStatus(0, 0, null);
        }
    });
});
// ----------------------------------------------------------------------------------------
// Referrals
//
// The signed half of the program, end to end: a campaign nobody can forge, an attribution
// that binds once, and earnings that come out of fees the treasury actually received. The
// arithmetic itself is pinned separately in referrals.spec.ts.
// ----------------------------------------------------------------------------------------

type Signer = typeof ADMIN;

async function createCampaign(account: Signer, name: string): Promise<ReferralCampaign>
{
    const issuedAt = new Date().toISOString();
    const response = await post('/api/referrals/campaigns', {
        name,
        address: account.address,
        issuedAt,
        signature: await account.signMessage({ message: campaignMessage(name, issuedAt) })
    });
    expect(response.status).toBe(200);
    return (await response.json()) as ReferralCampaign;
}

async function joinWith(account: Signer, code: string): Promise<Response>
{
    const issuedAt = new Date().toISOString();
    return post('/api/referrals/join', {
        code,
        address: account.address,
        issuedAt,
        signature: await account.signMessage({ message: joinMessage(code, issuedAt) })
    });
}

async function dashboardOf(account: Signer, period = 'all'): Promise<ReferralDashboard>
{
    const response = await get(`/api/referrals?address=${ account.address }&period=${ period }`);
    expect(response.status).toBe(200);
    return (await response.json()) as ReferralDashboard;
}

describe('referrals', () =>
{
    it('refuses a campaign signed by somebody else', async () =>
    {
        const issuedAt = new Date().toISOString();
        const forged = await post('/api/referrals/campaigns', {
            name: 'Forged',
            address: ADMIN.address,
            issuedAt,
            signature: await STRANGER.signMessage({ message: campaignMessage('Forged', issuedAt) })
        });
        expect(forged.status).toBe(403);
    });

    it('creates a campaign with a shareable code and reports it on the dashboard', async () =>
    {
        const campaign = await createCampaign(ADMIN, 'Twitter Push');
        expect(campaign.code).toBe('twitter-push');

        const invite = await get('/api/referrals/invite/twitter-push');
        expect(invite.status).toBe(200);
        expect(((await invite.json()) as { owner: string }).owner).toBe(ADMIN.address.toLowerCase());

        const page = await dashboardOf(ADMIN);
        expect(page.campaigns.map((row) => row.code)).toContain('twitter-push');
    });

    it('answers an unknown code with a 404 rather than a silent no-op', async () =>
    {
        expect((await get('/api/referrals/invite/nothing-here')).status).toBe(404);
        expect((await joinWith(FRIEND, 'nothing-here')).status).toBe(404);
    });

    it('pays both tiers out of the fees the referred actually paid', async () =>
    {
        const first = await createCampaign(ADMIN, 'Chat');
        expect((await joinWith(REFERRED, first.code)).status).toBe(200);

        // The second hop: REFERRED brings FRIEND in, which makes FRIEND indirect for ADMIN.
        const second = await createCampaign(REFERRED, 'Sub');
        expect((await joinWith(FRIEND, second.code)).status).toBe(200);

        // Market 1 has resolved, so its escrowed fees reached the treasury. Market 0 is still
        // live: its fee could yet be refunded by a void, so it counts as trading but earns nothing.
        const at = Math.floor(Date.now() / 1000) - 60;
        store.insertTrade({
            id: 'ref-1',
            market_id: 1,
            account: REFERRED.address.toLowerCase(),
            outcome_idx: 0,
            action: 'buy',
            amount: 100,
            shares: 160,
            price: 0.625,
            fee: 10,
            at,
            block: 90
        });
        store.insertTrade({
            id: 'ref-2',
            market_id: 1,
            account: FRIEND.address.toLowerCase(),
            outcome_idx: 0,
            action: 'buy',
            amount: 200,
            shares: 320,
            price: 0.625,
            fee: 20,
            at,
            block: 91
        });
        store.insertTrade({
            id: 'ref-3',
            market_id: 0,
            account: REFERRED.address.toLowerCase(),
            outcome_idx: 0,
            action: 'buy',
            amount: 400,
            shares: 640,
            price: 0.625,
            fee: 40,
            at,
            block: 92
        });

        const page = await dashboardOf(ADMIN);
        expect(page.total.directEarnings).toBeCloseTo(7.5);
        expect(page.total.indirectEarnings).toBeCloseTo(5);
        expect(page.total.activeTraders).toBe(2);
        expect(page.referred.find((row) => row.address === REFERRED.address.toLowerCase())?.trades).toBe(2);
        expect(page.referred.find((row) => row.address === FRIEND.address.toLowerCase())?.tier).toBe('indirect');

        // The other side of the same chain: REFERRED earns only on their own direct one.
        const downstream = await dashboardOf(REFERRED);
        expect(downstream.total.directEarnings).toBeCloseTo(15);
        expect(downstream.referrer?.address).toBe(ADMIN.address.toLowerCase());
    });

    it('binds an address once and refuses a self-referral or a loop', async () =>
    {
        const again = await createCampaign(ADMIN, 'Second try');
        // REFERRED already joined in the test above; first touch is final.
        expect((await joinWith(REFERRED, again.code)).status).toBe(400);

        const own = await createCampaign(STRANGER, 'Mine');
        expect((await joinWith(STRANGER, own.code)).status).toBe(400);

        // ADMIN is upstream of REFERRED, so ADMIN joining REFERRED closes the ring.
        const downstream = await createCampaign(REFERRED, 'Loop');
        expect((await joinWith(ADMIN, downstream.code)).status).toBe(400);
    });
});

// ----------------------------------------------------------------------------------------
// Which engine a market runs on
//
// The console reads a market clone directly for its live prices and reserves, and the two
// engines share no view surface - an AMM call against a pool reverts. The row is the only
// place the console can learn which it is holding, so it has to carry the kind.
// ----------------------------------------------------------------------------------------

describe('admin listing reports the engine', () =>
{
    const mixed = new IndexStore(':memory:');
    mixed.ensureChain('0xgenesis', FACTORY);
    const at = Math.floor(Date.now() / 1000);

    const outcomes = (id: number) => [
        {
            market_id: id,
            idx: 0,
            oid: 'yes',
            label_json: JSON.stringify({ en: 'Yes', fa: 'بله' }),
            icon: '',
            price: 0.5
        },
        {
            market_id: id,
            idx: 1,
            oid: 'no',
            label_json: JSON.stringify({ en: 'No', fa: 'خیر' }),
            icon: '',
            price: 0.5
        }
    ];

    const market = (id: number, kind: number) => ({
        id,
        address: `0x${ String(id).padStart(40, '3') }`,
        status: 0,
        category: 'sports',
        title_json: JSON.stringify({ en: kind === 1 ? 'A pool market' : 'An AMM market', fa: 'بازار' }),
        emoji: '⚽',
        rules_json: JSON.stringify({ en: 'Rules.', fa: 'قواعد.' }),
        image: '',
        creator: '0xcafe',
        created_at: at - 100,
        lock_time: at + 100,
        resolve_time: at + 200,
        outcome_count: 2,
        volume: 0,
        liquidity: 10,
        collected: 0,
        winning_outcome: null,
        featured: 0,
        search_text: 'engine',
        kind
    });

    mixed.insertMarket(market(0, 0), outcomes(0));
    mixed.insertMarket(market(1, 1), outcomes(1));

    const { app: mixedApp } = buildApp({
        dev: false,
        store: mixed,
        chain: gateway,
        treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        adminSession
    });

    it('names the AMM and the pool apart', async () =>
    {
        const issuedAt = new Date().toISOString();
        const session = await mixedApp.handle(
            new Request('http://local/api/admin/session', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    address: ADMIN.address,
                    issuedAt,
                    signature: await ADMIN.signMessage({ message: sessionMessage(issuedAt) })
                })
            })
        );
        expect(session.status).toBe(204);
        const cookie = (session.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

        const page = (await (
            await mixedApp.handle(new Request('http://local/api/admin/markets', { headers: { cookie } }))
        ).json()) as AdminMarketPage;

        const byId = new Map(page.rows.map((row) => [row.id, row.kind]));
        expect(byId.get('0')).toBe('amm');
        expect(byId.get('1')).toBe('pool');
    });
});

// ----------------------------------------------------------------------------------------
// Categories, across both generations of the contracts
//
// A category used to be a name each market carried. It is an id into the factory's registry
// now, and what a reader is shown is the meaning the registry holds for it, once per language.
// The markets already deployed are not going to be re-deployed, so one chain holds both - and
// the listing has to answer for both at once.
// ----------------------------------------------------------------------------------------

describe('categories across both contract generations', () =>
{
    const mixed = new IndexStore(':memory:');
    mixed.ensureChain('0xgenesis', FACTORY);
    const at = Math.floor(Date.now() / 1000);

    const outcomes = (id: number) => [
        {
            market_id: id,
            idx: 0,
            oid: 'yes',
            label_json: JSON.stringify({ en: 'Yes', fa: 'بله' }),
            icon: '',
            price: 0.5
        },
        {
            market_id: id,
            idx: 1,
            oid: 'no',
            label_json: JSON.stringify({ en: 'No', fa: 'خیر' }),
            icon: '',
            price: 0.5
        }
    ];

    const market = (id: number, category: string) => ({
        id,
        address: `0x${ String(id).padStart(40, '4') }`,
        status: 0,
        category,
        title_json: JSON.stringify({ en: 'A market', fa: 'یک بازار' }),
        emoji: '⚽',
        rules_json: JSON.stringify({ en: 'Rules.', fa: 'قواعد.' }),
        image: '',
        creator: '0xcafe',
        created_at: at - 100,
        lock_time: at + 100,
        resolve_time: at + 200,
        outcome_count: 2,
        volume: 0,
        liquidity: 10,
        collected: 0,
        winning_outcome: null,
        featured: 0,
        search_text: 'a market',
        kind: 0
    });

    // One market from each era: a name, and an id into the registry.
    mixed.insertMarket(market(0, 'sports'), outcomes(0));
    mixed.insertMarket(market(1, '7'), outcomes(1));

    mixed.putChainCategory(7, true);
    mixed.putChainCategoryName(7, 'en', 'Esports');
    mixed.putChainCategoryName(7, 'fa', 'ورزش الکترونیکی');
    mixed.putChainCategoryName(7, 'de', 'E-Sport');

    // Registered, retired, and nothing filed under it yet.
    mixed.putChainCategory(9, false);
    mixed.putChainCategoryName(9, 'en', 'Weather');

    const { app: mixedApp } = buildApp({
        dev: false,
        store: mixed,
        chain: gateway,
        treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
        adminSession
    });

    const list = async (): Promise<CategoryCount[]> =>
        (await (await mixedApp.handle(new Request('http://local/api/categories'))).json()) as CategoryCount[];

    it('names a registry category from the chain, in every language it ships', async () =>
    {
        const rows = await list();
        const esports = rows.find((row) => row.id === '7');
        expect(esports?.label.en).toBe('Esports');
        expect(esports?.label.fa).toBe('ورزش الکترونیکی');
        // A language this app has no dictionary for is read as absent, not invented.
        expect(Object.keys(esports?.label ?? {})).not.toContain('de');
        expect(esports?.count).toBe(1);
        expect(esports?.retired).toBe(false);
    });

    it('leaves a pre-registry category to the name it was created with', async () =>
    {
        const rows = await list();
        expect(rows.find((row) => row.id === 'sports')?.label.en).toBe('sports');
    });

    it('lists a registered category nothing has been filed under yet', async () =>
    {
        const rows = await list();
        const weather = rows.find((row) => row.id === '9');
        expect(weather?.count).toBe(0);
        expect(weather?.label.en).toBe('Weather');
        // Retired on chain: it keeps its markets and its name, it just stops being offered.
        expect(weather?.retired).toBe(true);
    });
});

// Who, besides an admin, may open the create form. The list is an APP permission and grants
// no on-chain role, which is exactly why it can live in this table instead of in the factory:
// an invited wallet fills the form in and hands the draft back, and an admin signs the deploy.
describe('market creators', () =>
{
    const GUEST = '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199';

    /** The public yes/no, which is the only creator read a non-admin can make. */
    const allowed = async (address: string): Promise<boolean> =>
        ((await (await get(`/api/creators/${ address }`)).json()) as CreatorAccess).allowed;

    it('keeps the list behind the session while the check itself is public', async () =>
    {
        expect((await get('/api/admin/creators')).status).toBe(401);
        // A wallet has to be able to find out about ITSELF - it is not an admin, by definition.
        expect((await get(`/api/creators/${ GUEST }`)).status).toBe(200);
        expect(await allowed(GUEST)).toBe(false);
    });

    it('invites a wallet and answers for it whatever the casing', async () =>
    {
        const cookie = await signIn();
        const issuedAt = new Date().toISOString();
        const rows = (await (
            await post(
                '/api/admin/creators',
                {
                    wallet: GUEST,
                    label: 'Reza',
                    address: ADMIN.address,
                    issuedAt,
                    signature: await ADMIN.signMessage({ message: creatorMessage(GUEST, issuedAt) })
                },
                cookie
            )
        ).json()) as MarketCreator[];

        expect(rows).toHaveLength(1);
        // Stored lowercased: the column is compared against what a browser reports, and
        // checksummed hex would match nothing.
        expect(rows[0]?.address).toBe(GUEST.toLowerCase());
        expect(rows[0]?.label).toBe('Reza');
        expect(await allowed(GUEST.toLowerCase())).toBe(true);
        expect(await allowed(GUEST.toUpperCase().replace('0X', '0x'))).toBe(true);
    });

    it('binds the signature to the wallet being invited', async () =>
    {
        const cookie = await signIn();
        const issuedAt = new Date().toISOString();
        // Signed for GUEST, replayed to invite somebody else.
        const response = await post(
            '/api/admin/creators',
            {
                wallet: STRANGER.address,
                label: '',
                address: ADMIN.address,
                issuedAt,
                signature: await ADMIN.signMessage({ message: creatorMessage(GUEST, issuedAt) })
            },
            cookie
        );
        expect(response.status).toBe(403);
        expect(await allowed(STRANGER.address)).toBe(false);
    });

    it('refuses an invitation signed by a wallet that is not an admin', async () =>
    {
        const cookie = await signIn();
        const issuedAt = new Date().toISOString();
        const response = await post(
            '/api/admin/creators',
            {
                wallet: STRANGER.address,
                label: '',
                address: STRANGER.address,
                issuedAt,
                signature: await STRANGER.signMessage({ message: creatorMessage(STRANGER.address, issuedAt) })
            },
            cookie
        );
        expect(response.status).toBe(403);
    });

    it('takes an invitation back', async () =>
    {
        const cookie = await signIn();
        const issuedAt = new Date().toISOString();
        const rows = (await (
            await post(
                '/api/admin/creators/remove',
                {
                    wallet: GUEST,
                    address: ADMIN.address,
                    issuedAt,
                    signature: await ADMIN.signMessage({ message: creatorRemoveMessage(GUEST, issuedAt) })
                },
                cookie
            )
        ).json()) as MarketCreator[];

        expect(rows).toHaveLength(0);
        expect(await allowed(GUEST)).toBe(false);
    });

    it('refuses anything that is not an address', async () =>
    {
        expect((await get('/api/creators/reza')).status).toBe(422);
    });
});

// A market written by someone who cannot deploy one. The queue is the console's; nothing in it
// reaches the chain by itself, and accepting one only records a verdict - the owner still signs
// the same deploy transaction from the same form.
describe('proposals', () =>
{
    const WRITER = STRANGER;
    const DRAFT = 'title=Will+it+rain+in+Tehran%3F&cat=3&o1=Yes&o2=No';

    /** Files DRAFT as `who`, signed the way the console signs it. */
    const propose = async (who: typeof STRANGER, draft = DRAFT): Promise<Response> =>
    {
        const issuedAt = new Date().toISOString();
        return post('/api/proposals', {
            draft,
            address: who.address,
            issuedAt,
            signature: await who.signMessage({ message: proposalMessage(proposalTitle(draft), issuedAt) })
        });
    };

    const invite = async (wallet: string): Promise<void> =>
    {
        const cookie = await signIn();
        const issuedAt = new Date().toISOString();
        await post(
            '/api/admin/creators',
            {
                wallet,
                label: '',
                address: ADMIN.address,
                issuedAt,
                signature: await ADMIN.signMessage({ message: creatorMessage(wallet, issuedAt) })
            },
            cookie
        );
    };

    it('refuses a wallet that was never invited', async () =>
    {
        const response = await propose(WRITER);
        expect(response.status).toBe(403);
    });

    it('takes one from an invited wallet and keeps the draft verbatim', async () =>
    {
        await invite(WRITER.address);
        const filed = (await (await propose(WRITER)).json()) as Proposal;

        expect(filed.state).toBe('pending');
        expect(filed.proposer).toBe(WRITER.address.toLowerCase());
        // The server stores the string and hands it back: it never has to know what a market
        // is made of, which is why a new form field needs no migration here.
        expect(filed.draft).toBe(DRAFT);
    });

    it('binds the signature to the question being proposed', async () =>
    {
        const issuedAt = new Date().toISOString();
        const response = await post('/api/proposals', {
            draft: 'title=A+different+market&cat=3',
            address: WRITER.address,
            issuedAt,
            // Signed for the FIRST draft's title, replayed over another one.
            signature: await WRITER.signMessage({ message: proposalMessage(proposalTitle(DRAFT), issuedAt) })
        });
        expect(response.status).toBe(403);
    });

    it('lets the proposer read their own queue and nobody read it for them', async () =>
    {
        const mine = (await (await get(`/api/proposals?address=${ WRITER.address }`)).json()) as Proposal[];
        expect(mine).toHaveLength(1);
        // Scoped to the address asked for, so one wallet's queue is not another's.
        const theirs = (await (await get(`/api/proposals?address=${ ADMIN.address }`)).json()) as Proposal[];
        expect(theirs).toHaveLength(0);
        // The console's own read stays behind the session.
        expect((await get('/api/admin/proposals')).status).toBe(401);
    });

    it('declines one, with the reason the proposer will read', async () =>
    {
        const cookie = await signIn();
        const queue = (await (await get('/api/admin/proposals', cookie)).json()) as Proposal[];
        const id = queue[0]?.id ?? 0;

        const issuedAt = new Date().toISOString();
        const verdict = (await (
            await post(
                '/api/admin/proposals/decide',
                {
                    id,
                    accept: false,
                    note: 'The close date is in the past.',
                    address: ADMIN.address,
                    issuedAt,
                    signature: await ADMIN.signMessage({ message: proposalDecideMessage(id, false, issuedAt) })
                },
                cookie
            )
        ).json()) as ProposalResult;

        expect(verdict.state).toBe('declined');
        const mine = (await (await get(`/api/proposals?address=${ WRITER.address }`)).json()) as Proposal[];
        expect(mine[0]?.state).toBe('declined');
        expect(mine[0]?.note).toBe('The close date is in the past.');
    });

    it('refuses to decide the same one twice', async () =>
    {
        const cookie = await signIn();
        const queue = (await (await get('/api/admin/proposals', cookie)).json()) as Proposal[];
        const id = queue[0]?.id ?? 0;

        const issuedAt = new Date().toISOString();
        const response = await post(
            '/api/admin/proposals/decide',
            {
                id,
                accept: true,
                note: '',
                address: ADMIN.address,
                issuedAt,
                signature: await ADMIN.signMessage({ message: proposalDecideMessage(id, true, issuedAt) })
            },
            cookie
        );
        // Two admins reaching for one row must not tell the proposer two different things.
        expect(response.status).toBe(409);
    });

    it('takes one from a factory admin who is on no allowlist at all', async () =>
    {
        const filed = (await (await propose(ADMIN, 'title=An+admin+wrote+this&cat=3')).json()) as Proposal;
        expect(filed.state).toBe('pending');
    });
});
