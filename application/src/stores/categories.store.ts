import { createStore, createSignal, createResource, type Resource } from '../lib/reactive.ts';

import { client, type CategoryCount } from '../api.ts';

import { isKnownCategory } from '../lib/market.ts';

import { useLocale } from './locale.store.ts';

// The category list, once. The rail, the cards, the market header, the create form and the
// admin table each used to fetch it themselves, and each resolved a display name its own
// way - so an admin-set Persian label reached exactly none of them.

export interface CategoriesApi {
    /** Every category with its live market count, retired ones included. */
    list: Resource<CategoryCount[]>;

    /** The ones a picker should offer. */
    active(): CategoryCount[];

    /**
     * What to CALL a category in the active language: the admin's label when there is one,
     * the shipped translation for a curated id, otherwise the raw on-chain id.
     */
    label(id: string): string;

    /** Re-reads after an admin edit. */
    refresh(): void;
}

export const useCategories = createStore((): CategoriesApi => {
    const { t, lang } = useLocale();
    const [version, setVersion] = createSignal(1);

    const list = createResource(
        () => version(),
        () => client.categories.list(),
        { name: 'categories' }
    );

    const rows = (): CategoryCount[] => list.data() ?? [];

    return {
        list,
        active: () => rows().filter((entry) => !entry.retired),
        label: (id) => {
            if (id === 'all') {
                return t('categories.all');
            }
            const entry = rows().find((candidate) => candidate.id === id);
            const chosen = lang() === 'fa' ? entry?.labelFa : entry?.labelEn;
            if (chosen !== undefined && chosen !== '') {
                return chosen;
            }
            return isKnownCategory(id) ? t(`categories.${id}`) : id;
        },
        refresh: () => setVersion(version() + 1)
    };
});
