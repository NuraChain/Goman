// The two small UI stores the primitives lean on: toasts (push/cap/dismiss) and the
// persisted watchlist (toggle semantics + storage round-trip).
//
// The stores are plain singletons now - no reactive root to open - so each test reads the
// API directly through `.peek()`, which is the non-hook accessor.
import { describe, it, expect } from 'vitest';

import { useToasts } from '../src/stores/toasts.store.ts';
import { useFavorites } from '../src/stores/favorites.store.ts';

describe('toast store', () => {
    it('pushes, caps the stack at three, and dismisses by id', () => {
        const toasts = useToasts.peek();
        const first = toasts.push('info', 'one');
        toasts.push('success', 'two');
        toasts.push('error', 'three');
        toasts.push('info', 'four');
        expect(toasts.items().length).toBe(3);
        expect(toasts.items().some((entry) => entry.id === first)).toBe(false);

        const last = toasts.items()[2];
        toasts.dismiss(last!.id);
        expect(toasts.items().length).toBe(2);
        expect(toasts.items().some((entry) => entry.message === 'four')).toBe(false);
    });
});

describe('favorites store', () => {
    it('toggle reports the NEW state and has() tracks it', () => {
        const favorites = useFavorites.peek();
        expect(favorites.has('btc-150k-2026')).toBe(false);
        expect(favorites.toggle('btc-150k-2026')).toBe(true);
        expect(favorites.has('btc-150k-2026')).toBe(true);
        expect(favorites.toggle('btc-150k-2026')).toBe(false);
        expect(favorites.has('btc-150k-2026')).toBe(false);
    });
});
