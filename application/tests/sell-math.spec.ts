// The sell math is money: the ticket quotes from it and the transaction is built from it, so it
// must round exactly as the contract does. The vector below was read off a live market with
// `getReserves`, `feeBps` and `calcSell` - a one-wei drift from those numbers is a bug here.
import { describe, it, expect } from 'vitest';

import { sellCost, sellReturn } from '../src/lib/contracts.ts';

const reserves = [43857032042484635121n, 228013605442176870748n];
const feeBps = 300n;

describe('sell math', () =>
{
    it('matches the contract calcSell to the wei', () =>
    {
        expect(sellCost(reserves, 1, 1n, feeBps)).toBe(13n);
        expect(sellCost(reserves, 1, 370000000000000000n, feeBps)).toBe(2381974272403414657n);
        expect(sellCost(reserves, 1, 1000000000000000000n, feeBps)).toBe(6519766406083694435n);
    });

    it('refuses a payout the other side cannot cover', () =>
    {
        expect(sellCost(reserves, 1, reserves[0]!, feeBps)).toBeNull();
    });

    it('nets the most the shares can pay, and not a wei more', () =>
    {
        for (const shares of [1n, 10n ** 18n, 5n * 10n ** 18n, 200n * 10n ** 18n])
        {
            const net = sellReturn(reserves, 1, shares, feeBps);
            expect(sellCost(reserves, 1, net, feeBps)! <= shares).toBe(true);
            const next = sellCost(reserves, 1, net + 1n, feeBps);
            expect(next === null || next > shares).toBe(true);
        }
    });
});
