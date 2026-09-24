// The resolve dialog under the factory's N-of-M multisig. `confirmResolution` is a VOTE, and
// only the one that reaches the quorum settles the market - so the dialog has to say which of
// the two a click does, and must not report a settlement that has not happened.
//
// The locale store is a singleton, so this file restores it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from './harness.ts';

import type { AdminMarketRow } from '../src/api.ts';
import type { AdminMarketDetail, ResolutionPolicy, ResolutionVotes } from '../src/lib/admin.ts';

const FACTORY = '0x33fE315c8a7FeA10152dD2b21B5d87936aF9B79d';

const market: AdminMarketRow = {
    id: '5',
    address: '0x7cb79dFaD4B690100cb7e7631E55F9435659A84D',
    title: { en: 'Malavan vs Foolad', fa: 'ملوان مقابل فولاد' },
    emoji: '⚽',
    category: 'sports',
    status: 'closed',
    kind: 'amm',
    winningOutcomeId: null,
    outcomeCount: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    locksAt: '2026-09-11T00:00:00.000Z',
    resolvesAt: '2026-09-12T00:00:00.000Z',
    liquidity: 200,
    volume: 200,
    collected: 0,
    featured: false,
    edited: false
};

const detail: AdminMarketDetail = {
    outcomes: [
        { label: { en: 'Malavan', fa: 'ملوان', icon: '' }, price: 330000000000000000n, reserve: 100n },
        { label: { en: 'Foolad', fa: 'فولاد', icon: '' }, price: 330000000000000000n, reserve: 100n },
        { label: { en: 'Draw', fa: 'مساوی', icon: '' }, price: 340000000000000000n, reserve: 100n }
    ],
    totalSets: 300n,
    winningOutcome: null
};

const policy: ResolutionPolicy = { signers: [], required: 3, owner: FACTORY, maxSigners: 10 };

const votes = vi.fn(async (): Promise<ResolutionVotes> => ({ counts: [0, 0, 0], mine: null, isSigner: true }));
const resolve = vi.fn(async (): Promise<boolean> => true);

vi.mock('../src/lib/admin.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/lib/admin.ts')>();
    return { ...actual, fetchMarketDetail: async () => detail, resolutionVotes: votes };
});

vi.mock('../src/stores/admin.store.ts', () =>
{
    const api = {
        policy: { data: () => policy, loading: () => false, error: () => null, refetch: () => {} },
        resolve,
        voidOut: vi.fn(async () => true)
    };
    const useAdmin = (): typeof api => api;
    useAdmin.peek = (): typeof api => api;
    return { useAdmin };
});

vi.mock('../src/stores/config.store.ts', () =>
{
    const api = {
        data: () => ({ factory: FACTORY, treasury: FACTORY }),
        loading: () => false,
        error: () => null,
        refetch: () => {}
    };
    const useConfig = (): typeof api => api;
    useConfig.peek = (): typeof api => api;
    return { useConfig };
});

const { useLocale } = await import('../src/stores/locale.store.ts');
const { default: ResolveDialog } = await import('../src/components/admin/resolve-dialog.azeroth');

/** Opens the dialog and picks the Draw outcome (index 2). */
async function open(onClose = (): void => {}): Promise<ReturnType<typeof render>>
{
    const screen = render(() => ResolveDialog({ market: market, onClose: onClose }));
    fireEvent.click(await screen.findByRole('radio', { name: /Draw/ }));
    return screen;
}

afterEach(() =>
{
    useLocale().setLang('en');
    votes.mockReset();
    votes.mockResolvedValue({ counts: [0, 0, 0], mine: null, isSigner: true });
    resolve.mockReset();
    resolve.mockResolvedValue(true);
});

describe('admin resolve dialog', () =>
{
    it('calls a confirmation short of quorum a vote, and stays open on one', async () =>
    {
        const onClose = vi.fn();
        const screen = await open(onClose);

        // One of three confirmations: this click records a vote, it does not settle anything.
        const arm = await screen.findByRole('button', { name: 'Confirm outcome' });
        fireEvent.click(arm);
        fireEvent.click(await screen.findByRole('button', { name: /Confirm vote/ }));

        await waitFor(() => expect(resolve).toHaveBeenCalledWith(5, 2));
        expect(onClose).not.toHaveBeenCalled();
    });

    it('calls the confirmation that reaches quorum a resolution, and closes on it', async () =>
    {
        votes.mockResolvedValue({ counts: [0, 0, 2], mine: null, isSigner: true });
        const onClose = vi.fn();
        const screen = await open(onClose);

        const arm = await screen.findByRole('button', { name: 'Resolve' });
        fireEvent.click(arm);
        fireEvent.click(await screen.findByRole('button', { name: /Confirm resolve/ }));

        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('shows the running tally and marks this wallet’s own vote', async () =>
    {
        votes.mockResolvedValue({ counts: [1, 0, 2], mine: 0, isSigner: true });
        const screen = await open();

        expect(await screen.findByText('Your vote')).toBeTruthy();
        expect(await screen.findByText('2/3')).toBeTruthy();
    });

    it('bars a wallet that is not a resolution signer', async () =>
    {
        votes.mockResolvedValue({ counts: [0, 0, 0], mine: null, isSigner: false });
        const screen = await open();

        expect(await screen.findByText(/not a resolution signer/)).toBeTruthy();
        const button = await screen.findByRole('button', { name: /Confirm outcome|Resolve/ });
        expect((button as HTMLButtonElement).disabled).toBe(true);
    });
});
