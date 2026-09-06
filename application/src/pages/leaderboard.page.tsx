import { useState } from 'react';

import { client, PERIODS, type Period } from '../api.ts';
import { pageOf } from '../lib/paged.ts';
import { shortAddress, addressGradient } from '../lib/wallet.ts';

import { useLocale } from '../stores/locale.store.ts';
import { useSession } from '../stores/session.store.ts';
import { useResource } from '../hooks/use-resource.ts';

import { formatVolume, formatSigned } from '../i18n/format.ts';

import Icon from '../icons/icon.tsx';

import Tabs from '../components/ui/tabs.tsx';
import SkeletonList from '../components/ui/skeleton-list.tsx';
import Pagination from '../components/ui/pagination.tsx';
import Tooltip from '../components/ui/tooltip.tsx';
import EmptyState from '../components/ui/empty-state.tsx';
import { cardClass } from '../components/ui/variants.ts';

const PAGE_SIZE = 10;

export default function Leaderboard() {
    const { t, lang } = useLocale();
    const session = useSession();

    const [period, setPeriod] = useState<Period>('week');
    const [page, setPage] = useState(1);

    const rows = useResource(
        () => period,
        (active: Period) => client.leaderboard.list({ query: { period: active } })
    );

    const periodTabs = PERIODS.map((entry) => ({ id: entry, label: t(`leaderboard.${entry}` as 'leaderboard.day') }));
    const paged = pageOf(rows.data() ?? [], page, PAGE_SIZE);

    return (
        <section className="shell py-5">
            <div className="mx-auto max-w-3xl">
                <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight motion-safe:animate-rise">
                    <Icon name="trophy" size={22} className="text-gold" />
                    {t('leaderboard.title')}
                </h1>

                <div className="mb-4 mt-4">
                    <Tabs
                        tabs={periodTabs}
                        active={period}
                        onChange={(next) => {
                            setPeriod(next as Period);
                            setPage(1);
                        }}
                    />
                </div>

                {rows.loading() && <SkeletonList count={5} height="h-14" radius="card" gap="md" />}

                {!rows.loading() && paged.rows.length === 0 && (
                    <EmptyState icon="trophy" title={t('leaderboard.empty')} hint={t('leaderboard.emptyHint')} />
                )}

                {!rows.loading() && paged.rows.length > 0 && (
                    <>
                        <ol className="grid grid-cols-1 gap-2.5">
                            {paged.rows.map((row) => (
                                <li key={`${period}-${row.rank}`} className="motion-safe:animate-rise">
                                    <div
                                        className={`${cardClass({ tone: row.address === session.address().toLowerCase() ? 'brand' : 'line', padding: 'snug' })} flex items-center gap-3`}
                                    >
                                        {row.rank <= 3 ? (
                                            <Tooltip label={`${t('leaderboard.rank')} ${row.rank}`}>
                                                <span
                                                    className="flex h-9 w-9 shrink-0 items-center justify-center"
                                                    role="img"
                                                    aria-label={`${t('leaderboard.rank')} ${row.rank}`}
                                                >
                                                    {row.rank === 1 && (
                                                        <Icon name="crown" size={22} className="text-gold" />
                                                    )}
                                                    {(row.rank === 2 || row.rank === 3) && (
                                                        <Icon
                                                            name="medal"
                                                            size={20}
                                                            className={row.rank === 2 ? 'text-muted' : 'text-gold'}
                                                        />
                                                    )}
                                                </span>
                                            </Tooltip>
                                        ) : (
                                            <span
                                                className="flex h-9 w-9 shrink-0 items-center justify-center"
                                                aria-hidden="true"
                                            >
                                                <span className="nums text-[14px] font-bold text-faint">
                                                    {row.rank}
                                                </span>
                                            </span>
                                        )}
                                        <span
                                            className="h-9 w-9 shrink-0 overflow-hidden rounded-full ring-2 ring-line"
                                            style={{ background: addressGradient(row.address) }}
                                            aria-hidden="true"
                                        ></span>
                                        <span className="min-w-0 flex-1">
                                            <span className="nums latin-nums block truncate text-[14px] font-bold">
                                                <bdi dir="ltr">{shortAddress(row.address)}</bdi>
                                            </span>
                                            <span className="nums block text-[12px] text-faint">
                                                {t('market.volume')}: {formatVolume(row.volume, lang())}
                                            </span>
                                        </span>
                                        <span
                                            className={
                                                row.profit >= 0
                                                    ? 'nums shrink-0 text-[15px] font-bold text-yes'
                                                    : 'nums shrink-0 text-[15px] font-bold text-no'
                                            }
                                        >
                                            {formatSigned(row.profit, lang())}
                                        </span>
                                    </div>
                                </li>
                            ))}
                        </ol>
                        <div className="mt-5">
                            <Pagination page={paged.current} pages={paged.pages} onChange={setPage} />
                        </div>
                    </>
                )}
            </div>
        </section>
    );
}
