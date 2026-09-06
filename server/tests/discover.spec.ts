// The discovery MATCHER, which is the half of market discovery that can be wrong quietly.
// A false "already here" is the expensive error - it hides a market nobody then creates - so
// every case below is one that scored as a match during development and should not.
//
// Pure functions only: no fetch, no network, no Polymarket. The crawl itself is exercised by
// hand against the live feed; a suite that reaches the internet is a suite that fails offline.
import { describe, it, expect } from 'vitest';

import { categoryOf, fromEvent, matchAgainst, normalize, similarity, tokenize, idfOf } from '../src/discover.ts';
import { DISCOVER_TOPICS, type DiscoveredMarket } from '../src/wire.ts';

function row(question: string): DiscoveredMarket {
    return {
        source: 'polymarket',
        sourceId: question,
        question,
        url: '',
        image: '',
        description: '',
        resolutionSource: '',
        category: '',
        endsAt: '',
        volume: 0,
        liquidity: 0,
        outcomes: [],
        match: null
    };
}

/** The score two questions get when weighed against a corpus of just the two of them. */
function score(a: string, b: string): number {
    const left = tokenize(a);
    const right = tokenize(b);
    return similarity(left, right, idfOf([left, right]));
}

describe('discovery matching', () => {
    it('scores a question against itself as a full match', () => {
        expect(score('Will BTC reach $150k by Dec 31, 2026?', 'Will BTC reach $150k by Dec 31, 2026?')).toBe(1);
    });

    it('folds short and long month names into the same date', () => {
        expect(score('Will BTC reach $150k by Dec 31, 2026', 'Will BTC reach $150k by December 31, 2026')).toBe(1);
    });

    it('splits two questions that differ only by their resolution month', () => {
        // These share every other word. No threshold that keeps real rewordings can also split
        // them, which is why a differing date disqualifies outright.
        const a = 'Will there be no change in Fed interest rates after the September meeting?';
        const b = 'Will there be no change in Fed interest rates after the October meeting?';
        expect(score(a, b)).toBe(0);
    });

    it('does not match two assets that share a date and a verb', () => {
        // The original false positive: `reach`, `31` and `2026` were enough to pair these.
        const a = 'Will Ethereum reach $7,500 by December 31, 2026?';
        const b = 'Will BTC reach $150k by December 31, 2026?';
        expect(score(a, b)).toBeLessThan(0.6);
    });

    it('needs more than one shared word to call anything a match', () => {
        expect(score('Bitcoin', 'Bitcoin above 100k')).toBe(0);
    });

    it('reports a market with no counterpart as missing, and one with a counterpart as matched', () => {
        const rows = [row('Will Bitcoin reach $150k by December 31, 2026?'), row('US Open ATP: Zverev vs Halys')];
        const local = [{ id: '7', title: 'Will Bitcoin reach $150k by December 31, 2026?' }];

        const matched = matchAgainst(rows, local);

        expect(matched[0].match).not.toBeNull();
        expect(matched[0].match?.id).toBe('7');
        expect(matched[1].match).toBeNull();
    });

    it('picks the closest local market when several are close', () => {
        const rows = [row('Will Ethereum reach $8,000 by December 31, 2026?')];
        const local = [
            { id: '1', title: 'Will Ethereum reach $8,000 by December 31, 2026?' },
            { id: '2', title: 'Will Ethereum reach $8,000 by December 31, 2026 on Coinbase?' }
        ];

        expect(matchAgainst(rows, local)[0].match?.id).toBe('1');
    });
});

