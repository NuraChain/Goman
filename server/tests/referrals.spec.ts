// The referral program's arithmetic, away from the database. A wrong number here is money
// paid to the wrong person, so every rule the dashboard leans on is pinned: which tier pays
// what, what a sign-up counts as inside a window, and what an inactive referral is worth.
import { describe, it, expect } from 'vitest';

import { compose, pickCode, shareOf, slugCode, type JoinRow, type TradeRollup } from '../src/referrals.ts';

function join(account: string, at: number, code = 'link'): JoinRow {
    return { account, code, at };
}

function traded(fees: number, options: { trades?: number; volume?: number; lastAt?: number } = {}): TradeRollup {
    return {
        trades: options.trades ?? 1,
        volume: options.volume ?? 100,
        fees,
        lastAt: options.lastAt ?? 500
    };
}

describe('referral rates', () => {
    it('pays a tenth on a direct referral and a twentieth on an indirect one', () => {
        expect(shareOf(10, 'direct')).toBeCloseTo(1);
        expect(shareOf(10, 'indirect')).toBeCloseTo(0.5);
    });
});

describe('campaign codes', () => {
    it('slugs a name down to something that survives a query string', () => {
        expect(slugCode('My Twitter Push!')).toBe('my-twitter-push');
        expect(slugCode('  spaced  out  ')).toBe('spaced-out');
    });

    it('falls back rather than emitting an empty code for a non-Latin name', () => {
        // A Persian campaign name is legitimate; a percent-escaped code is not shareable.
        expect(slugCode('کمپین تلگرام')).toBe('ref');
    });

    it('adds a tail when the slug is already taken', () => {
        const code = pickCode(
            'Twitter',
            (candidate) => candidate === 'twitter',
            () => 0.5
        );
        expect(code).not.toBe('twitter');
        expect(code.startsWith('twitter-')).toBe(true);
    });
});

describe('dashboard composition', () => {
    it('splits the two tiers and totals only fees that were actually paid', () => {
        const rollup = new Map<string, TradeRollup>([
            ['0xa', traded(10)],
            ['0xb', traded(20)]
        ]);

        const { stats, referred } = compose([join('0xa', 100)], [join('0xb', 100)], rollup);

        expect(stats.directEarnings).toBeCloseTo(1);
        expect(stats.indirectEarnings).toBeCloseTo(1);
        expect(stats.earnings).toBeCloseTo(2);
        expect(stats.fees).toBeCloseTo(30);
        expect(referred.find((row) => row.address === '0xb')?.tier).toBe('indirect');
    });

    it('a referral who never traded is listed, counted as a sign-up, and worth zero', () => {
        const { stats, referred } = compose([join('0xa', 100)], [], new Map());

        expect(stats.signups).toBe(1);
        expect(stats.activeTraders).toBe(0);
        expect(stats.earnings).toBe(0);
        expect(referred[0]?.lastTradeAt).toBeNull();
    });

    it('counts sign-ups inside the window but keeps everyone in the roster', () => {
        const rollup = new Map<string, TradeRollup>([['0xold', traded(10)]]);

        // One joined before the window opened, one inside it. The older one is still trading,
        // so it still earns - the window filters when someone ARRIVED, not what they pay.
        const { stats, referred } = compose([join('0xold', 100), join('0xnew', 900)], [], rollup, 500);

        expect(stats.signups).toBe(1);
        expect(referred.length).toBe(2);
        expect(stats.earnings).toBeCloseTo(1);
    });

    it('names the campaign a direct referral arrived through, and none for an indirect one', () => {
        const { referred } = compose([join('0xa', 1, 'telegram')], [join('0xb', 1, 'telegram')], new Map());

        expect(referred.find((row) => row.address === '0xa')?.campaign).toBe('telegram');
        expect(referred.find((row) => row.address === '0xb')?.campaign).toBe('');
    });

    it('puts the biggest earners first', () => {
        const rollup = new Map<string, TradeRollup>([
            ['0xsmall', traded(1)],
            ['0xbig', traded(100)]
        ]);

        const { referred } = compose([join('0xsmall', 1), join('0xbig', 1)], [], rollup);

        expect(referred[0]?.address).toBe('0xbig');
    });
});
