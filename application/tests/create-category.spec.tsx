// Creating a market mints its category when the registry has never seen the id. The id is all
// the chain keeps, and what a reader sees is the per-language name the registry holds against
// it - so an id that is not a slug, or one nobody named, is a category that reads as a raw
// string in all ten languages. The form refuses both, and registers the names before it
// deploys.
//
// The draft and locale stores are singletons, so this file resets what it fills.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import type { Hash } from 'viem';

const calls: string[] = [];
const saveCategory = vi.fn(async (): Promise<boolean> => {
    calls.push('saveCategory');
    return true;
});
const create = vi.fn(async (input: { category: string }) => {
    calls.push('create');
    void input;
    return { hash: '0xhash' as Hash, market: null };
});

vi.mock('../src/api.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/api.ts')>();
    return {
        ...actual,
        client: {
            categories: { list: async () => [] },
            chain: { config: async () => ({ lastBlock: 0 }) }
        }
    };
});

vi.mock('../src/stores/admin.store.ts', () => {
    const api = { saveCategory, create, createScheduled: vi.fn(async () => null) };
    const useAdmin = (): typeof api => api;
    useAdmin.peek = (): typeof api => api;
    return { useAdmin };
});

const { useCreateDraft, toLocalInput } = await import('../src/stores/create-draft.store.ts');
const { useLocale } = await import('../src/stores/locale.store.ts');
const { default: CreateMarketForm } = await import('../src/components/admin/create-market-form.tsx');

/** A complete draft bar the category, which each test sets to the case it is about. */
function fillDraft(): void {
    const draft = useCreateDraft.peek();
    draft.setTitle('en', 'Will Esteghlal win the derby?');
    draft.setLockAt(toLocalInput(Date.now() + 7 * 24 * 60 * 60 * 1000));
    draft.setLiquidity('100');
}

function mount(): ReturnType<typeof render> {
    return render(<CreateMarketForm />);
}

afterEach(() => {
    useCreateDraft.peek().reset();
    useLocale.peek().setLang('en');
    calls.length = 0;
    saveCategory.mockClear();
    create.mockClear();
});

describe('create form category', () => {
    it('refuses an id that is not a slug', async () => {
        fillDraft();
        useCreateDraft.peek().setCategory('Sports Betting');

        const screen = mount();
        expect(await screen.findByText('Use letters, numbers and dashes only')).toBeTruthy();
    });

    it('refuses a brand new id with no English name', async () => {
        fillDraft();
        useCreateDraft.peek().setCategory('e-sports');

        const screen = mount();
        fireEvent.click(screen.getByRole('button', { name: /Review/ }));
        expect(await screen.findByText('A new category needs an English name')).toBeTruthy();
    });

    it('registers the names before it deploys, and deploys against the id', async () => {
        fillDraft();
        const draft = useCreateDraft.peek();
        draft.setCategory('e-sports');
        draft.setCategoryLabel('en', 'Esports');
        draft.setCategoryLabel('fa', 'ورزش‌های الکترونیکی');

        const screen = mount();
        fireEvent.click(screen.getByRole('button', { name: /Review/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create market' }));

        await waitFor(() => expect(create).toHaveBeenCalled());
        // Order matters: the market carries the id, so the id has to mean something first.
        expect(calls).toEqual(['saveCategory', 'create']);
        expect(saveCategory).toHaveBeenCalledWith({
            id: 'e-sports',
            label: { en: 'Esports', fa: 'ورزش‌های الکترونیکی' },
            sortOrder: 0,
            retired: false
        });
        expect(create.mock.calls[0]?.[0]).toMatchObject({ category: 'e-sports' });
    });

    it('asks for no name when the id is one the app already ships', async () => {
        fillDraft();
        useCreateDraft.peek().setCategory('sports');

        const screen = mount();
        fireEvent.click(screen.getByRole('button', { name: /Review/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Create market' }));

        await waitFor(() => expect(create).toHaveBeenCalled());
        expect(saveCategory).not.toHaveBeenCalled();
    });
});
