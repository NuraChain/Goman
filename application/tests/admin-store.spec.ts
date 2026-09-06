// The discovery controls on the admin store. The search box is a controlled input, so the
// store has to echo every keystroke at once and let only the REQUEST wait for the debounce -
// the field used to reset on each key because nothing echoed it. Every filter change goes
// back to page 1. The store is a singleton, so the test puts the controls back.
import { describe, it, expect, vi, afterEach } from 'vitest';

import { useAdmin } from '../src/stores/admin.store.ts';

afterEach(() => {
    vi.useRealTimers();
    const admin = useAdmin.peek();
    admin.setDiscoverSearch('');
    admin.setDiscoverTopic('');
    admin.setDiscoverMissingOnly(true);
});

describe('admin discovery controls', () => {
    it('echoes the search box at once and applies the filter after the debounce', () => {
        vi.useFakeTimers();
        const admin = useAdmin.peek();

        admin.setDiscoverSearch('fed');
        expect(admin.discoverSearchInput()).toBe('fed');
        expect(admin.discoverFilters().search).toBe('');

        vi.advanceTimersByTime(300);
        expect(admin.discoverFilters().search).toBe('fed');
    });

    it('starts over at page 1 whenever a filter changes', () => {
        vi.useFakeTimers();
        const admin = useAdmin.peek();

        admin.setDiscoverPage(3);
        expect(admin.discoverFilters().page).toBe(3);

        admin.setDiscoverTopic('weather');
        expect(admin.discoverFilters()).toMatchObject({ topic: 'weather', page: 1 });

        admin.setDiscoverPage(2);
        admin.setDiscoverMissingOnly(false);
        expect(admin.discoverFilters()).toMatchObject({ missingOnly: false, page: 1 });

        admin.setDiscoverPage(2);
        admin.setDiscoverSearch('rain');
        vi.advanceTimersByTime(300);
        expect(admin.discoverFilters()).toMatchObject({ search: 'rain', page: 1 });
    });
});
