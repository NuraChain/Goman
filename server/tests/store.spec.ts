// The sqlite index: filters, pagination, rollups, and the stale-chain guard - against a
// real in-memory database, because SQL is where list bugs live.
import { describe, it, expect, beforeEach } from 'vitest';

import { IndexStore, type MarketRow, type OutcomeRow } from '../src/chain/store.ts';

/** The factory a fixture index is built from; the store starts over when it changes. */
const FACTORY = '0xfac70aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function marketRow(id: number, overrides: Partial<MarketRow> = {}): MarketRow
{
    return {
        id,
        address: `0x${ String(id + 1).padStart(40, '0') }`,
        status: 0,
        category: 'crypto',
        title_json: JSON.stringify({ en: `Market ${ id }`, fa: `بازار ${ id }` }),
        emoji: 'X',
        rules_json: JSON.stringify({ en: 'rules', fa: 'قوانین' }),
        image: '',
        creator: '0xcafe',
        created_at: 1000 + id,
        lock_time: 5000 + id,
        resolve_time: 9000 + id,
        outcome_count: 2,
        volume: 0,
        liquidity: 100,
        collected: 0,
        winning_outcome: null,
        featured: 0,
        search_text: `market ${ id } بازار yes no crypto`,
        kind: 0,
        ...overrides
    };
}

function yesNo(marketId: number): OutcomeRow[]
{
    return [
        {
            market_id: marketId,
            idx: 0,
            oid: 'yes',
            label_json: JSON.stringify({ en: 'Yes', fa: 'بله' }),
            icon: '',
            price: 0.5
        },
        {
            market_id: marketId,
            idx: 1,
            oid: 'no',
            label_json: JSON.stringify({ en: 'No', fa: 'خیر' }),
            icon: '',
            price: 0.5
        }
    ];
}

