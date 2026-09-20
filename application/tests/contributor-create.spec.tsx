// The create form as a wallet the console INVITED sees it. The factory gates createMarket on
// ADMIN_ROLE and has no create-only role, so an invited wallet can never sign the deploy - the
// form has to end in a proposal it files, not in a button that would always revert.
//
// The draft and locale stores are singletons, so this file resets what it fills.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import type { Hash } from 'viem';

const create = vi.fn(async () => ({ hash: '0xhash' as Hash, market: null }));
const submitProposal = vi.fn(async (draft: string) => {
    void draft;
    return 7;
});
const decideProposal = vi.fn(async (id: number, accept: boolean, note: string) => {
    void id;
    void accept;
    void note;
    return true;
});

vi.mock('../src/api.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/api.ts')>();
    return {
        ...actual,
        client: {
            // A registered category, so the draft below is complete rather than minting one.
            categories: { list: async () => [{ id: '3', count: 2, label: { en: 'Sports' }, retired: false }] },
            chain: { config: async () => ({ lastBlock: 0 }) }
        }
    };
});

vi.mock('../src/stores/admin.store.ts', () => {
    // No chain read in these tests, so the factory's fee split never lands and the form keeps
    // the draft store's own defaults.
    const api = {
        addCategory: vi.fn(async () => true),
        create,
        createScheduled: vi.fn(async () => null),
        submitProposal,
        decideProposal,
        defaults: { data: () => undefined }
    };
    const useAdmin = (): typeof api => api;
    useAdmin.peek = (): typeof api => api;
    return { useAdmin };
});

const { useCreateDraft, toLocalInput } = await import('../src/stores/create-draft.store.ts');
const { useLocale } = await import('../src/stores/locale.store.ts');
const { default: CreateMarketForm } = await import('../src/components/admin/create-market-form.tsx');

/** A draft complete enough that a deploy would be allowed if the wallet could sign one. */
function fillDraft(): void {
    const draft = useCreateDraft.peek();
    draft.setTitle('en', 'Will Esteghlal win the derby?');
    draft.setCategory('3');
    draft.setLockAt(toLocalInput(Date.now() + 7 * 24 * 60 * 60 * 1000));
    draft.setLiquidity('100');
}

afterEach(() => {
    useCreateDraft.peek().reset();
    useLocale.peek().setLang('en');
    create.mockClear();
    submitProposal.mockClear();
    decideProposal.mockClear();
});

describe('create form for an invited wallet', () => {
    it('offers a proposal instead of a deploy it could never sign', async () => {
        fillDraft();
        const screen = render(<CreateMarketForm canDeploy={false} />);

        expect(screen.queryByRole('button', { name: 'Create market' })).toBeNull();
        expect(
            await screen.findByText('This wallet cannot deploy. Submit it as a proposal and the owner signs it.')
        ).toBeTruthy();
        // ONE way to file it, at the end of the form beside where a deploy would be.
        expect(screen.getAllByRole('button', { name: /Submit proposal/ }).length).toBe(1);
    });

    it('files the whole draft as the form encodes it', async () => {
        fillDraft();

        const screen = render(<CreateMarketForm canDeploy={false} />);
        fireEvent.click(screen.getByRole('button', { name: /Submit proposal/ }));

        await waitFor(() => expect(submitProposal).toHaveBeenCalled());
        const draft = submitProposal.mock.calls[0]?.[0] ?? '';
        expect(draft).toContain(`title=${encodeURIComponent('Will Esteghlal win the derby?').replace(/%20/g, '+')}`);
        expect(draft).toContain('cat=3');
        // A proposal reaches no chain and carries no signature over one.
        expect(create).not.toHaveBeenCalled();
        // The form is cleared, so the next question starts blank rather than re-filing this one.
        expect(await screen.findByText('Proposal submitted')).toBeTruthy();
        expect(useCreateDraft.peek().title().en).toBe('');
    });

    it('refuses to file a draft a deploy would reject', async () => {
        // No category, no stop time: the same complaint a deploy would make, made before
        // somebody else is asked to sign it.
        useCreateDraft.peek().setTitle('en', 'Half a market');
        const screen = render(<CreateMarketForm canDeploy={false} />);

        fireEvent.click(screen.getByRole('button', { name: /Submit proposal/ }));
        // Said twice on purpose - once under the group it belongs to, once beside the button
        // that was just pressed - so `getAllBy`, not `getBy`.
        await waitFor(() => expect(screen.getAllByText('Pick or type a category').length).toBe(2));
        expect(submitProposal).not.toHaveBeenCalled();
    });

    it('still deploys for an admin, and answers the proposal it came from', async () => {
        // Opened FROM the queue: loadProposal clears first, so the fields go in after.
        useCreateDraft.peek().loadProposal(7, {});
        fillDraft();
        const screen = render(<CreateMarketForm />);

        // A form opened from the queue cannot re-file itself as a second proposal.
        expect(screen.queryByRole('button', { name: /Submit proposal/ })).toBeNull();

        fireEvent.click(await screen.findByRole('button', { name: 'Create market' }));
        await waitFor(() => expect(create).toHaveBeenCalled());
        // The deploy IS the verdict: the row must not be left waiting under a live market.
        await waitFor(() => expect(decideProposal).toHaveBeenCalledWith(7, true, ''));
    });
});
