// The Claim button on the market page. A settled market is the only surface a holder has
// there - no trade ticket, no buy bar - so a wallet with a redeemable position must be able
// to act from the page itself rather than hunting for the portfolio.
//
// The session and locale stores are singletons, so this file restores both.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';

import type { Market, Position } from '../src/api.ts';

const ADDRESS = '0x430b4409891c6A821c81e92C960c94A80Ef626dc';

const market: Market = {
    id: 'm5',
    address: '0x0000000000000000000000000000000000000005',
    category: 'sports',
    emoji: '⚽',
    image: '',
    title: { en: 'Malavan vs Foolad', fa: 'ملوان مقابل فولاد' },
    rules: { en: 'Rules', fa: 'قوانین' },
    status: 'voided',
    winningOutcomeId: null,
    kind: 'amm',
    noIndex: null,
    outcomes: [
        { id: 'a', index: 0, label: { en: 'Malavan', fa: 'ملوان' }, icon: '', price: 0.33, change24h: 0 },
        { id: 'b', index: 1, label: { en: 'Foolad', fa: 'فولاد' }, icon: '', price: 0.33, change24h: 0 },
        { id: 'c', index: 2, label: { en: 'Draw', fa: 'مساوی' }, icon: '', price: 0.34, change24h: 0 }
    ],
    volume: 200,
    liquidity: 200,
    endsAt: '2026-09-11T00:00:00.000Z',
    startsAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    featured: false,
    trending: false
};

function position(marketId: string, claimable: boolean): Position {
    return {
        id: `${marketId}/c`,
        marketId,
        outcomeId: 'c',
        side: 'yes',
        shares: 195,
        avgPrice: 1.03,
        openedAt: '2026-09-10T00:00:00.000Z',
        claimable,
        market
    };
}

const positions = vi.fn(async (): Promise<Position[]> => []);

vi.mock('../src/api.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/api.ts')>();
    return {
        ...actual,
        client: {
            markets: {
                one: async () => market,
                series: async () => ({ points: [] }),
                activity: async () => ({ rows: [], total: 0, page: 1, pages: 1 }),
                holders: async () => ({ rows: [], total: 0, page: 1, pages: 1 }),
                list: async () => ({ rows: [], total: 0, page: 1, pages: 1 })
            },
            categories: { list: async () => [] },
            chain: { config: async () => ({ lastBlock: 0 }) },
            portfolio: { positions }
        }
    };
});

const { useSession } = await import('../src/stores/session.store.ts');
const { useLocale } = await import('../src/stores/locale.store.ts');
const { default: MarketPage } = await import('../src/pages/market.page.tsx');

/** Announces a wallet over EIP-6963 and adopts it - the app's only route to a session. */
async function connect(): Promise<void> {
    const session = useSession.peek();
    window.dispatchEvent(
        new CustomEvent('eip6963:announceProvider', {
            detail: {
                info: { rdns: 'io.metamask', name: 'MetaMask', icon: '' },
                provider: {
                    request: async ({ method }: { method: string }) =>
                        method === 'eth_requestAccounts' ? [ADDRESS] : [],
                    on: vi.fn()
                }
            }
        })
    );
    await session.connect('io.metamask');
}

function mount(): ReturnType<typeof render> {
    return render(
        <MemoryRouter initialEntries={['/market/m5']}>
            <Routes>
                <Route path="/market/:id" element={<MarketPage />} />
            </Routes>
        </MemoryRouter>
    );
}

afterEach(() => {
    useSession.peek().disconnect();
    useLocale.peek().setLang('en');
    positions.mockReset();
    positions.mockResolvedValue([]);
});

describe('market page claim', () => {
    it('offers Claim when the wallet holds a redeemable position in THIS market', async () => {
        positions.mockResolvedValue([position('m5', true)]);
        await connect();

        const { findByRole } = mount();
        expect(await findByRole('button', { name: 'Claim' })).toBeTruthy();
    });

    it('offers nothing when the redeemable position belongs to another market', async () => {
        positions.mockResolvedValue([position('m9', true)]);
        await connect();

        const { queryByRole, findByText } = mount();
        await findByText('Voided - every outcome refunds equally');
        await waitFor(() => expect(positions).toHaveBeenCalled());
        expect(queryByRole('button', { name: 'Claim' })).toBeNull();
    });

    it('offers nothing to a wallet that is not connected', async () => {
        positions.mockResolvedValue([position('m5', true)]);

        const { queryByRole, findByText } = mount();
        await findByText('Voided - every outcome refunds equally');
        expect(positions).not.toHaveBeenCalled();
        expect(queryByRole('button', { name: 'Claim' })).toBeNull();
    });
});
