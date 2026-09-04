// Where Persian-digit bugs die. Every assertion pins an exact rendered string, because the
// failure mode in this domain is a mixed-script or mis-signed number that LOOKS plausible.
import { describe, it, expect } from 'vitest';

import {
    faDigits,
    formatMoney,
    formatVolume,
    formatOdds,
    formatOddsSet,
    formatFillPrice,
    formatShares,
    formatPoints,
    formatSigned,
    formatDate,
    formatDateTimeShort,
    formatDateTime
} from '../src/i18n/format.ts';

describe('faDigits', () => {
    it('maps every Latin digit to its Persian twin', () => {
        expect(faDigits('0123456789')).toBe('۰۱۲۳۴۵۶۷۸۹');
    });

    it('swaps the separators too - Persian thousands and decimal marks', () => {
        expect(faDigits('1,234.5')).toBe('۱٬۲۳۴٫۵');
    });

    it('leaves non-numeric text alone', () => {
        expect(faDigits('تومان $ abc')).toBe('تومان $ abc');
    });
});

describe('formatOdds - ONE convention, chosen by the reader', () => {
    it('renders cents in price mode and percent in percent mode', () => {
        expect(formatOdds(0.34, 'en', 'price')).toBe('34¢');
        expect(formatOdds(0.34, 'en', 'percent')).toBe('34%');
    });

    it('fa keeps Persian digits, sign leading in logical order', () => {
        expect(formatOdds(0.34, 'fa', 'price')).toBe('۳۴¢');
        expect(formatOdds(0.34, 'fa', 'percent')).toBe('٪۳۴');
    });

    it('never renders a LIVE outcome as 0 or 100 - both are lies about a tradeable market', () => {
        expect(formatOdds(0.004, 'en', 'price')).toBe('1¢');
        expect(formatOdds(0.996, 'en', 'percent')).toBe('99%');
    });

    it('lets a RESOLVED outcome say 0 or 100 honestly', () => {
        expect(formatOdds(0, 'en', 'percent')).toBe('0%');
        expect(formatOdds(1, 'en', 'percent')).toBe('100%');
    });

    it('renders a non-finite share as zero rather than NaN', () => {
        expect(formatOdds(Number.NaN, 'en', 'percent')).toBe('0%');
    });
});

