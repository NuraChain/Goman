// Reading the factory's category registry as STATE rather than only as a stream of events.
//
// The index normally learns a category from `CategoryAdded`, which is exact for as long as
// the replay window contains that event. When it does not - DEPLOY_BLOCK set past it, an
// index pointed at a chain already running, a registration made while this server was down
// - the category still exists on chain and still gates `createMarket`, and the app shows a
// bare `#12` nothing can name. This is the floor under that.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { IndexStore } from '../src/chain/store.ts';
import { syncCategories } from '../src/chain/indexer.ts';
import type { ChainReader } from '../src/chain/client.ts';
import type { Logger } from '../src/logger.ts';

const FACTORY = '0xfac70aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const silent: Logger = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

/** A language tag as the registry stores it: ASCII in a right-padded bytes8. */
function bytes8(tag: string): string {
    return `0x${Buffer.from(tag, 'ascii').toString('hex').padEnd(16, '0')}`;
}

/** A stand-in registry. Only the three reads `syncCategories` makes are implemented. */
function registry(
    entries: Record<number, { enabled: boolean; names: Record<string, string> } | undefined>,
    ids?: number[]
) {
    const chain = {
        categoryIds: vi.fn(() => Promise.resolve(ids ?? Object.keys(entries).map(Number))),
        categoryState: vi.fn((id: number) => {
            const found = entries[id];
            return Promise.resolve({ known: found !== undefined, enabled: found?.enabled ?? false });
        }),
        categoryMeanings: vi.fn((id: number) =>
            Promise.resolve(
                Object.entries(entries[id]?.names ?? {}).map(([lang, meaning]) => ({ lang: bytes8(lang), meaning }))
            )
        )
    };
    return chain as unknown as ChainReader & typeof chain;
}

describe('reading the category registry off the chain', () => {
    let store: IndexStore;

    beforeEach(() => {
        store = new IndexStore(':memory:');
        store.ensureChain('0xgenesis', FACTORY);
    });

    it('stores a category the index has never heard of', async () => {
        const chain = registry({ 12: { enabled: true, names: { en: 'Football', fa: 'فوتبال' } } });

        await syncCategories(store, chain, silent);

        expect(store.chainCategories()).toEqual([{ id: 12, enabled: true }]);
        expect(store.chainCategoryNames()).toEqual([
            { id: 12, lang: 'en', meaning: 'Football' },
            { id: 12, lang: 'fa', meaning: 'فوتبال' }
        ]);
    });

    it('carries the disabled flag, so a retired category does not come back open', async () => {
        const chain = registry({ 12: { enabled: false, names: { en: 'Football' } } });

        await syncCategories(store, chain, silent);

        expect(store.chainCategories()).toEqual([{ id: 12, enabled: false }]);
    });

    it('leaves a category the index already holds completely alone', async () => {
        // The events are the fast path and they are the CURRENT truth; a boot-time re-read
        // must not undo a meaning a later `CategoryMeaningSet` corrected.
        store.putChainCategory(12, false);
        store.putChainCategoryName(12, 'en', 'Football (corrected)');
        const chain = registry({ 12: { enabled: true, names: { en: 'Football' } } });

        await syncCategories(store, chain, silent);

        expect(store.chainCategories()).toEqual([{ id: 12, enabled: false }]);
        expect(store.chainCategoryNames()).toEqual([{ id: 12, lang: 'en', meaning: 'Football (corrected)' }]);
        expect(chain.categoryState).not.toHaveBeenCalled();
    });

    it('reads only what is missing when the registry is mostly known', async () => {
        store.putChainCategory(1, true);
        const chain = registry({
            1: { enabled: true, names: { en: 'Crypto' } },
            2: { enabled: true, names: { en: 'Sports' } }
        });

        await syncCategories(store, chain, silent);

        expect(chain.categoryState).toHaveBeenCalledTimes(1);
        expect(chain.categoryState).toHaveBeenCalledWith(2);
    });

    it('does not invent a category the registry says it does not know', async () => {
        // `categoryIds` and `categoryState` are two reads of a chain that can move between
        // them. An id that has gone is simply not stored.
        const chain = registry({}, [99]);

        await syncCategories(store, chain, silent);

        expect(store.chainCategories()).toEqual([]);
    });

    it('skips a language tag the registry padded to nothing', async () => {
        const chain = registry({ 12: { enabled: true, names: { '': 'Nameless', en: 'Football' } } });

        await syncCategories(store, chain, silent);

        expect(store.chainCategoryNames()).toEqual([{ id: 12, lang: 'en', meaning: 'Football' }]);
    });

    it('asks the chain for nothing when the index already has the whole registry', async () => {
        store.putChainCategory(1, true);
        store.putChainCategory(2, true);
        const chain = registry({ 1: { enabled: true, names: {} }, 2: { enabled: true, names: {} } });

        await syncCategories(store, chain, silent);

        expect(chain.categoryState).not.toHaveBeenCalled();
        expect(chain.categoryMeanings).not.toHaveBeenCalled();
    });
});
