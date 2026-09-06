// The trade ticket's amount block. The visible label must still resolve to the field now that
// the currency prefix shares a flex row with the input, and the quick-add buttons must carry
// the locale's digits and stay pinned LTR: a bare `+10` in an RTL row renders as `10+`,
// because the leading plus is bidi-neutral and drifts to the far side of the digits.
//
// The locale store is a singleton, so the test restores the language it flips.
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';

import type { Market } from '../src/api.ts';

import TradeTicket from '../src/components/market/trade-ticket.tsx';
import { useLocale } from '../src/stores/locale.store.ts';

// A pool market: no AMM quote, so rendering never reaches for the chain.
const market: Market = {
    id: 'm1',
    address: '0x0000000000000000000000000000000000000001',
    category: 'sports',
    emoji: '⚽',
    image: '',
    title: { en: 'Title', fa: 'عنوان' },
    rules: { en: 'Rules', fa: 'قوانین' },
    status: 'open',
    winningOutcomeId: null,
    kind: 'pool',
    noIndex: 1,
    outcomes: [
        { id: 'yes', index: 0, label: { en: 'Yes', fa: 'بله' }, icon: '', price: 0.5, change24h: 0 },
        { id: 'no', index: 1, label: { en: 'No', fa: 'خیر' }, icon: '', price: 0.5, change24h: 0 }
    ],
    volume: 0,
    liquidity: 0,
    endsAt: '2026-12-31T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    featured: false,
    trending: false
};

function mount(): ReturnType<typeof render> {
    return render(<TradeTicket market={market} outcome={market.outcomes[0]!} side="yes" onSideChange={() => {}} />);
}

function bumpButtons(container: Element): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('button[type="button"]')).filter((button) =>
        (button.textContent ?? '').startsWith('+')
    );
}

afterEach(() => {
    useLocale.peek().setLang('en');
});

describe('TradeTicket amount block', () => {
    it('keeps the visible label bound to the amount field', () => {
        const { getByRole } = mount();
        // Resolved by accessible name, not label text: the label also wraps the currency
        // prefix, which is aria-hidden and must stay out of the name.
        const input = getByRole('spinbutton', { name: 'Amount' });
        expect(input.closest('label')).not.toBeNull();
    });

    it('renders the quick-add steps in the locale digits, pinned LTR so the plus leads', () => {
        useLocale.peek().setLang('fa');
        const { container } = mount();

        const buttons = bumpButtons(container);
        expect(buttons.map((button) => button.textContent)).toEqual(['+۱۰', '+۵۰', '+۱۰۰', '+۵۰۰']);
        for (const button of buttons) {
            expect(button.getAttribute('dir')).toBe('ltr');
        }
    });
});
