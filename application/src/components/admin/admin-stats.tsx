import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';

import { formatMoney, faDigits } from '../../i18n/format.ts';

import StatTile from '../ui/stat-tile.tsx';
import Skeleton from '../ui/skeleton.tsx';

// The console's headline numbers - sqlite aggregates from the indexer, O(1) at any scale.
export default function AdminStats() {
    const { t, lang } = useLocale();
    const admin = useAdmin();

    const count = (value: number): string => (lang() === 'fa' ? faDigits(String(value)) : String(value));

    const data = admin.stats.data();

    if (data === undefined) {
        return admin.stats.loading() ? <Skeleton className="h-20 rounded-card" /> : null;
    }

    return (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6">
            <StatTile label={t('admin.markets')} value={count(data.markets)} />
            <StatTile label={t('admin.tvl')} value={formatMoney(data.tvl, lang(), { compact: true })} />
            <StatTile label={t('admin.volume')} value={formatMoney(data.volume, lang(), { compact: true })} />
            <StatTile
                label={t('admin.volume24h')}
                value={formatMoney(data.volume24h, lang(), { compact: true })}
                tone="yes"
            />
            <StatTile label={t('admin.traders')} value={count(data.traders)} />
            <StatTile
                label={t('admin.feesCollected')}
                value={formatMoney(data.feesCollected, lang(), { compact: true })}
            />
        </div>
    );
}
