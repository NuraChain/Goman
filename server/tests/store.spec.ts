// The sqlite index: filters, pagination, rollups, and the stale-chain guard - against a
// real in-memory database, because SQL is where list bugs live.
import { describe, it, expect, beforeEach } from 'vitest';

import { IndexStore, type MarketRow, type OutcomeRow } from '../src/chain/store.ts';

function marketRow(id: number, overrides: Partial<MarketRow> = {}): MarketRow {
    return {
        id,
        address: `0x${String(id + 1).padStart(40, '0')}`,
        status: 0,
        category: 'crypto',
        title_json: JSON.stringify({ en: `Market ${id}`, fa: `بازار ${id}` }),
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
        search_text: `market ${id} بازار yes no crypto`,
        kind: 0,
        ...overrides
    };
}

function yesNo(marketId: number): OutcomeRow[] {
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

describe('IndexStore', () => {
    let store: IndexStore;

    beforeEach(() => {
        store = new IndexStore(':memory:');
        store.ensureChain('0xgenesis');
    });

    it('filters by search, category, and status with correct totals', () => {
        store.insertMarket(
            marketRow(0, { category: 'sports', search_text: 'champions league فوتبال sports' }),
            yesNo(0)
        );
        store.insertMarket(marketRow(1), yesNo(1));
        store.insertMarket(marketRow(2, { status: 3 }), yesNo(2));

        expect(store.listMarkets({ sort: 'volume', page: 1, limit: 10 }).total).toBe(3);
        expect(
            store.listMarkets({ search: 'champions', sort: 'volume', page: 1, limit: 10 }).rows.map((row) => row.id)
        ).toEqual([0]);
        expect(store.listMarkets({ search: 'فوتبال', sort: 'volume', page: 1, limit: 10 }).total).toBe(1);
        expect(store.listMarkets({ category: 'crypto', sort: 'volume', page: 1, limit: 10 }).total).toBe(2);
        expect(store.listMarkets({ status: 3, sort: 'volume', page: 1, limit: 10 }).rows.map((row) => row.id)).toEqual([
            2
        ]);
    });

    it('paginates with stable ordering', () => {
        for (let i = 0; i < 25; i++) {
            store.insertMarket(marketRow(i, { volume: i }), yesNo(i));
        }
        const first = store.listMarkets({ sort: 'volume', page: 1, limit: 10 });
        const third = store.listMarkets({ sort: 'volume', page: 3, limit: 10 });
        expect(first.total).toBe(25);
        expect(first.rows[0].id).toBe(24);
        expect(third.rows.length).toBe(5);
        expect(third.rows[4].id).toBe(0);
    });

    it('sorts newest and ending distinctly', () => {
        store.insertMarket(marketRow(0, { created_at: 100, lock_time: 900 }), yesNo(0));
        store.insertMarket(marketRow(1, { created_at: 300, lock_time: 100 }), yesNo(1));
        expect(store.listMarkets({ sort: 'newest', page: 1, limit: 10 }).rows[0].id).toBe(1);
        expect(store.listMarkets({ sort: 'ending', page: 1, limit: 10 }).rows[0].id).toBe(1);
    });

    it('rolls trades into volume, trending, and aggregates', () => {
        store.insertMarket(marketRow(0), yesNo(0));
        store.insertMarket(marketRow(1), yesNo(1));
        store.insertTrade({
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
        store.insertTrade({
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

        expect(store.marketById(1)?.volume).toBe(25);
        expect(store.trendingIds(0, 9)).toEqual([1, 0]);
        const aggregate = store.aggregates(0);
        expect(aggregate.volume).toBe(30);
        expect(aggregate.traders).toBe(2);
    });

    it('nets balances and hides dust and LP shares from positions', () => {
        store.insertMarket(marketRow(0), yesNo(0));
        store.applyBalanceDelta('0xa', 0, '0', 10, 100);
        store.applyBalanceDelta('0xa', 0, '0', -10, 120);
        store.applyBalanceDelta('0xa', 0, '1', 4, 130);
        store.applyBalanceDelta('0xa', 0, (2n ** 256n - 1n).toString(), 50, 130);

        const positions = store.positionsOf('0xA');
        expect(positions.length).toBe(1);
        expect(positions[0].token_id).toBe('1');
        expect(store.holdersOf(0, 8).length).toBe(1);
    });

    it('rebuilds the derived tables on a schema bump but keeps the categories', async () => {
        // A file-backed store: the whole point is what survives a REOPEN. An older index that
        // predates a column would otherwise serve rows missing it, and the API answers 500.
        const { mkdtempSync, rmSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const dir = mkdtempSync(join(tmpdir(), 'auctionhouse-store-'));
        const file = join(dir, 'index.db');

        const first = new IndexStore(file);
        first.ensureChain('0xgenesis');
        first.insertMarket(marketRow(0), yesNo(0));
        first.setCursor(50);
        first.upsertCategory({
            id: 'esports',
            labelEn: 'Esports',
            labelFa: 'ورزش الکترونیک',
            image: '',
            sortOrder: 1,
            retired: false
        });
        first.setMeta('schema', 'older');
        first.close();

        const reopened = new IndexStore(file);
        expect(reopened.marketById(0)).toBeNull();
        expect(reopened.cursor()).toBe(-1);
        expect(reopened.categories().map((row) => row.id)).toContain('esports');
        reopened.close();

        rmSync(dir, { recursive: true, force: true });
    });

    it('wipes everything when the chain genesis changes', () => {
        store.insertMarket(marketRow(0), yesNo(0));
        store.setCursor(50);
        expect(store.ensureChain('0xgenesis')).toBe(false);
        expect(store.ensureChain('0xother')).toBe(true);
        expect(store.marketById(0)).toBeNull();
        expect(store.cursor()).toBe(-1);
    });
});
