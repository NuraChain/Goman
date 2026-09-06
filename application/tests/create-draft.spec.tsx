// Seeding the create draft from a venue's market. The mapping is pure and tested on its own;
// the store test proves the seed lands, that outcome ids stay unique afterwards, and that a
// reset clears the provenance with everything else. The draft store is a singleton, so the
// store test resets what it filled.
import { describe, it, expect } from 'vitest';

import type { DiscoveredMarket } from '../src/api.ts';

import { draftFromDiscovered, toLocalInput, useCreateDraft } from '../src/stores/create-draft.store.ts';

const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const DAY_MS = 24 * 60 * 60 * 1000;

const QUESTION = 'Will the Fed decrease interest rates by 25 bps after the September 2026 meeting?';
const RULES = 'Resolves to the change in the target range after the September meeting.';
const SOURCE = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';

function discovered(overrides: Partial<DiscoveredMarket> = {}): DiscoveredMarket {
    return {
        source: 'polymarket',
        sourceId: '2252243',
        question: QUESTION,
        url: 'https://polymarket.com/event/fed-decision-in-september',
        image: 'https://polymarket-upload.s3.us-east-2.amazonaws.com/jerome+powell.png',
        description: RULES,
        resolutionSource: SOURCE,
        category: 'economy',
        endsAt: '2026-09-16T00:00:00Z',
        volume: 30_000_000,
        liquidity: 3_000_000,
        outcomes: [
            { label: 'Yes', price: 0.0035 },
            { label: 'No', price: 0.9965 }
        ],
        match: null,
        ...overrides
    };
}

describe('draftFromDiscovered', () => {
    it('seeds the English half and leaves Persian to the admin, except the two universal answers', () => {
        const seed = draftFromDiscovered(discovered(), NOW);

        expect(seed.titleEn).toBe(QUESTION);
        expect(seed.category).toBe('economy');
        expect(seed.imageURI).toBe('https://polymarket-upload.s3.us-east-2.amazonaws.com/jerome+powell.png');
        expect(seed.outcomes).toEqual([
            { en: 'Yes', fa: 'بله', icon: '' },
            { en: 'No', fa: 'خیر', icon: '' }
        ]);
        expect(seed.source).toEqual({
            venue: 'Polymarket',
            url: 'https://polymarket.com/event/fed-decision-in-september'
        });
    });

    it('cites the resolution source exactly once', () => {
        expect(draftFromDiscovered(discovered(), NOW).descriptionEn).toBe(`${RULES}\n\nResolution source: ${SOURCE}`);

        const cited = discovered({ description: `See ${SOURCE} for the answer.` });
        expect(draftFromDiscovered(cited, NOW).descriptionEn).toBe(`See ${SOURCE} for the answer.`);
    });

    it('locks at the venue end date and resolves a day later, spelled for the input control', () => {
        const ends = new Date('2026-09-16T00:00:00Z').getTime();
        const seed = draftFromDiscovered(discovered(), NOW);

        expect(seed.lockAt).toBe(toLocalInput(ends));
        expect(seed.resolveAt).toBe(toLocalInput(ends + DAY_MS));
        expect(seed.lockAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    });

    it('seeds no timing at all when the venue market has already ended', () => {
        const seed = draftFromDiscovered(discovered({ endsAt: '2026-01-01T00:00:00Z' }), NOW);
        expect(seed.lockAt).toBe('');
        expect(seed.resolveAt).toBe('');
    });

    it('drops an image the form would reject', () => {
        expect(draftFromDiscovered(discovered({ image: 'https://cdn.example.com/a b.png' }), NOW).imageURI).toBe('');
        expect(draftFromDiscovered(discovered({ image: '' }), NOW).imageURI).toBe('');
    });

    it('leaves a label it cannot translate blank on the Persian side', () => {
        const race = discovered({
            outcomes: [
                { label: 'Manchester City', price: 0.6 },
                { label: 'Draw', price: 0.2 },
                { label: 'Coventry City', price: 0.2 }
            ]
        });
        expect(draftFromDiscovered(race, NOW).outcomes.map((outcome) => outcome.fa)).toEqual(['', '', '']);
    });
});

describe('create draft store import', () => {
    it('replaces the draft, records the source, keeps ids unique, and reset clears it all', () => {
        const draft = useCreateDraft.peek();
        draft.setTitleFa('پیش‌نویس قدیمی');
        draft.setLiquidity('250');

        draft.importDiscovered(discovered());

        expect(draft.titleEn()).toBe(QUESTION);
        expect(draft.titleFa()).toBe('');
        expect(draft.outcomes().map((outcome) => outcome.en)).toEqual(['Yes', 'No']);
        expect(draft.source()?.venue).toBe('Polymarket');
        // The platform's own numbers survive an import.
        expect(draft.liquidity()).toBe('250');

        draft.addOutcome();
        expect(draft.outcomes().map((outcome) => outcome.id)).toEqual([1, 2, 3]);

        draft.reset();
        expect(draft.source()).toBeNull();
        expect(draft.titleEn()).toBe('');
        expect(draft.liquidity()).toBe('');
    });
});
