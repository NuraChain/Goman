// Corrections to a market that is already deployed.
//
// Nothing in the contracts can be edited after `initialize`, so every guarantee here is one
// this code has to keep on its own: that the chain's own text survives an edit, that a second
// edit does not eat the first one's snapshot, and that a replay of the chain - which drops and
// rebuilds the markets table - does not silently undo a correction.
import { describe, it, expect, beforeEach } from 'vitest';

import { IndexStore, type MarketRow, type OutcomeRow } from '../src/chain/store.ts';
import {
    chainTextOf,
    normalise,
    outcomeCountMismatch,
    reapply,
    reshapesBinary,
    revertText,
    saveText,
    textOf,
    type MarketText
} from '../src/overrides.ts';

/** The factory a fixture index is built from; the store starts over when it changes. */
const FACTORY = '0xfac70aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const EDITOR = '0xAdM1n';

function marketRow(id: number, overrides: Partial<MarketRow> = {}): MarketRow
{
    return {
        id,
        address: `0x${ String(id + 1).padStart(40, '0') }`,
        status: 0,
        category: 'crypto',
        title_json: JSON.stringify({ en: 'Wil BTC hit 100k?', fa: 'آیا بیت‌کوین به ۱۰۰ هزار می‌رسد؟' }),
        emoji: '₿',
        rules_json: JSON.stringify({ en: 'Resolves on Coinbase spot.' }),
        image: 'https://cdn.example/btc.png',
        creator: '0xcafe',
        created_at: 1000,
        lock_time: 5000,
        resolve_time: 9000,
        outcome_count: 2,
        volume: 0,
        liquidity: 100,
        collected: 0,
        winning_outcome: null,
        featured: 0,
        search_text: 'wil btc hit 100k? resolves on coinbase spot. crypto yes no',
        kind: 0,
        ...overrides
    };
}

function outcomes(marketId: number, labels: string[]): OutcomeRow[]
{
    return labels.map((label, idx) => ({
        market_id: marketId,
        idx,
        oid: label.toLowerCase(),
        label_json: JSON.stringify({ en: label }),
        icon: '',
        price: 1 / labels.length
    }));
}

/** The market's current text with `patch` applied - what a dialog would submit. */
async function submitted(store: IndexStore, id: number, patch: Partial<MarketText>): Promise<MarketText>
{
    return normalise({ ...(await textOf(store, id) as MarketText), ...patch });
}

