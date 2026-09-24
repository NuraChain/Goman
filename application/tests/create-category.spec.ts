// Creating a market against the factory's category registry. A market carries a uint32 and
// nothing else - the name a reader sees is the meaning the registry holds against that id, once
// per language - so the form has to deal in ids: it refuses anything that is not one, refuses a
// retired one, and registers an unknown one WITH its names before it deploys against it.
//
// Every field is on ONE page, so nothing here walks through steps to reach the deploy button.
//
// The draft and locale stores are singletons, so this file resets what it fills.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, waitFor } from './harness.ts';

import type { CategoryCount } from '../src/api.ts';
import type { Hash } from 'viem';

const calls: string[] = [];
const addCategory = vi.fn(async (): Promise<boolean> =>
{
    calls.push('addCategory');
    return true;
});
const create = vi.fn(async (input: { categoryId: number }) =>
{
    calls.push('create');
    void input;
    return { hash: '0xhash' as Hash, market: null };
});

/** The registry as the index reports it: ids are numbers, names are per language. */
const registry: CategoryCount[] = [
    { id: '3', count: 2, label: { en: 'Sports', fa: 'ورزش' }, retired: false },
    { id: '4', count: 1, label: { en: 'Politics' }, retired: true }
];

vi.mock('../src/api.ts', async (importOriginal) =>
{
    const actual = await importOriginal<typeof import('../src/api.ts')>();
    return {
        ...actual,
        client: {
            categories: { list: async () => registry },
            chain: { config: async () => ({ lastBlock: 0 }) }
        }
    };
});

vi.mock('../src/stores/admin.store.ts', () =>
{
    // No chain read in these tests, so the factory's fee split never lands and the form keeps
    // the draft store's own defaults.
    const api = { addCategory, create, defaults: { data: () => undefined } };
    const useAdmin = (): typeof api => api;
    useAdmin.peek = (): typeof api => api;
    return { useAdmin };
});

const { useCreateDraft, toLocalInput } = await import('../src/stores/create-draft.store.ts');
const { useLocale } = await import('../src/stores/locale.store.ts');
const { default: CreateMarketForm } = await import('../src/components/admin/create-market-form.azeroth');

/** A complete draft bar the category, which each test sets to the case it is about. */
function fillDraft(): void
{
    const draft = useCreateDraft();
    draft.setTitle('en', 'Will Esteghlal win the derby?');
    draft.setLockAt(toLocalInput(Date.now() + 7 * 24 * 60 * 60 * 1000));
    draft.setLiquidity('100');
}

function mount(): ReturnType<typeof render>
{
    return render(() => CreateMarketForm({  }));
}

afterEach(() =>
{
    useCreateDraft().reset();
    useLocale().setLang('en');
    calls.length = 0;
    addCategory.mockClear();
    create.mockClear();
});

describe('create form category', () =>
{
    it('refuses an id that is not a number', async () =>
    {
        fillDraft();
        useCreateDraft().setCategory('sports');

        const screen = mount();
        expect(await screen.findByText('A category ID is a whole number above zero')).toBeTruthy();
    });

    it('refuses a registry id nobody has named', async () =>
    {
        fillDraft();
        useCreateDraft().setCategory('7');

        const screen = mount();
        expect(await screen.findByText('A new category needs an English name')).toBeTruthy();
    });

    it('refuses a category the registry has retired', async () =>
    {
        fillDraft();
        useCreateDraft().setCategory('4');

        const screen = mount();
        expect(await screen.findByText('That category is retired and takes no new markets')).toBeTruthy();
    });

    it('registers an unknown id with its names before it deploys against it', async () =>
    {
        fillDraft();
        const draft = useCreateDraft();
        draft.setCategory('7');
        draft.setCategoryLabel('en', 'Esports');
        draft.setCategoryLabel('fa', 'ورزش‌های الکترونیکی');

        const screen = mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Create market' }));

        await waitFor(() => expect(create).toHaveBeenCalled());
        // Order matters: the factory rejects a market filed under an id it does not know.
        expect(calls).toEqual(['addCategory', 'create']);
        expect(addCategory).toHaveBeenCalledWith(7, { en: 'Esports', fa: 'ورزش‌های الکترونیکی' });
        expect(create.mock.calls[0]?.[0]).toMatchObject({ categoryId: 7 });
    });

    it('asks for no name when the registry already knows the id', async () =>
    {
        fillDraft();
        useCreateDraft().setCategory('3');

        const screen = mount();
        fireEvent.click(await screen.findByRole('button', { name: 'Create market' }));

        await waitFor(() => expect(create).toHaveBeenCalled());
        expect(addCategory).not.toHaveBeenCalled();
        expect(create.mock.calls[0]?.[0]).toMatchObject({ categoryId: 3 });
    });
});