describe('formatOddsSet - a displayed market always adds up', () => {
    const points = (values: readonly number[]): number[] =>
        formatOddsSet(values, 'en', 'percent').map((entry) => Number(entry.replace('%', '')));

    it('a binary pair sums to 100, where independent rounding gave 101', () => {
        expect(points([0.345, 0.655])).toEqual([35, 65]);
    });

    it('a three-way market sums to 100 in both directions', () => {
        expect(points([0.333, 0.333, 0.334]).reduce((a, b) => a + b, 0)).toBe(100);
        expect(points([0.335, 0.335, 0.33]).reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('normalizes a set the chain reports slightly off 1', () => {
        expect(points([0.5, 0.49]).reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('survives an all-zero set without dividing by zero', () => {
        expect(points([0, 0])).toEqual([0, 0]);
    });
});

describe('formatFillPrice - a realized fill is not a probability', () => {
    it('renders above 100¢, because the taker pays the fee on top', () => {
        expect(formatFillPrice(1.03, 'en')).toBe('103¢');
    });

    it('fa keeps Persian digits', () => {
        expect(formatFillPrice(0.34, 'fa')).toBe('۳۴¢');
    });
});

describe('formatShares', () => {
    it('keeps one decimal', () => {
        expect(formatShares(39.74, 'en')).toBe('39.7');
    });

    it('fa uses Persian digits - the whole reason this function exists', () => {
        expect(formatShares(39.7, 'fa')).toBe('۳۹٫۷');
    });
});

describe('formatPoints - a probability move, in percentage points', () => {
    it('renders a five-point move as 5.0, not 0.1', () => {
        expect(formatPoints(0.05, 'en')).toBe('+5.0');
    });

    it('signs a fall with a true minus', () => {
        expect(formatPoints(-0.023, 'en')).toBe('−2.3');
    });

    it('zero carries no sign', () => {
        expect(formatPoints(0, 'en')).toBe('0.0');
    });
});

describe('formatMoney - native token amounts', () => {
    it('en groups full amounts with the ticker', () => {
        expect(formatMoney(12400, 'en')).toBe('12,400 ETH');
    });

    it('en keeps crypto precision without fiat padding', () => {
        expect(formatMoney(1240.5, 'en')).toBe('1,240.5 ETH');
        expect(formatMoney(73.528, 'en')).toBe('73.528 ETH');
    });

    it('en compacts when asked', () => {
        expect(formatMoney(1_240_000, 'en', { compact: true })).toBe('1.2M ETH');
    });

    it('en never rounds a small real amount to zero', () => {
        expect(formatMoney(0.25, 'en')).toBe('0.25 ETH');
    });

    it('fa speaks scale words in Persian digits, ticker stays Latin', () => {
        expect(formatMoney(1_240_000, 'fa')).toBe('۱٫۲ میلیون ETH');
        expect(formatMoney(2_300, 'fa')).toBe('۲٫۳ هزار ETH');
    });

    it('fa keeps small amounts as grouped Persian digits', () => {
        expect(formatMoney(0.25, 'fa')).toBe('۰٫۲۵ ETH');
    });
});

describe('formatVolume', () => {
    it('en is always compact', () => {
        expect(formatVolume(3_400_000, 'en')).toBe('3.4M ETH');
        expect(formatVolume(870, 'en')).toBe('870 ETH');
    });

    it('fa mirrors the money scale words', () => {
        expect(formatVolume(3_400_000, 'fa')).toBe('۳٫۴ میلیون ETH');
    });
});

describe('formatSigned - profit and loss', () => {
    it('gains carry a plus', () => {
        expect(formatSigned(1250, 'en')).toBe('+1.3K ETH');
    });

    it('losses carry a true minus sign, not a hyphen', () => {
        expect(formatSigned(-40, 'en')).toBe('−40 ETH');
    });

    it('zero carries no sign', () => {
        expect(formatSigned(0, 'en')).toBe('0 ETH');
    });

    it('fa signs sit on Persian-digit amounts', () => {
        expect(formatSigned(-10, 'fa')).toBe('−۱۰ ETH');
    });
});

describe('formatDate', () => {
    it('en renders the Gregorian date', () => {
        expect(formatDate('2026-12-31T00:00:00Z', 'en')).toBe('Dec 31, 2026');
    });

    it('fa renders the Jalali calendar in Persian digits', () => {
        const rendered = formatDate('2026-12-31T00:00:00Z', 'fa');
        expect(rendered).toContain('۱۴۰۵');
        expect(rendered).not.toMatch(/[0-9]/);
    });

    it('the card chip form carries the numeric date AND the clock', () => {
        const rendered = formatDateTimeShort('2026-12-31T12:30:00Z', 'en');
        expect(rendered).toContain('12/31/2026');
        expect(rendered).toMatch(/\d{1,2}:\d{2}\s[AP]M/);
        const persian = formatDateTimeShort('2026-12-31T12:30:00Z', 'fa');
        expect(persian).toContain('۱۴۰۵');
        expect(persian).toMatch(/[۰-۹]{2}:[۰-۹]{2}/);
        expect(persian).not.toMatch(/[0-9]/);
    });

    it('the deadline form carries the clock', () => {
        const rendered = formatDateTime('2026-12-31T16:30:00Z', 'en');
        expect(rendered).toContain('Dec 31, 2026');
        expect(rendered).toMatch(/\d{1,2}:\d{2}/);
        const persian = formatDateTime('2026-12-31T16:30:00Z', 'fa');
        expect(persian).toContain('۱۴۰۵');
        expect(persian).toContain(':');
    });
});

describe('crypto amounts are not fiat amounts', () => {
    it('never renders a real sub-cent stake as zero', () => {
        // Two-decimal rounding - a currency convention - turned a 0.0005 ETH bet into "0 ETH",
        // the app telling a trader their stake was nothing.
        expect(formatMoney(0.0005, 'en')).toBe('0.0005 ETH');
        expect(formatMoney(0.004, 'en')).toBe('0.004 ETH');
    });

    it('keeps significant digits deep below one token', () => {
        expect(formatMoney(0.000012345, 'en')).toBe('0.00001235 ETH');
    });

    it('drops fiat-style trailing zeros', () => {
        expect(formatMoney(1.5, 'en')).toBe('1.5 ETH');
        expect(formatMoney(25, 'en')).toBe('25 ETH');
    });

    it('fa keeps the same precision in Persian digits', () => {
        expect(formatMoney(0.0005, 'fa')).toBe('۰٫۰۰۰۵ ETH');
    });
});
