// The create form as a wallet the console INVITED sees it. The factory gates createMarket on
// ADMIN_ROLE and has no create-only role, so an invited wallet can never sign the deploy - the
// form has to end in a link it hands back, not in a button that would always revert.
//
// The draft and locale stores are singletons, so this file resets what it fills.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import type { Hash } from 'viem';

const create = vi.fn(async () => ({ hash: '0xhash' as Hash, market: null }));
const writeText = vi.fn(async (text: string) => {
    void text;
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
    writeText.mockClear();
});

describe('create form for an invited wallet', () => {
    it('offers the draft link instead of a deploy it could never sign', async () => {
        fillDraft();
        const screen = render(<CreateMarketForm canDeploy={false} />);

        expect(screen.queryByRole('button', { name: 'Create market' })).toBeNull();
        expect(
            await screen.findByText('This wallet cannot deploy. Copy the draft link and send it to an admin to sign.')
        ).toBeTruthy();
        // Two ways to the same link - the header and the end of the form.
        expect(screen.getAllByRole('button', { name: /Copy draft link/ }).length).toBe(2);
    });

    it('puts the whole draft on the clipboard as a link', async () => {
        Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText }, configurable: true });
        fillDraft();

        const screen = render(<CreateMarketForm canDeploy={false} />);
        fireEvent.click(screen.getAllByRole('button', { name: /Copy draft link/ })[1]!);

        await waitFor(() => expect(writeText).toHaveBeenCalled());
        const link = writeText.mock.calls[0]?.[0] ?? '';
        expect(link).toContain('/admin?section=create');
        expect(link).toContain(`title=${encodeURIComponent('Will Esteghlal win the derby?').replace(/%20/g, '+')}`);
        expect(link).toContain('cat=3');
        // Never a signature, never a key: a draft link carries FIELDS.
        expect(create).not.toHaveBeenCalled();
    });

    it('still deploys for an admin', async () => {
        fillDraft();
        const screen = render(<CreateMarketForm />);

        fireEvent.click(await screen.findByRole('button', { name: 'Create market' }));
        await waitFor(() => expect(create).toHaveBeenCalled());
    });
});
