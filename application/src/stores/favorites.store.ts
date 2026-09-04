// The watchlist: favorited market ids, persisted. A Set behind a signal - toggling
// replaces the Set so every card's `has` read re-evaluates.

import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

import { readSetting, writeSetting } from '../lib/storage.ts';

const STORAGE_KEY = 'goman.watchlist';
const LEGACY_STORAGE_KEY = 'auctionhouse.watchlist';

function savedIds(): Set<string> {
    try {
        const parsed: unknown = JSON.parse(readSetting(STORAGE_KEY) ?? readSetting(LEGACY_STORAGE_KEY) ?? '[]');
        return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
    } catch {
        return new Set();
    }
}

export interface FavoritesApi {
    ids: Getter<ReadonlySet<string>>;

    has(marketId: string): boolean;

    /** Returns the NEW state: true = now favorited. */
    toggle(marketId: string): boolean;
}

export const useFavorites = createStore((): FavoritesApi => {
    const [ids, setIds] = createSignal<ReadonlySet<string>>(savedIds());

    return {
        ids,
        has: (marketId) => ids().has(marketId),
        toggle: (marketId) => {
            const next = new Set(ids());
            const added = !next.has(marketId);
            if (added) {
                next.add(marketId);
            } else {
                next.delete(marketId);
            }
            setIds(next);
            writeSetting(STORAGE_KEY, JSON.stringify([...next]));
            return added;
        }
    };
});
