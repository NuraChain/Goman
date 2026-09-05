// The API over a seeded in-memory index and a stubbed chain gateway: envelopes, filters,
// portfolio math, the signed admin feature toggle. What the browser client actually gets.
import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';

import { buildApp } from '../src/app.ts';
import { createAdminSession } from '../src/admin-session.ts';
import {
    campaignMessage,
    categoryMessage,
    featureMessage,
    joinMessage,
    sessionMessage,
    type Market,
    type MarketPage,
    type PortfolioSummary,
    type Position,
    type ReferralCampaign,
    type ReferralDashboard
} from '../src/schemas.ts';
import { IndexStore } from '../src/chain/store.ts';
import type { ChainGateway } from '../src/chain/client.ts';

const ADMIN = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const STRANGER = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

/** Two more wallets, used to build a two-tier referral chain: ADMIN -> REFERRED -> FRIEND. */
const REFERRED = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');
const FRIEND = privateKeyToAccount('0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6');

function seededStore(): IndexStore {
    const store = new IndexStore(':memory:');
    store.ensureChain('0xgenesis');
    const now = Math.floor(Date.now() / 1000);

    store.insertMarket(
        {
            id: 0,
            address: '0x0000000000000000000000000000000000000010',
            status: 0,
            category: 'crypto',
            title_en: 'Bitcoin above $150k?',
            title_fa: 'بیت‌کوین بالای ۱۵۰ هزار؟',
            emoji: '₿',
            rules_en: 'Resolves on the CoinGecko close.',
            rules_fa: 'بر اساس قیمت کوین‌گکو.',
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
            { market_id: 0, idx: 0, oid: 'yes', label_en: 'Yes', label_fa: 'بله', icon: '', price: 0.6 },
            { market_id: 0, idx: 1, oid: 'no', label_en: 'No', label_fa: 'خیر', icon: '', price: 0.4 }
        ]
    );

    store.insertMarket(
        {
            id: 1,
            address: '0x0000000000000000000000000000000000000011',
            status: 3,
            category: 'iran-football',
            title_en: 'Winner of the derby?',
            title_fa: 'برنده دربی؟',
            emoji: '⚽',
            rules_en: 'The Tehran derby result.',
            rules_fa: 'نتیجه دربی تهران.',
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
            { market_id: 1, idx: 0, oid: 'esteghlal', label_en: 'Esteghlal', label_fa: 'استقلال', icon: '', price: 1 },
            {
                market_id: 1,
                idx: 1,
                oid: 'persepolis',
                label_en: 'Persepolis',
                label_fa: 'پرسپولیس',
                icon: '',
                price: 0
            },
            { market_id: 1, idx: 2, oid: 'draw', label_en: 'Draw', label_fa: 'مساوی', icon: '', price: 0 }
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
    async verify(address, message, signature) {
        const signed = await verifyMessage({
            address: address as `0x${string}`,
            message,
            signature: signature as `0x${string}`
        }).catch(() => false);
        return signed ? gateway.hasAdminRole(address as `0x${string}`) : false;
    }
});

const app = buildApp({
    dev: false,
    store,
    chain: gateway,
    treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    adminSession
});

// Fastify answers `inject` with its own light-my-request result; every assertion below reads a
// real `Response` (`.status`, `.json()`, `.headers.get('set-cookie')`), so the result is
// rebuilt into one here rather than rewritten at ninety call sites.
function toResponse(injected: { statusCode: number; body: string; headers: Record<string, unknown> }): Response {
    const headers = new Headers();
    for (const [name, value] of Object.entries(injected.headers)) {
        for (const entry of Array.isArray(value) ? value : [value]) {
            if (typeof entry === 'string' || typeof entry === 'number') {
                headers.append(name, String(entry));
            }
        }
    }
    // A 204 carries no body, and the Response constructor refuses one - as does a 304.
    const bodiless = injected.statusCode === 204 || injected.statusCode === 304;
    return new Response(bodiless ? null : injected.body, { status: injected.statusCode, headers });
}

const get = async (path: string, cookie?: string): Promise<Response> =>
    toResponse(
        await app.inject({
            method: 'GET',
            url: path,
            headers: cookie === undefined ? {} : { cookie }
        })
    );
const post = async (path: string, body: object, cookie?: string): Promise<Response> =>
    toResponse(
        await app.inject({
            method: 'POST',
            url: path,
            headers: cookie === undefined ? {} : { cookie },
            payload: body
        })
    );

/** Opens a real admin session and returns the Cookie header to replay. */
async function signIn(account = ADMIN): Promise<string> {
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

describe('auctionhouse api over the index', () => {
    it('answers the health probe with the cursor', async () => {
        const response = await get('/api/healthz');
        expect(response.status).toBe(200);
        expect(((await response.json()) as { lastBlock: number }).lastBlock).toBe(42);
    });

    it('lists markets in a paged envelope, bilingual, binary-collapsed', async () => {
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

    it('searches Persian text and filters custom categories server-side', async () => {
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

    it('serves one market, resolved metadata included, and 404s unknowns', async () => {
        const market = (await (await get('/api/markets/1')).json()) as Market;
        expect(market.status).toBe('resolved');
        expect(market.winningOutcomeId).toBe('esteghlal');
        expect(market.noIndex).toBeNull();
        expect((await get('/api/markets/99')).status).toBe(404);
    });

    it('serves a series pinned to the live price and rejects bad ranges', async () => {
        const response = await get('/api/markets/0/series?outcome=yes&range=1w');
        const series = (await response.json()) as { points: Array<{ p: number }> };
        expect(series.points.length).toBe(40);
        expect(series.points[series.points.length - 1]?.p).toBeCloseTo(0.6, 5);
        expect((await get('/api/markets/0/series?outcome=yes&range=1y')).status).toBe(422);
    });

    it('lists categories with counts, custom ones included', async () => {
        const rows = (await (await get('/api/categories')).json()) as Array<{
            id: string;
            count: number;
            retired: boolean;
        }>;
        expect(rows.find((row) => row.id === 'iran-football')).toMatchObject({ count: 1, retired: false });
    });

    it('a category registered before its first market still lists, at count 0', async () => {
        // The whole reason categories became a table: derived purely from markets, a new
        // category could not exist until an entire market-creation transaction had landed.
        const issuedAt = new Date().toISOString();
        const response = await post('/api/categories', {
            id: 'Esports',
            labelEn: 'Esports',
            labelFa: 'ورزش الکترونیک',
            image: '',
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
            labelFa: string;
        }>;
        expect(rows.find((row) => row.id === 'esports')).toMatchObject({ count: 0, labelFa: 'ورزش الکترونیک' });
    });

    it('refuses a category edit signed by a non-admin', async () => {
        const issuedAt = new Date().toISOString();
        const response = await post('/api/categories', {
            id: 'crypto',
            labelEn: 'Hijacked',
            labelFa: '',
            image: '',
            sortOrder: 0,
            retired: false,
            address: STRANGER.address,
            issuedAt,
            signature: await STRANGER.signMessage({ message: categoryMessage('crypto', issuedAt) })
        });
        expect(response.status).toBe(403);
    });

    it('exposes the chain config the frontend boots from', async () => {
        const config = (await (await get('/api/chain')).json()) as { factory: string; lastBlock: number };
        expect(config.factory).toBe(gateway.env.factory);
        expect(config.lastBlock).toBe(42);
    });

    it('portfolio positions embed their market and flag claimables', async () => {
        const rows = (await (await get(`/api/portfolio/positions?address=${ADMIN.address}`)).json()) as Position[];
        expect(rows.length).toBe(1);
        expect(rows[0].market.title.en).toContain('Bitcoin');
        expect(rows[0].side).toBe('yes');
        expect(rows[0].avgPrice).toBeCloseTo(25 / 44, 5);
        expect(rows[0].claimable).toBe(false);
    });

    it('portfolio summary carries real balance and lifetime profit', async () => {
        const summary = (await (await get(`/api/portfolio?address=${ADMIN.address}`)).json()) as PortfolioSummary;
        expect(summary.balance).toBe(9974.5);

        // Spent 35, claimed 20, holds 44 shares at 0.6: profit = -35 + 20 + 26.4.
        expect(summary.profit).toBeCloseTo(11.4, 1);
        expect(summary.invested).toBeCloseTo(25, 5);
    });

    it('ranks the leaderboard from real flows', async () => {
        const rows = (await (await get('/api/leaderboard?period=all')).json()) as Array<{
            address: string;
            profit: number;
        }>;
        expect(rows[0]?.address).toBe(ADMIN.address.toLowerCase());
        expect(rows[0]?.profit).toBeCloseTo(11.4, 1);
    });

    it('admin stats aggregate the whole index, for a signed-in admin', async () => {
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

    it('EVERY admin route refuses an anonymous caller - the guard is on the feature', async () => {
        // The console's reads used to be open: /admin/stats returned fees, TVL and trader
        // counts to anyone who asked. They are guarded now because of the feature they
        // land in, so a route added later inherits the refusal instead of needing a line.
        for (const path of ['/api/admin/stats', '/api/admin/activity', '/api/admin/markets']) {
            expect((await get(path)).status, `${path} must refuse an anonymous caller`).toBe(401);
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

    it('refuses a session to a stranger, and to a bad signature from a real admin', async () => {
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

    it('signing out ends the session it was issued for', async () => {
        const cookie = await signIn();
        expect((await get('/api/admin/stats', cookie)).status).toBe(200);

        const out = toResponse(await app.inject({ method: 'DELETE', url: '/api/admin/session', headers: { cookie } }));
        expect(out.status).toBe(204);
        expect((await get('/api/admin/stats', cookie)).status).toBe(401);
    });

    it('feature toggle demands a fresh signature from a real admin', async () => {
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

    it('404s cleanly outside /api when no client is mounted', async () => {
        expect((await get('/nope')).status).toBe(404);
    });
});

// Activity and holders page on the SERVER. Both used to answer with a fixed slice and no
// total: a market's trade tail past 40 was unreachable, and the holders cap of 8 sat BELOW
// the client's page size, so that list could never report more than one page and its
// pagination control was unreachable markup. These pin the window and the count.
describe('market activity + holders paging', () => {
    const paged = new IndexStore(':memory:');
    paged.ensureChain('0xgenesis');
    const at = Math.floor(Date.now() / 1000);

    paged.insertMarket(
        {
            id: 0,
            address: '0x0000000000000000000000000000000000000020',
            status: 0,
            category: 'crypto',
            title_en: 'Busy market',
            title_fa: 'بازار شلوغ',
            emoji: '🔥',
            rules_en: 'Rules.',
            rules_fa: 'قواعد.',
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
            { market_id: 0, idx: 0, oid: 'yes', label_en: 'Yes', label_fa: 'بله', icon: '', price: 0.5 },
            { market_id: 0, idx: 1, oid: 'no', label_en: 'No', label_fa: 'خیر', icon: '', price: 0.5 }
        ]
    );

    // 25 trades from 12 distinct holders: more than two pages of each at the default window.
    for (let index = 0; index < 25; index++) {
        const account = `0x${String(index % 12).padStart(40, '0')}`;
        paged.insertTrade({
            id: `p${index}`,
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

    const pagedApp = buildApp({
        dev: false,
        store: paged,
        chain: gateway,
        treasury: '0x5FbDB2315678afecb367f032d93F642f64180aa3'
    });
    const fetchPage = async (path: string): Promise<Response> =>
        toResponse(await pagedApp.inject({ method: 'GET', url: path }));

    it('reports the whole trade count and walks the tail past the old fixed slice', async () => {
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

    it('pages holders past one page, which the old 8-row cap made impossible', async () => {
        const response = await fetchPage('/api/markets/0/holders?page=1&limit=10');
        const page = (await response.json()) as { rows: unknown[]; total: number; pages: number };
        expect(page.total).toBe(12);
        expect(page.pages).toBe(2);
        expect(page.rows).toHaveLength(10);

        const second = await fetchPage('/api/markets/0/holders?page=2&limit=10');
        expect(((await second.json()) as { rows: unknown[] }).rows).toHaveLength(2);
    });

    it('defaults to the first page when no window is given', async () => {
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

describe('markets whose trading is over', () => {
    async function listing(path: string, cookie?: string): Promise<string[]> {
        const page = (await (await get(path, cookie)).json()) as { rows: Array<{ id: string }> };
        return page.rows.map((row) => row.id);
    }

    it('leaves the default listing but stays findable', async () => {
        const before = ((await (await get('/api/markets')).json()) as MarketPage).total;
        const cookie = await signIn();

        // 3 = resolved. Market 0 is the Bitcoin market the rest of the suite reads.
        store.setStatus(0, 3, 0);
        try {
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
        } finally {
            store.setStatus(0, 0, null);
        }
    });

    it('keeps a paused market listed - trading is suspended, not over', async () => {
        store.setStatus(0, 1, null);
        try {
            expect(await listing('/api/markets')).toContain('0');
        } finally {
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

async function createCampaign(account: Signer, name: string): Promise<ReferralCampaign> {
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

async function joinWith(account: Signer, code: string): Promise<Response> {
    const issuedAt = new Date().toISOString();
    return post('/api/referrals/join', {
        code,
        address: account.address,
        issuedAt,
        signature: await account.signMessage({ message: joinMessage(code, issuedAt) })
    });
}

async function dashboardOf(account: Signer, period = 'all'): Promise<ReferralDashboard> {
    const response = await get(`/api/referrals?address=${account.address}&period=${period}`);
    expect(response.status).toBe(200);
    return (await response.json()) as ReferralDashboard;
}

describe('referrals', () => {
    it('refuses a campaign signed by somebody else', async () => {
        const issuedAt = new Date().toISOString();
        const forged = await post('/api/referrals/campaigns', {
            name: 'Forged',
            address: ADMIN.address,
            issuedAt,
            signature: await STRANGER.signMessage({ message: campaignMessage('Forged', issuedAt) })
        });
        expect(forged.status).toBe(403);
    });

    it('creates a campaign with a shareable code and reports it on the dashboard', async () => {
        const campaign = await createCampaign(ADMIN, 'Twitter Push');
        expect(campaign.code).toBe('twitter-push');

        const invite = await get('/api/referrals/invite/twitter-push');
        expect(invite.status).toBe(200);
        expect(((await invite.json()) as { owner: string }).owner).toBe(ADMIN.address.toLowerCase());

        const page = await dashboardOf(ADMIN);
        expect(page.campaigns.map((row) => row.code)).toContain('twitter-push');
    });

    it('answers an unknown code with a 404 rather than a silent no-op', async () => {
        expect((await get('/api/referrals/invite/nothing-here')).status).toBe(404);
        expect((await joinWith(FRIEND, 'nothing-here')).status).toBe(404);
    });

    it('pays both tiers out of the fees the referred actually paid', async () => {
        const first = await createCampaign(ADMIN, 'Chat');
        expect((await joinWith(REFERRED, first.code)).status).toBe(200);

        // The second hop: REFERRED brings FRIEND in, which makes FRIEND indirect for ADMIN.
        const second = await createCampaign(REFERRED, 'Sub');
        expect((await joinWith(FRIEND, second.code)).status).toBe(200);

        const at = Math.floor(Date.now() / 1000) - 60;
        store.insertTrade({
            id: 'ref-1',
            market_id: 0,
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
            market_id: 0,
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

        const page = await dashboardOf(ADMIN);
        expect(page.total.directEarnings).toBeCloseTo(1);
        expect(page.total.indirectEarnings).toBeCloseTo(1);
        expect(page.total.activeTraders).toBe(2);
        expect(page.referred.find((row) => row.address === FRIEND.address.toLowerCase())?.tier).toBe('indirect');

        // The other side of the same chain: REFERRED earns only on their own direct one.
        const downstream = await dashboardOf(REFERRED);
        expect(downstream.total.directEarnings).toBeCloseTo(2);
        expect(downstream.referrer?.address).toBe(ADMIN.address.toLowerCase());
    });

    it('binds an address once and refuses a self-referral or a loop', async () => {
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