describe('discovery normalisation', () => {
    it('carries the venue rules, resolution source, answers and a mapped category', () => {
        const entry = normalize({
            id: '42',
            question: 'Will the Fed cut rates in September?',
            slug: 'fed-cut-september',
            description: '  Resolves YES if the FOMC lowers the target range.  ',
            image: 'https://example.com/fed.png',
            state: { active: true, closed: false, archived: false, endDate: '2026-09-16T00:00:00Z' },
            outcomes: { yes: { label: 'Yes', price: '0.2' }, no: { label: 'No', price: '0.8' } },
            metrics: { volumeNum: '1000', liquidityNum: '250' },
            resolution: { source: 'https://www.federalreserve.gov/' },
            tags: [{ label: 'Fed Rates', slug: 'fed-rates' }],
            events: [{ slug: 'fed-decision-september' }]
        });

        expect(entry).not.toBeNull();
        expect(entry?.description).toBe('Resolves YES if the FOMC lowers the target range.');
        expect(entry?.resolutionSource).toBe('https://www.federalreserve.gov/');
        expect(entry?.category).toBe('economy');
        expect(entry?.endsAt).toBe('2026-09-16T00:00:00Z');
        expect(entry?.volume).toBe(1000);
        expect(entry?.liquidity).toBe(250);
        expect(entry?.url).toBe('https://polymarket.com/event/fed-decision-september');
        expect(entry?.outcomes).toEqual([
            { label: 'Yes', price: 0.2 },
            { label: 'No', price: 0.8 }
        ]);
    });

    it('reads a row with none of the optional fields as empty strings, not undefined', () => {
        const entry = normalize({ id: '1', question: 'Anything?' });
        expect(entry?.description).toBe('');
        expect(entry?.resolutionSource).toBe('');
        expect(entry?.category).toBe('');
        expect(entry?.outcomes).toEqual([]);
    });

    it('drops a market that can no longer be traded there', () => {
        expect(normalize({ id: '2', question: 'Done?', state: { closed: true } })).toBeNull();
        expect(normalize({ id: '3', question: 'Gone?', state: { archived: true } })).toBeNull();
        expect(normalize({ id: '4', question: 'Not yet?', state: { active: false } })).toBeNull();
    });

    it('reads a search result through its event: open markets only, tagged by the event', () => {
        const rows = fromEvent({
            slug: 'fed-decision-september',
            state: { closed: false },
            tags: [{ slug: 'fed-rates' }],
            markets: [
                {
                    id: '10',
                    question: 'Will the Fed cut 25 bps?',
                    outcomes: { yes: { label: 'Yes', price: '0.3' }, no: { label: 'No', price: '0.7' } }
                },
                { id: '11', question: 'Will the Fed cut 50 bps?', state: { closed: true } }
            ]
        });

        expect(rows.map((row) => row.sourceId)).toEqual(['10']);
        expect(rows[0]?.category).toBe('economy');
        expect(rows[0]?.url).toBe('https://polymarket.com/event/fed-decision-september');
    });

    it('reads nothing out of an event that has ended', () => {
        expect(fromEvent({ slug: 'over', state: { closed: true }, markets: [{ id: '1', question: 'x?' }] })).toEqual(
            []
        );
    });
});

describe('tag categories', () => {
    it('takes the first tag that names a registry category, in the venue order', () => {
        expect(categoryOf([{ slug: 'cpi-release' }, { slug: 'jobs-report' }])).toBe('economy');
        expect(categoryOf([{ slug: 'trump' }, { slug: 'tariffs' }])).toBe('politics');
        expect(categoryOf([{ slug: 'tariffs' }, { slug: 'trump' }])).toBe('economy');
    });

    it('tries the whole slug before its words', () => {
        // "world" alone is world; the tournament is sports.
        expect(categoryOf([{ slug: 'world-cup' }])).toBe('sports');
        expect(categoryOf([{ label: 'NBA Trade', slug: 'nba-trade' }])).toBe('sports');
    });

    it('falls back to the label when a tag has no slug', () => {
        expect(categoryOf([{ label: 'Bitcoin' }])).toBe('crypto');
    });

    it('leaves the category to the admin when nothing maps', () => {
        expect(categoryOf([{ slug: 'weekly' }, { slug: 'recurring' }])).toBe('');
        expect(categoryOf([])).toBe('');
    });
});

describe('crawlable topics', () => {
    it('every topic lands in a registry category, so a draft seeded from one arrives categorised', () => {
        for (const topic of DISCOVER_TOPICS) {
            expect(categoryOf([{ slug: topic }]), topic).not.toBe('');
        }
    });
});
