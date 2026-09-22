// The address check every admin field gates on. It is here because the shape of the regex is
// the whole thing: a spaced quantifier still COMPILES and still tests, and what it silently
// becomes is a matcher no real address can pass.
import { describe, it, expect } from 'vitest';

import { isWalletAddress, shortAddress } from '../src/lib/wallet.ts';

describe('isWalletAddress', () =>
{
    it('takes a real address whatever case it was pasted in', () =>
    {
        const mixed = '0x6C1BD367efCc5F57F2812B404D83480C2AF77987';
        expect(isWalletAddress(mixed)).toBe(true);
        expect(isWalletAddress(mixed.toLowerCase())).toBe(true);
        expect(isWalletAddress(mixed.toUpperCase().replace('0X', '0x'))).toBe(true);
    });

    it('refuses what is not one', () =>
    {
        expect(isWalletAddress('')).toBe(false);
        expect(isWalletAddress('0x')).toBe(false);
        // 39 and 41 hex digits: the length is the part a broken quantifier stops enforcing.
        expect(isWalletAddress(`0x${ 'a'.repeat(39) }`)).toBe(false);
        expect(isWalletAddress(`0x${ 'a'.repeat(41) }`)).toBe(false);
        expect(isWalletAddress('6C1BD367efCc5F57F2812B404D83480C2AF77987')).toBe(false);
        expect(isWalletAddress(`0x${ 'g'.repeat(40) }`)).toBe(false);
        expect(isWalletAddress(` 0x${ 'a'.repeat(40) } `)).toBe(false);
    });
});

describe('shortAddress', () =>
{
    it('keeps both ends, which is what makes two addresses tellable apart', () =>
    {
        expect(shortAddress('0x6C1BD367efCc5F57F2812B404D83480C2AF77987')).toBe('0x6C1B...7987');
    });
});
