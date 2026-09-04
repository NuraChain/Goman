import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';

import { formatMoney, formatFillPrice, formatShares, formatTimeAgo } from '../../i18n/format.ts';
import { shortAddress } from '../../lib/wallet.ts';

import Icon from '../../icons/icon.tsx';

import Card from '../ui/card.tsx';
import EmptyState from '../ui/empty-state.tsx';
import Pagination from '../ui/pagination.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

// The chain's recent trades across every market, straight from the index, server-paged.
export default function ActivityFeed() {
    const { t, lang } = useLocale();
    const admin = useAdmin();

    const feed = admin.activity.data()?.rows ?? [];

    return (
        <Card>
            <h2 className="mb-3 text-lg font-bold tracking-tight">{t('admin.feedTitle')}</h2>

            {admin.activity.loading() && admin.activity.data() === undefined && <SkeletonList count={4} height="h-9" />}

            {admin.activity.data() !== undefined && feed.length === 0 && (
                <EmptyState icon="activity" title={t('admin.feedEmpty')} />
            )}

            {feed.length > 0 && (
                <div>
                    <ul className="flex flex-col">
                        {feed.map((entry) => (
                            <li
                                key={entry.id}
                                className="flex items-center gap-2.5 border-b border-line py-2.5 text-[12.5px] last:border-b-0"
                            >
                                <span className={entry.action === 'buy' ? 'text-yes' : 'text-no'} aria-hidden="true">
                                    <Icon name={entry.action === 'buy' ? 'trending-up' : 'trending-down'} size={15} />
                                </span>
                                <span className="min-w-0 flex-1 truncate">
                                    <span className="nums latin-nums font-semibold" dir="ltr">
                                        {shortAddress(entry.user)}
                                    </span>
                                    <span className="text-muted">
                                        {' '}
                                        {entry.action === 'buy' ? t('market.bought') : t('market.sold')}{' '}
                                    </span>
                                    <span className="nums">{formatShares(entry.shares, lang())}</span>
                                    <span className="nums text-muted"> @ {formatFillPrice(entry.price, lang())}</span>
                                </span>
                                <span className="nums shrink-0 text-muted">
                                    {formatMoney(entry.shares * entry.price, lang(), { compact: true })}
                                </span>
                                <span className="shrink-0 text-faint">{formatTimeAgo(entry.at, lang())}</span>
                            </li>
                        ))}
                    </ul>
                    <div className="mt-4">
                        <Pagination
                            page={admin.activity.data()?.page ?? 1}
                            pages={admin.activity.data()?.pages ?? 1}
                            onChange={(next) => admin.setFeedPage(next)}
                        />
                    </div>
                </div>
            )}
        </Card>
    );
}