describe('IndexStore', () =>
{
    let store: IndexStore;

    beforeEach(async () =>
    {
        store = await IndexStore.open(':memory:');
        await store.ensureChain('0xgenesis', FACTORY);
    });

    it('filters by search, category, and status with correct totals', async () =>
    {
        await store.insertMarket(
            marketRow(0, { category: 'sports', search_text: 'champions league فوتبال sports' }),
            yesNo(0)
        );
        await store.insertMarket(marketRow(1), yesNo(1));
        await store.insertMarket(marketRow(2, { status: 3 }), yesNo(2));

        expect((await store.listMarkets({ sort: 'volume', page: 1, limit: 10 })).total).toBe(3);
        expect(
            (await store.listMarkets({ search: 'champions', sort: 'volume', page: 1, limit: 10 })).rows.map((row) => row.id)
        ).toEqual([0]);
        expect((await store.listMarkets({ search: 'فوتبال', sort: 'volume', page: 1, limit: 10 })).total).toBe(1);
        expect((await store.listMarkets({ category: 'crypto', sort: 'volume', page: 1, limit: 10 })).total).toBe(2);
        expect((await store.listMarkets({ status: 3, sort: 'volume', page: 1, limit: 10 })).rows.map((row) => row.id)).toEqual([
            2
        ]);
    });

    it('paginates with stable ordering', async () =>
    {
        for (let i = 0; i < 25; i++)
        {
            await store.insertMarket(marketRow(i, { volume: i }), yesNo(i));
        }
        const first = await store.listMarkets({ sort: 'volume', page: 1, limit: 10 });
        const third = await store.listMarkets({ sort: 'volume', page: 3, limit: 10 });
        expect(first.total).toBe(25);
        expect(first.rows[0].id).toBe(24);
        expect(third.rows.length).toBe(5);
        expect(third.rows[4].id).toBe(0);
    });

    it('sorts newest and ending distinctly', async () =>
    {
        await store.insertMarket(marketRow(0, { created_at: 100, lock_time: 900 }), yesNo(0));
        await store.insertMarket(marketRow(1, { created_at: 300, lock_time: 100 }), yesNo(1));
        expect((await store.listMarkets({ sort: 'newest', page: 1, limit: 10 })).rows[0].id).toBe(1);
        expect((await store.listMarkets({ sort: 'ending', page: 1, limit: 10 })).rows[0].id).toBe(1);
    });

    it('rolls trades into volume, trending, and aggregates', async () =>
    {
        await store.insertMarket(marketRow(0), yesNo(0));
        await store.insertMarket(marketRow(1), yesNo(1));
        await store.insertTrade({
            id: 't1',
            market_id: 1,
            account: '0xa',
            outcome_idx: 0,
            action: 'buy',
            amount: 25,
            shares: 40,
            price: 0.625,
            fee: 0,
            at: 100,
            block: 1
        });
        await store.insertTrade({
            id: 't2',
            market_id: 0,
            account: '0xb',
            outcome_idx: 0,
            action: 'buy',
            amount: 5,
            shares: 9,
            price: 0.55,
            fee: 0,
            at: 110,
            block: 2
        });

        expect((await store.marketById(1))?.volume).toBe(25);
        expect(await store.trendingIds(0, 9)).toEqual([1, 0]);
        const aggregate = await store.aggregates(0);
        expect(aggregate.volume).toBe(30);
        expect(aggregate.traders).toBe(2);
    });

    it('nets balances and hides dust and LP shares from positions', async () =>
    {
        await store.insertMarket(marketRow(0), yesNo(0));
        await store.applyBalanceDelta('0xa', 0, '0', 10, 100);
        await store.applyBalanceDelta('0xa', 0, '0', -10, 120);
        await store.applyBalanceDelta('0xa', 0, '1', 4, 130);
        await store.applyBalanceDelta('0xa', 0, (2n ** 256n - 1n).toString(), 50, 130);

        const positions = await store.positionsOf('0xA');
        expect(positions.length).toBe(1);
        expect(positions[0].token_id).toBe('1');
        expect((await store.holdersOf(0, 8)).length).toBe(1);
    });

    it('rebuilds the derived tables on a schema bump but keeps the categories', async () =>
    {
        // A file-backed store: the whole point is what survives a REOPEN. An older index that
        // predates a column would otherwise serve rows missing it, and the API answers 500.
        const { mkdtempSync, rmSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const dir = mkdtempSync(join(tmpdir(), 'auctionhouse-store-'));
        const file = join(dir, 'index.db');

        const first = await IndexStore.open(file);
        await first.ensureChain('0xgenesis', FACTORY);
        await first.insertMarket(marketRow(0), yesNo(0));
        await first.setCursor(50);
        await first.upsertCategory({
            id: 'esports',
            labelJson: JSON.stringify({ en: 'Esports', fa: 'ورزش الکترونیک' }),
            sortOrder: 1,
            retired: false
        });
        await first.setMeta('schema', 'older');
        await first.close();

        const reopened = await IndexStore.open(file);
        expect(await reopened.marketById(0)).toBeNull();
        expect(await reopened.cursor()).toBe(-1);
        const kept = (await reopened.categories()).find((row) => row.id === 'esports');
        expect(kept).toBeDefined();
        expect(JSON.parse(kept!.labelJson)).toEqual({ en: 'Esports', fa: 'ورزش الکترونیک' });
        await reopened.close();

        rmSync(dir, { recursive: true, force: true });
    });

    it('migrates a pre-existing bilingual categories table into the localized one', async () =>
    {
        // `categories` is the ONE table a schema bump cannot rebuild from the chain, so this
        // is the path every real deployment takes on the first boot after this change. It
        // runs against a table built the OLD way on purpose - the DDL now creates the new
        // shape, so nothing else in this suite would ever exercise the conversion.
        const { DatabaseSync } = await import('node:sqlite');
        const { mkdtempSync, rmSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const dir = mkdtempSync(join(tmpdir(), 'auctionhouse-migrate-'));
        const file = join(dir, 'index.db');

        const legacy = new DatabaseSync(file);
        legacy.exec(`
            CREATE TABLE categories (
                id TEXT PRIMARY KEY,
                label_en TEXT NOT NULL DEFAULT '',
                label_fa TEXT NOT NULL DEFAULT '',
                image TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                retired INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO categories VALUES ('sports', 'Sports', 'ورزش', '/uploads/a.png', 3, 0);
            INSERT INTO categories VALUES ('tech', 'Tech', '', '', 1, 1);
        `);
        legacy.close();

        const store = await IndexStore.open(file);
        const rows = await store.categories();

        const sports = rows.find((row) => row.id === 'sports');
        expect(JSON.parse(sports!.labelJson)).toEqual({ en: 'Sports', fa: 'ورزش' });

        // An empty Persian label becomes an ABSENT one, not an empty string - a blank stored
        // translation would beat the English fallback and render nothing.
        const tech = rows.find((row) => row.id === 'tech');
        expect(JSON.parse(tech!.labelJson)).toEqual({ en: 'Tech' });
        expect(tech!.retired).toBe(true);

        // Idempotent: a second boot must not try to convert an already-converted table.
        await store.close();
        const again = await IndexStore.open(file);
        expect((await again.categories()).length).toBe(2);
        await again.close();

        rmSync(dir, { recursive: true, force: true });
    });

    it('wipes everything when the chain genesis changes', async () =>
    {
        await store.insertMarket(marketRow(0), yesNo(0));
        await store.setCursor(50);
        expect(await store.ensureChain('0xgenesis', FACTORY)).toBe(false);
        expect(await store.ensureChain('0xother', FACTORY)).toBe(true);
        expect(await store.marketById(0)).toBeNull();
        expect(await store.cursor()).toBe(-1);
    });

    it('wipes everything when the FACTORY changes - ids are that registry own counter', async () =>
    {
        await store.ensureChain('0xgenesis', FACTORY);
        await store.insertMarket(marketRow(0), yesNo(0));
        await store.setCursor(50);

        // A redeployed factory hands out market id 0 again. Keeping the old rows would not
        // merge two registries, it would HIDE the new market behind the old one: inserting an
        // id that already exists does nothing at all.
        expect(await store.ensureChain('0xgenesis', '0xotherfactory')).toBe(true);
        expect(await store.marketById(0)).toBeNull();
        expect(await store.cursor()).toBe(-1);
    });
});

/** A trade of `amount` on market `marketId`, at `at`. */
function trade(id: string, marketId: number, account: string, amount: number, at: number)
{
    return { id, market_id: marketId, account, outcome_idx: 0, action: 'buy', amount, shares: amount * 2, price: 0.5, fee: 0, at, block: at };
}

describe('the transaction contract', () =>
{
    let store: IndexStore;

    beforeEach(async () =>
    {
        store = await IndexStore.open(':memory:');
        await store.ensureChain('0xgenesis', FACTORY);
    });

    it('commits everything inside one transaction, and rolls ALL of it back on a throw', async () =>
    {
        await store.transaction(async () =>
        {
            await store.insertMarket(marketRow(0), yesNo(0));
            await store.setCursor(5);
        });
        await expect(store.transaction(async () =>
        {
            await store.insertMarket(marketRow(1), yesNo(1));
            await store.setCursor(9);
            throw new Error('the node dropped the batch');
        })).rejects.toThrow('the node dropped');

        // The market and the cursor move together or not at all: a cursor past rows that were
        // never written makes the indexer skip them forever.
        expect(await store.marketById(0)).not.toBeNull();
        expect(await store.marketById(1)).toBeNull();
        expect(await store.cursor()).toBe(5);
    });

    it('joins an outer transaction rather than opening a second one', async () =>
    {
        await expect(store.transaction(async () =>
        {
            await store.transaction(async () => store.insertMarket(marketRow(0), yesNo(0)));
            throw new Error('outer failed');
        })).rejects.toThrow();
        expect(await store.marketById(0)).toBeNull();
    });

    it('refuses a call that outlives its transaction, so nothing lands after the outcome', async () =>
    {
        let late: Promise<void> = Promise.resolve();
        await expect(store.transaction(async () =>
        {
            late = new Promise<void>((resolve, reject) =>
            {
                setTimeout(() =>
                {
                    store.setCursor(77).then(resolve, reject);
                }, 10);
            });
            throw new Error('the batch failed');
        })).rejects.toThrow('the batch failed');

        await expect(late).rejects.toThrow(/outlived/);
        expect(await store.cursor()).toBe(-1);
    });

    it('keeps a call from outside out of an open transaction, so it never reads what is rolled back', async () =>
    {
        let release = (): void => undefined;
        const held = new Promise<void>((resolve) =>
        {
            release = resolve;
        });
        const open = store.transaction(async () =>
        {
            await store.insertMarket(marketRow(0), yesNo(0));
            await held;
            throw new Error('rolled back');
        });

        // Made while the transaction holds the index, after its write and before its rollback.
        const read = store.marketById(0);
        release();
        await expect(open).rejects.toThrow('rolled back');
        expect(await read).toBeNull();
    });

    it('closes once, and refuses every call after it', async () =>
    {
        await store.close();
        await store.close();
        await expect(store.cursor()).rejects.toThrow(/closed/);
        await expect(store.transaction(async () => 1)).rejects.toThrow(/closed/);
    });
});

describe('the reads a page or a chunk makes at once', () =>
{
    let store: IndexStore;

    beforeEach(async () =>
    {
        store = await IndexStore.open(':memory:');
        await store.ensureChain('0xgenesis', FACTORY);
        await store.insertMarket(marketRow(0), yesNo(0));
        await store.insertMarket(marketRow(1), yesNo(1));
    });

    it('counts a replayed trade into its market volume once', async () =>
    {
        await store.insertTrade(trade('t1', 0, '0xa', 25, 100));
        await store.insertTrade(trade('t1', 0, '0xa', 25, 100));
        expect((await store.marketById(0))?.volume).toBe(25);
        expect(await store.tradesCount()).toBe(1);
    });

    it('answers several markets, their outcomes and their addresses in one read each', async () =>
    {
        const markets = await store.marketsByIds([1, 0, 1, 99]);
        expect([...markets.keys()].sort()).toEqual([0, 1]);

        const outcomes = await store.outcomesOfMarkets([0, 1]);
        expect(outcomes.get(1)?.map((outcome) => outcome.idx)).toEqual([0, 1]);

        // Lowercased both ways, so a checksummed emitter still finds its market.
        const byAddress = await store.marketIdsByAddresses([marketRow(1).address.toUpperCase().replace('0X', '0x'), '0xnope']);
        expect([...byAddress.entries()]).toEqual([[marketRow(1).address, 1]]);

        expect(await store.marketsByIds([])).toEqual(new Map());
    });

    it('marks every pair at every time with the last price at or before it', async () =>
    {
        await store.insertPricePoint(0, 0, 100, 0.2);
        await store.insertPricePoint(0, 0, 200, 0.7);
        await store.insertPricePoint(1, 1, 150, 0.4);

        const priceAt = await store.pricesAt([[0, 0], [1, 1]], [99, 150.5, 250]);
        expect(priceAt(0, 0, 99)).toBeNull();
        // A sample between whole seconds reads the mark before it.
        expect(priceAt(0, 0, 150.5)).toBe(0.2);
        expect(priceAt(0, 0, 250)).toBe(0.7);
        expect(priceAt(1, 1, 150.5)).toBe(0.4);
    });

    it('answers many traders history in one read, oldest first', async () =>
    {
        await store.insertTrade(trade('t2', 1, '0xb', 5, 300));
        await store.insertTrade(trade('t1', 0, '0xa', 25, 100));
        await store.insertTrade(trade('t3', 0, '0xb', 1, 200));
        await store.insertClaim('c1', 0, '0xb', 9, 400);

        const trades = await store.tradesOfAccounts(['0xB', '0xa', '0xnobody']);
        expect(trades.get('0xb')?.map((row) => row.id)).toEqual(['t3', 't2']);
        expect(trades.get('0xa')?.map((row) => row.id)).toEqual(['t1']);
        expect(trades.has('0xnobody')).toBe(false);

        const claims = await store.claimsOfAccounts(['0xb']);
        expect(claims.get('0xb')).toEqual([{ market_id: 0, amount: 9, at: 400 }]);
    });

    it('lists every registry category it holds', async () =>
    {
        await store.putChainCategory(7, true);
        await store.putChainCategory(9, false);
        expect(await store.chainCategoryIds()).toEqual(new Set([7, 9]));
    });
});
