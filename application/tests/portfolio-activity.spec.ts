// The portfolio's Activity tab. A row is a past trade, but what the holder actually needs is
// the market behind it: to review how it settled, and to take whatever payout is still sitting
// on it. The rows used to be inert text, so a settled market could only be reached by guessing.
//
// The session and locale stores are singletons, so this file restores both.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, within } from './harness.ts';

import type { ActivityItem, Market, PortfolioSummary, Position } from '../src/api.ts';

const ADDRESS = '0x430b4409891c6A821c81e92C960c94A80Ef626dc';

const market: Market = {
    id: 'm5',
    address: '0x0000000000000000000000000000000000000005',
    category: 'sports',
    tags: [{ slug: 'football', name: 'Football' }],
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
    createdAt: '2026-09-01T00:00:00.000Z',
    featured: false,
    trending: false
};

const summary: PortfolioSummary = { balance: 10, invested: 200, current: 65, profit: -135, profitToday: 0 };

function position(claimable: boolean): Position
{
    return {
        id: 'm5/c',
        marketId: 'm5',
        outcomeId: 'c',
        side: 'yes',
        shares: 195,
        avgPrice: 1.03,
        openedAt: '2026-09-10T00:00:00.000Z',
        claimable,
        market
    };
}

const trade: ActivityItem = {
    id: 't1',
    marketId: 'm5',
    marketSlug: 'will-it-rain-in-tehran-5',
    user: ADDRESS,
    action: 'buy',
    outcomeId: 'c',
    side: 'yes',
    shares: 195,
    price: 1.03,
    at: '2026-09-10T00:00:00.000Z'
};

const positions = vi.fn(async (): Promise<Position[]> => []);

vi.mock('../src/api.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/api.ts')>();
    return {
        ...actual,
        client: {
            chain: { config: async () => ({ lastBlock: 0 }) },
            portfolio: {
                summary: async () => summary,
                positions,
                series: async () => ({ points: [] }),
                activity: async () => [trade],
                claimed: async () => []
            }
        }
    };
});

const { useSession } = await import('../src/stores/session.store.ts');
const { useLocale } = await import('../src/stores/locale.store.ts');
const { default: App } = await import('../src/App.azeroth');

/** Announces a wallet over EIP-6963 and adopts it - the app's only route to a session. */
async function connect(): Promise<void>
{
    const session = useSession();
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

/** Mounts the page and opens the Activity tab, returning that trade's row. */
async function openActivity(): Promise<HTMLElement>
{
    const screen = render(() => App({ url: '/portfolio' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }));
    // Matched on the trade, not the title: the claims list above renders the same market
    // title as its own link, and `bought` appears only in the activity row.
    const link = await screen.findByRole('link', { name: /bought/ });
    const row = link.closest('li');
    expect(row).not.toBeNull();
    return row as HTMLElement;
}

afterEach(() =>
{
    useSession().disconnect();
    useLocale().setLang('en');
    positions.mockReset();
    positions.mockResolvedValue([]);
});

describe('portfolio activity rows', () =>
{
    it('sends a past trade back to the market it was made in', async () =>
    {
        positions.mockResolvedValue([position(false)]);
        await connect();

        const row = await openActivity();
        // The row carries its own path segment: an activity feed has no market list to join
        // against, and the id alone no longer names a page.
        expect(within(row).getByRole('link').getAttribute('href')).toBe('/market/will-it-rain-in-tehran-5');
    });

    it('offers Claim on a row whose market still owes the wallet', async () =>
    {
        positions.mockResolvedValue([position(true)]);
        await connect();

        const row = await openActivity();
        expect(within(row).getByRole('button', { name: 'Claim' })).toBeTruthy();
    });

    it('offers nothing once the market has nothing left on it', async () =>
    {
        positions.mockResolvedValue([position(false)]);
        await connect();

        const row = await openActivity();
        expect(within(row).queryByRole('button', { name: 'Claim' })).toBeNull();
    });
});

// The positions filter defaults to Active, and a wallet whose every market has settled holds
// nothing active - so the tab it lands on was empty and said "your first trade will show up
// here" to someone with a claimable market one chip away.
describe('portfolio positions filter', () =>
{
    function mount(): ReturnType<typeof render>
    {
        return render(() => App({ url: '/portfolio' }));
    }

    it('counts both filters, so a settled market is never invisible', async () =>
    {
        positions.mockResolvedValue([position(true)]);
        await connect();

        const screen = mount();
        expect(await screen.findByRole('button', { name: /Active · 0/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Closed · 1/ })).toBeTruthy();
    });

    it('sends a settled-only wallet to its closed positions instead of claiming it has none', async () =>
    {
        positions.mockResolvedValue([position(true)]);
        await connect();

        const screen = mount();
        expect(await screen.findByText('Every market you hold has settled')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Show closed positions' }));
        expect(screen.queryByText('Every market you hold has settled')).toBeNull();
        expect(screen.getAllByRole('link', { name: /Malavan vs Foolad/ }).length).toBeGreaterThan(1);
    });
});
