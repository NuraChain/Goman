// The /live round cards. Three things here are worth a test and the rest is layout: the
// parimutuel payout label (which divides, and can divide by zero), the countdown formatter
// (whose digits must follow the locale), and the side-to-index map - the one mistake on this
// page that would place a bet on the OPPOSITE outcome without telling anyone.
//
// The locale store is a singleton, so every test that flips it restores it.
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';

import type { Round } from '../src/api.ts';

import RoundBetCard from '../src/components/live/round-bet-card.tsx';
import LockedRoundCard from '../src/components/live/locked-round-card.tsx';
import { payoutLabel, SIDE_INDEX } from '../src/components/live/side.ts';
import { formatCountdown, formatMultiplier, formatQuote } from '../src/i18n/format.ts';
import { useLocale } from '../src/stores/locale.store.ts';

const NOW = Date.parse('2026-09-10T12:00:00.000Z');

function round(overrides: Partial<Round> = {}): Round {
    return {
        epoch: 1_800_000_000,
        state: 'open',
        marketId: '7',
        address: '0x0000000000000000000000000000000000000001',
        opensAt: new Date(NOW).toISOString(),
        locksAt: new Date(NOW + 125_000).toISOString(),
        closesAt: new Date(NOW + 425_000).toISOString(),
        lockPrice: null,
        closePrice: null,
        priceSource: null,
        upPool: 0,
        downPool: 0,
        winner: null,
        settleTx: null,
        ...overrides
    };
}

afterEach(() => {
    useLocale.peek().setLang('en');
});

describe('side mapping', () => {
    it('pins Up to outcome 0 and Down to outcome 1', () => {
        // These ARE the arguments `bet()` is called with. Swapping them silently reverses
        // every wager on the page, so the map is asserted rather than trusted.
        expect(SIDE_INDEX.up).toBe(0);
        expect(SIDE_INDEX.down).toBe(1);
    });
});

describe('payout label', () => {
    it('reads as the multiple of the whole pot the side would take', () => {
        const entry = round({ upPool: 25, downPool: 75 });
        expect(payoutLabel(entry, 'up', 'en')).toBe(formatMultiplier(4, 'en'));
        expect(payoutLabel(entry, 'down', 'en')).toBe(formatMultiplier(100 / 75, 'en'));
    });

    it('shows an em dash for an empty side instead of dividing by zero', () => {
        const entry = round({ upPool: 0, downPool: 10 });
        expect(payoutLabel(entry, 'up', 'en')).toBe('—');
        expect(payoutLabel(entry, 'down', 'en')).toBe(formatMultiplier(1, 'en'));
    });

    it('shows an em dash for a round nobody has bet on at all', () => {
        expect(payoutLabel(round(), 'up', 'en')).toBe('—');
        expect(payoutLabel(round(), 'down', 'en')).toBe('—');
    });
});

describe('countdown', () => {
    it('pads the seconds and never counts past a passed deadline', () => {
        expect(formatCountdown(125, 'en')).toBe('2:05');
        expect(formatCountdown(0, 'en')).toBe('0:00');
        expect(formatCountdown(-30, 'en')).toBe('0:00');
    });

    it('renders Persian digits under fa, so a countdown cannot mix numeral systems', () => {
        expect(formatCountdown(125, 'fa')).toBe('۲:۰۵');
    });
});

describe('RoundBetCard', () => {
    it('counts down to the lock, not to the settlement', () => {
        const { container } = render(<RoundBetCard round={round()} now={NOW} />);
        expect(container.textContent).toContain('2:05');
    });

    it('offers a connect prompt rather than a bet button while signed out', () => {
        const { container } = render(<RoundBetCard round={round()} now={NOW} />);
        expect(container.textContent).not.toContain('Bet Up');
        expect(container.textContent).toContain('Connect');
    });

    it('goes inert once the betting window has closed', () => {
        const { container } = render(<RoundBetCard round={round()} now={NOW + 200_000} />);
        const buttons = Array.from(container.querySelectorAll('button')).filter(
            (button) => (button.textContent ?? '').trim() !== '' && !/^\d+$/.test((button.textContent ?? '').trim())
        );
        expect(buttons.length).toBeGreaterThan(0);
        for (const button of buttons) {
            expect(button.disabled).toBe(true);
        }
    });
});

describe('LockedRoundCard', () => {
    const locked = round({ state: 'locked', lockPrice: 108_000, upPool: 4, downPool: 6 });
    const price = { symbol: 'btc/usd', value: 108_250.5, windowSeconds: 60, at: '', source: 'test' };

    it('shows the move against the LOCK price, not against zero', () => {
        const { container } = render(<LockedRoundCard round={locked} price={price} now={NOW} />);
        expect(container.textContent).toContain(formatQuote(108_000, 'en'));
        expect(container.textContent).toContain(formatQuote(108_250.5, 'en'));
        expect(container.textContent).toContain(`+${formatQuote(250.5, 'en')}`);
    });

    it('renders an em dash rather than a bogus move while the feed is down', () => {
        const { container } = render(<LockedRoundCard round={locked} price={null} now={NOW} />);
        expect(container.textContent).toContain('—');
        expect(container.textContent).not.toContain('+0.00');
    });

    it('keeps prices in a Latin run under RTL, where a bidi flip would reorder the digits', () => {
        useLocale.peek().setLang('fa');
        const { container } = render(<LockedRoundCard round={locked} price={price} now={NOW} />);
        const runs = Array.from(container.querySelectorAll('[dir="ltr"]'));
        expect(runs.length).toBeGreaterThan(0);
    });
});
