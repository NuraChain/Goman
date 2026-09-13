// The admin category table, which edits TWO eras with different machinery.
//
// A numeric id is a registry category: its name is a transaction and it can only be retired,
// because the factory has no remove function to call. Any other id predates the registry, and
// its name is a presentation row this app owns - so that one, and only that one, can be
// renamed and deleted outright. Getting the split wrong either offers a delete the chain
// cannot honour or strands the old rows with no way to fix their names, which is what this
// file pins.
//
// The locale store is a singleton, so this file restores it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';

import type { CategoryCount } from '../src/api.ts';

/** One row of each era: a registry id, and a raw string from before the registry. */
const rows: CategoryCount[] = [
    { id: '3', count: 2, label: { en: 'Sports', fa: 'ورزش' }, retired: false },
    { id: 'culture', count: 4, label: { en: 'Culture' }, retired: false }
];

const saveCategory = vi.fn(async (): Promise<boolean> => true);
const deleteCategory = vi.fn(async (): Promise<boolean> => true);
const setCategoryNames = vi.fn(async (): Promise<boolean> => true);
const addCategory = vi.fn(async (): Promise<boolean> => true);
const setCategoryOpen = vi.fn(async (): Promise<boolean> => true);

vi.mock('../src/stores/admin.store.ts', () => {
    const api = { saveCategory, deleteCategory, setCategoryNames, addCategory, setCategoryOpen };
    const useAdmin = (): typeof api => api;
    useAdmin.peek = (): typeof api => api;
    return { useAdmin };
});

vi.mock('../src/stores/categories.store.ts', () => {
    const api = {
        list: { data: () => rows, loading: () => false, error: () => null, refetch: () => {} },
        active: () => rows,
        label: (id: string) => id,
        refresh: () => {}
    };
    const useCategories = (): typeof api => api;
    useCategories.peek = (): typeof api => api;
    return { useCategories };
});

vi.mock('../src/stores/onchain.store.ts', () => {
    const api = { pending: () => false, busy: () => false, narrate: vi.fn(), writes: () => 0 };
    const useOnchain = (): typeof api => api;
    useOnchain.peek = (): typeof api => api;
    return { useOnchain };
});

vi.mock('../src/stores/toasts.store.ts', () => {
    const api = { push: vi.fn() };
    const useToasts = (): typeof api => api;
    useToasts.peek = (): typeof api => api;
    return { useToasts };
});

const { useLocale } = await import('../src/stores/locale.store.ts');
const { default: CategoryTable } = await import('../src/components/admin/category-table.tsx');

afterEach(() => {
    useLocale.peek().setLang('en');
    saveCategory.mockClear();
    deleteCategory.mockClear();
    setCategoryNames.mockClear();
});

describe('admin category table', () => {
    it('offers delete on a pre-registry row and retire on a registry one', async () => {
        const screen = render(<CategoryTable />);

        // The pre-registry row is the only one with a Delete: the registry cannot honour one.
        expect(await screen.findByRole('button', { name: 'Delete' })).toBeTruthy();
        expect(screen.getAllByRole('button', { name: 'Retire' })).toHaveLength(1);
    });

    it('asks twice before deleting, and deletes the row it was asked about', async () => {
        const screen = render(<CategoryTable />);

        fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

        // Armed, not fired: the first click only swaps in the confirmation.
        expect(deleteCategory).not.toHaveBeenCalled();

        fireEvent.click(await screen.findByRole('button', { name: /Delete this category/ }));
        await waitFor(() => expect(deleteCategory).toHaveBeenCalledWith('culture'));
    });

    it('renames a pre-registry row through the presentation table, not a transaction', async () => {
        const screen = render(<CategoryTable />);

        // The second Edit button is the pre-registry row's - the first belongs to the registry
        // row above it. Both are icon-only, so they are named by their label prop.
        fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1]!);

        const name = await screen.findByLabelText(/Name/);
        fireEvent.change(name, { target: { value: 'Arts' } });

        // Now the only Save on the page: the row buttons are Edit, and the form's primary
        // action switches from "New category" to "Save" once a row is loaded into it.
        fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

        await waitFor(() =>
            expect(saveCategory).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'culture', label: expect.objectContaining({ en: 'Arts' }) })
            )
        );
        // A rename of an off-chain row must never reach the registry.
        expect(setCategoryNames).not.toHaveBeenCalled();
    });
});
