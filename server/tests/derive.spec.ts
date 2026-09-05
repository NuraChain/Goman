// The pure derivations: the metadata envelope, series bucketing, P&L replay, and the
// leaderboard merge. Everything here is what makes the indexer testable without a chain.
import { describe, it, expect } from 'vitest';

import { decodeTextMeta, decodeTitleMeta, encodeTextMeta, encodeTitleMeta } from '../src/schemas.ts';
import { bucketSeries, isBinaryPair, leaderboard, outcomeId, profitCurve, vwap } from '../src/derive.ts';

describe('metadata envelope', () => {
    it('round-trips a bilingual title with emoji', () => {
        const raw = encodeTitleMeta({ en: 'Bitcoin above $150k?', fa: 'بیت‌کوین بالای ۱۵۰ هزار؟', emoji: '₿' });
        expect(decodeTitleMeta(raw, 'X')).toEqual({
            en: 'Bitcoin above $150k?',
            fa: 'بیت‌کوین بالای ۱۵۰ هزار؟',
            emoji: '₿'
        });
    });

    it('falls back to the plain string in both languages', () => {
        expect(decodeTitleMeta('Plain title', '\u{1F9ED}')).toEqual({
            en: 'Plain title',
            fa: 'Plain title',
            emoji: '\u{1F9ED}'
        });
        expect(decodeTextMeta('Plain rules')).toEqual({ en: 'Plain rules', fa: 'Plain rules' });
    });

    it('treats malformed JSON and foreign envelopes as plain strings', () => {
        expect(decodeTextMeta('{broken').en).toBe('{broken');
        expect(decodeTextMeta('{"v":2,"en":"nope"}').en).toBe('{"v":2,"en":"nope"}');
    });

    it('an empty fa falls back to en', () => {
        expect(decodeTextMeta(encodeTextMeta({ en: 'Only English', fa: '' })).fa).toBe('Only English');
    });
});

describe('outcome identity', () => {
    it('slugs labels and survives non-latin ones', () => {
        expect(outcomeId('Real Madrid', 0)).toBe('real-madrid');
        expect(outcomeId('رئال مادرید', 2)).toBe('outcome-2');
    });

    it('detects the binary Yes/No pair case-insensitively', () => {
        expect(
            isBinaryPair([
                { en: 'Yes', fa: 'بله' },
                { en: 'no', fa: 'خیر' }
            ])
        ).toBe(true);
        expect(
            isBinaryPair([
                { en: 'Yes', fa: '' },
                { en: 'Maybe', fa: '' }
            ])
        ).toBe(false);
        expect(isBinaryPair([{ en: 'Yes', fa: '' }])).toBe(false);
    });
});

describe('bucketSeries', () => {
    it('emits 40 even points, carries the last mark, and pins the end to the live price', () => {
        const now = 1_000_000;
        const points = [
            { at: now - 900, price: 0.4 },
            { at: now - 500, price: 0.6 }
        ];
        const series = bucketSeries(points, now - 1000, now, 0.65);
        expect(series.length).toBe(40);
        expect(series[0].p).toBe(0.4);
        expect(series[25].p).toBe(0.6);
        expect(series[39].p).toBe(0.65);
        for (const point of series) {
            expect(point.p).toBeGreaterThanOrEqual(0);
            expect(point.p).toBeLessThanOrEqual(1);
        }
    });

    it('a market with no trades draws a flat line at the current price', () => {
        const series = bucketSeries([], 0, 500_000, 0.5);
        expect(new Set(series.map((point) => point.p))).toEqual(new Set([0.5]));
    });
});

describe('P&L', () => {
    it('vwap divides amount by shares and clamps', () => {
        expect(vwap(5, 10)).toBe(0.5);
        expect(vwap(0, 0)).toBe(0);
    });

    it('profitCurve replays cash flow plus mark-to-market', () => {
        const trades = [
            {
                id: 'a',
                market_id: 1,
                account: 'x',
                outcome_idx: 0,
                action: 'buy',
                amount: 5,
                shares: 10,
                price: 0.5,
                fee: 0,
                at: 100,
                block: 1
            },
            {
                id: 'b',
                market_id: 1,
                account: 'x',
                outcome_idx: 0,
                action: 'sell',
                amount: 4,
                shares: 5,
                price: 0.8,
                fee: 0,
                at: 300,
                block: 3
            }
        ];
        const priceAt = (_market: number, _idx: number, at: number): number => (at < 200 ? 0.5 : 0.8);
        const curve = profitCurve(trades, [], [150, 250, 400], priceAt);

        // t=150: spent 5, hold 10 @0.5 -> 0. t=250: -5 + 10*0.8 = 3. t=400: -5 +4 + 5*0.8 = 3.
        expect(curve.map((point) => point.p)).toEqual([0, 3, 3]);
    });

    it('claims land as pure cash', () => {
        const curve = profitCurve([], [{ market_id: 1, amount: 7, at: 50 }], [100], () => null);
        expect(curve[0].p).toBe(7);
    });
});

describe('leaderboard', () => {
    const PROFIT: Record<string, number> = { a: 10, b: 5 };

    it("ranks the window's traders by the profit the caller measured", () => {
        const rows = leaderboard(
            [
                { account: 'a', flow: -10, volume: 10 },
                { account: 'b', flow: 2, volume: 6 }
            ],
            (account) => PROFIT[account] ?? 0,
            10
        );
        expect(rows[0]).toEqual({ rank: 1, address: 'a', profit: 10, volume: 10 });
        expect(rows[1]).toEqual({ rank: 2, address: 'b', profit: 5, volume: 6 });
    });

    it('lists only accounts that traded in the window', () => {
        expect(leaderboard([], () => 3, 10).length).toBe(0);
    });

    it('a buyer who still holds the shares is not reported as down what they spent', () => {
        // The defect this shape replaced: profit was the window's CASH FLOW alone, so a buy of
        // 10 read as -10 while the shares it bought were worth 10.
        const bought = profitCurve(
            [
                {
                    id: 't1',
                    account: 'a',
                    market_id: 1,
                    outcome_idx: 0,
                    action: 'buy',
                    amount: 10,
                    shares: 20,
                    price: 0.5,
                    fee: 0,
                    at: 50,
                    block: 1
                }
            ],
            [],
            [40, 100],
            () => 0.5
        );
        const windowed = (bought[1]?.p ?? 0) - (bought[0]?.p ?? 0);
        expect(windowed).toBeCloseTo(0, 6);
        expect(leaderboard([{ account: 'a', flow: -10, volume: 10 }], () => windowed, 10)[0]?.profit).toBeCloseTo(0, 6);
    });
});