describe('post-deploy market corrections', () =>
{
    let store: IndexStore;

    beforeEach(async () =>
    {
        store = await IndexStore.open(':memory:');
        await store.insertMarket(marketRow(1), outcomes(1, ['Yes', 'No']));
    });

    it('changes what the index presents', async () =>
    {
        await saveText(store, 1, await submitted(store, 1, { title: { en: 'Will BTC hit 100k?' } }), EDITOR, 100);
        expect((await textOf(store, 1))?.title.en).toBe('Will BTC hit 100k?');
    });

    it('keeps the chain text, and puts it back on revert', async () =>
    {
        await saveText(store, 1, await submitted(store, 1, { title: { en: 'Will BTC hit 100k?' } }), EDITOR, 100);
        expect((await chainTextOf(store, 1))?.title.en).toBe('Wil BTC hit 100k?');

        expect(await revertText(store, 1)).toBe(true);
        expect((await textOf(store, 1))?.title.en).toBe('Wil BTC hit 100k?');
        expect(await store.overrideOf(1)).toBeNull();
    });

    // The bug this guards is unrecoverable rather than merely wrong: record the first edit as
    // the original and the market can never be put back to what was deployed.
    it('does not let a second edit overwrite the snapshot of the chain text', async () =>
    {
        await saveText(store, 1, await submitted(store, 1, { title: { en: 'First correction' } }), EDITOR, 100);
        await saveText(store, 1, await submitted(store, 1, { title: { en: 'Second correction' } }), EDITOR, 200);

        expect((await textOf(store, 1))?.title.en).toBe('Second correction');
        expect((await chainTextOf(store, 1))?.title.en).toBe('Wil BTC hit 100k?');
        await revertText(store, 1);
        expect((await textOf(store, 1))?.title.en).toBe('Wil BTC hit 100k?');
    });

    it('drops the correction when the submitted text matches the chain again', async () =>
    {
        const original = await chainTextOf(store, 1) as MarketText;
        await saveText(store, 1, await submitted(store, 1, { title: { en: 'Will BTC hit 100k?' } }), EDITOR, 100);
        const back = await saveText(store, 1, await submitted(store, 1, { title: original.title }), EDITOR, 200);

        expect(back.edited).toBe(false);
        expect(await store.overrideOf(1)).toBeNull();
        expect((await textOf(store, 1))?.title.en).toBe('Wil BTC hit 100k?');
    });

    it('records only the fields that actually differ', async () =>
    {
        await saveText(store, 1, await submitted(store, 1, { image: 'https://cdn.example/btc-2.png' }), EDITOR, 100);
        const patch = JSON.parse((await store.overrideOf(1))?.patch_json ?? '{}') as Record<string, unknown>;
        expect(Object.keys(patch)).toEqual(['image']);
    });

    // A correction that is not folded back into the haystack leaves a market findable only
    // by the text it was corrected for.
    it('makes the correction searchable and the displaced text not', async () =>
    {
        await saveText(store, 1, await submitted(store, 1, { rules: { en: 'Resolves on Kraken spot.' } }), EDITOR, 100);

        expect((await store.listMarkets({ search: 'kraken', sort: 'newest', page: 1, limit: 10 })).total).toBe(1);
        expect((await store.listMarkets({ search: 'coinbase', sort: 'newest', page: 1, limit: 10 })).total).toBe(0);
    });

    it('moves the market between category filters', async () =>
    {
        await saveText(store, 1, await submitted(store, 1, { category: 'Economy' }), EDITOR, 100);

        expect((await store.listMarkets({ category: 'economy', sort: 'newest', page: 1, limit: 10 })).total).toBe(1);
        expect((await store.listMarkets({ category: 'crypto', sort: 'newest', page: 1, limit: 10 })).total).toBe(0);
    });

    it('rewrites outcome labels without renaming the outcome itself', async () =>
    {
        await store.insertMarket(marketRow(2), outcomes(2, ['Alice', 'Bob', 'Carol']));
        const next = await submitted(store, 2, {
            outcomes: [
                { label: { en: 'Alice Smith' }, icon: '' },
                { label: { en: 'Bob' }, icon: '' },
                { label: { en: 'Carol' }, icon: '' }
            ]
        });
        await saveText(store, 2, next, EDITOR, 100);

        const rows = await store.outcomesOf(2);
        expect(JSON.parse(rows[0].label_json).en).toBe('Alice Smith');
        // The id every recorded trade and open position is presented against, unchanged.
        expect(rows[0].oid).toBe('alice');
    });

    describe('surviving a replay of the chain', () =>
    {
        it('puts the correction back after the markets table is rebuilt', async () =>
        {
            await saveText(store, 1, await submitted(store, 1, { title: { en: 'Will BTC hit 100k?' } }), EDITOR, 100);

            // What a schema bump does: the derived rows go, the chain refills them.
            await store.setMarketText(1, {
                title_json: marketRow(1).title_json,
                emoji: '₿',
                rules_json: marketRow(1).rules_json,
                image: marketRow(1).image,
                category: 'crypto',
                search_text: marketRow(1).search_text
            });
            expect((await textOf(store, 1))?.title.en).toBe('Wil BTC hit 100k?');

            await reapply(store, 1);
            expect((await textOf(store, 1))?.title.en).toBe('Will BTC hit 100k?');
        });

        it('is idempotent, so a re-run never records the correction as the original', async () =>
        {
            await saveText(store, 1, await submitted(store, 1, { title: { en: 'Will BTC hit 100k?' } }), EDITOR, 100);
            await reapply(store, 1);
            await reapply(store, 1);

            expect((await chainTextOf(store, 1))?.title.en).toBe('Wil BTC hit 100k?');
            await revertText(store, 1);
            expect((await textOf(store, 1))?.title.en).toBe('Wil BTC hit 100k?');
        });

        it('does nothing for a market nobody has corrected', async () =>
        {
            await reapply(store, 1);
            expect((await textOf(store, 1))?.title.en).toBe('Wil BTC hit 100k?');
            expect(await store.overrideOf(1)).toBeNull();
        });
    });

    describe('the guards', () =>
    {
        it('catches an outcome list that is not the market width', async () =>
        {
            const current = await textOf(store, 1) as MarketText;
            const next = { ...current, outcomes: [{ label: { en: 'Yes' }, icon: '' }] };
            expect(outcomeCountMismatch(current, next)).toBe(true);
        });

        // Renaming the legs of a Yes/No market swaps the whole trading UI - a probability ring
        // for one side becomes a list of two - under people already holding positions.
        it('catches an English rename that would stop a market reading as Yes/No', async () =>
        {
            const current = await textOf(store, 1) as MarketText;
            const next = {
                ...current,
                outcomes: [
                    { label: { en: 'Definitely' }, icon: '' },
                    { label: { en: 'No' }, icon: '' }
                ]
            };
            expect(reshapesBinary(current, next)).toBe(true);
        });

        it('allows translating those same legs, which is where a rename is actually needed', async () =>
        {
            const current = await textOf(store, 1) as MarketText;
            const next = {
                ...current,
                outcomes: [
                    { label: { en: 'Yes', fa: 'بله' }, icon: '' },
                    { label: { en: 'No', fa: 'خیر' }, icon: '' }
                ]
            };
            expect(reshapesBinary(current, next)).toBe(false);

            await saveText(store, 1, normalise(next), EDITOR, 100);
            expect(JSON.parse((await store.outcomesOf(1))[0].label_json).fa).toBe('بله');
        });

        it('drops empty translations rather than storing ten blank keys', () =>
        {
            const clean = normalise({
                title: { en: ' Trimmed ', fa: '' },
                emoji: ' ₿ ',
                rules: { en: 'ok' },
                image: ' https://x/y.png ',
                category: ' Crypto ',
                tags: [' Iran Football ', 'IRAN football', '!!!'],
                outcomes: [{ label: { en: 'Yes', ar: '' }, icon: ' ' }]
            });
            expect(clean.title).toEqual({ en: ' Trimmed ' });
            expect(clean.category).toBe('crypto');
            // One subject, not three: the second spelling is the same slug and the third is
            // no word at all.
            expect(clean.tags).toEqual(['Iran Football']);
            expect(clean.outcomes[0].label).toEqual({ en: 'Yes' });
        });
    });

    it('leaves a correction behind when the chain underneath changes', async () =>
    {
        await saveText(store, 1, await submitted(store, 1, { title: { en: 'Will BTC hit 100k?' } }), EDITOR, 100);
        await store.ensureChain('0xgenesis-one', FACTORY);
        // A market id on a different chain is a different market, so the correction must not
        // survive to land on a stranger.
        await store.ensureChain('0xgenesis-two', FACTORY);
        expect(await store.overrideOf(1)).toBeNull();
    });
});
