import { useState } from 'react';

import { client } from '../api.ts';

import { useLocale } from '../stores/locale.store.ts';
import { useResource } from '../hooks/use-resource.ts';

import CategoryRail from '../components/market/category-rail.tsx';
import MarketCard from '../components/market/market-card.tsx';
import FeaturedRail from '../components/market/featured-rail.tsx';
import Skeleton from '../components/ui/skeleton.tsx';
import Button from '../components/ui/button.tsx';
import Pagination from '../components/ui/pagination.tsx';
import EmptyState from '../components/ui/empty-state.tsx';
import { MARKET_GRID } from '../components/ui/variants.ts';

const PAGE_SIZE = 12;

export default function Home() {
    const { t } = useLocale();

    const [category, setCategory] = useState('all');
    const [page, setPage] = useState(1);

    const featured = useResource(
        () => 'featured',
        () => client.markets.list({ query: { featured: true, limit: 8 } })
    );

    const markets = useResource(
        () => `${category}|${page}`,
        (key: string) => {
            const [activeCategory = 'all', activePage = '1'] = key.split('|');
            return client.markets.list({
                query: {
                    ...(activeCategory === 'all' ? {} : { category: activeCategory }),
                    sort: 'volume',
                    page: Number(activePage),
                    limit: PAGE_SIZE
                }
            });
        }
    );

    const data = markets.data();

    return (
        <section className="shell py-5">
            {markets.loading() && data === undefined && (
                <>
                    <div className="mb-8 flex gap-4 overflow-hidden">
                        <Skeleton className="h-64 w-[19.5rem] shrink-0 rounded-card sm:w-[22rem]" />
                        <Skeleton className="h-64 w-[19.5rem] shrink-0 rounded-card sm:w-[22rem]" />
                        <Skeleton className="h-64 w-[19.5rem] shrink-0 rounded-card sm:w-[22rem]" />
                    </div>
                    <div className={MARKET_GRID}>
                        <Skeleton className="h-44 rounded-card" />
                        <Skeleton className="h-44 rounded-card" />
                        <Skeleton className="h-44 rounded-card" />
                        <Skeleton className="h-44 rounded-card" />
                    </div>
                </>
            )}

            {!markets.loading() && markets.error() !== null && (
                <EmptyState icon="alert" tone="danger" hint={t('common.error')}>
                    <Button variant="outline" onClick={() => markets.refetch()}>
                        {t('common.retry')}
                    </Button>
                </EmptyState>
            )}

            {data !== undefined && (
                <div>
                    <FeaturedRail markets={featured.data()?.rows ?? []} />

                    <h2 className="mb-3 text-lg font-bold tracking-tight">{t('home.allMarkets')}</h2>
                    <div className="mb-3">
                        <CategoryRail
                            selected={category}
                            onSelect={(next) => {
                                setCategory(next);
                                setPage(1);
                            }}
                        />
                    </div>

                    {data.rows.length > 0 ? (
                        <>
                            <div className={MARKET_GRID}>
                                {data.rows.map((market) => (
                                    <MarketCard key={market.id} market={market} />
                                ))}
                            </div>
                            <div className="mt-6">
                                <Pagination page={data.page} pages={data.pages} onChange={setPage} />
                            </div>
                        </>
                    ) : (
                        <EmptyState icon="search" title={t('browse.noResults')} hint={t('browse.noResultsHint')}>
                            <Button variant="outline" icon="flame" onClick={() => setCategory('all')}>
                                {t('categories.all')}
                            </Button>
                        </EmptyState>
                    )}
                </div>
            )}
        </section>
    );
}
