import { categoryIcon } from '../../lib/market.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useCategories } from '../../stores/categories.store.ts';

import Chip from '../ui/chip.tsx';
import Rail from '../ui/rail.tsx';

// ONE scrollable category rail - the fix for the reference site's two cramped nav rows.
// 'all' plus every category that actually exists on-chain (admins mint categories freely);
// curated ids keep their i18n label + icon, custom ones show their raw name.
//
// It rides the shared Rail with EDGE arrows and no dots: the count is unbounded (an admin
// mints a category by typing one), it has no heading row to hang controls from, and chips
// are not pages, so dots would count nothing meaningful.
export default function CategoryRail(props: { selected: string; onSelect: (category: string) => void }) {
    const { t } = useLocale();
    const categories = useCategories();

    // 'all' is a real entry in the rail, not a sibling of it - otherwise it would sit outside
    // the scroller and the first real chip could never rest against the container line.
    // Retired categories keep their markets but leave the pickers - that is what retiring is.
    const entries = [{ id: 'all' }, ...categories.active().map((entry) => ({ id: entry.id }))];

    return (
        <Rail
            items={entries}
            itemKey={(entry: { id: string }) => entry.id}
            label={t('categories.all')}
            arrows="edge"
            dots={false}
            slotClass="shrink-0"
            railClass="!gap-1.5 py-1 sm:!gap-2"
        >
            {(entry: { id: string }) => (
                <Chip
                    compact
                    icon={entry.id === 'all' ? undefined : categoryIcon(entry.id)}
                    selected={props.selected === entry.id}
                    onSelect={() => props.onSelect(entry.id)}
                >
                    {categories.label(entry.id)}
                </Chip>
            )}
        </Rail>
    );
}
