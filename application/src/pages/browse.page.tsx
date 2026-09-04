import { useRef, useState } from 'react';

import { client, type MarketSort } from '../api.ts';

import { useLocale } from '../stores/locale.store.ts';
import { useFavorites } from '../stores/favorites.store.ts';
import { useResource } from '../hooks/use-resource.ts';

import Icon from '../icons/icon.tsx';

import CategoryRail from '../components/market/category-rail.tsx';
import MarketCard from '../components/market/market-card.tsx';
import Skeleton from '../components/ui/skeleton.tsx';
import Input from '../components/ui/input.tsx';
import Chip from '../components/ui/chip.tsx';
import Button from '../components/ui/button.tsx';
import Select from '../components/ui/select.tsx';
import Sheet from '../components/ui/sheet.tsx';
import Pagination from '../components/ui/pagination.tsx';
import Tooltip from '../components/ui/tooltip.tsx';
import EmptyState from '../components/ui/empty-state.tsx';
import { MARKET_GRID } from '../components/ui/variants.ts';

const PAGE_SIZE = 12;

// Search, filter, sort, and pagination all run SERVER-SIDE against the indexer - the page
// only holds the controls. The search box debounces 300ms so typing costs one query, not
// one per keystroke; the watchlist chip narrows the server query to the locally saved ids.
export default function Browse() {
    const { t } = useLocale();
    const favorites = useFavorites();

    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('all');
    const [sort, setSort] = useState<MarketSort>('volume');
    const [watchOnly, setWatchOnly] = useState(false);
    const [page, setPage] = useState(1);
    const [filtersOpen, setFiltersOpen] = useState(false);

    const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const onQuery = (next: string): void => {
        setQuery(next);
        if (searchTimer.current !== null) {
            clearTimeout(searchTimer.current);
        }
        searchTimer.current = setTimeout(() => {
            setSearch(next);
            setPage(1);
        }, 300);
    };

    const watchIds = watchOnly ? [...favorites.ids()].join(',') : '';

    const markets = useResource(
        () => `${search}|${category}|${sort}|${watchOnly ? watchIds : '-'}|${page}`,
        () =>
            client.markets.list({
                query: {
                    ...(search.trim() === '' ? {} : { search: search.trim() }),
                    ...(category === 'all' ? {} : { category }),
                    ...(watchOnly ? { ids: watchIds === '' ? '-1' : watchIds } : {}),
                    sort,
                    page,
                    limit: PAGE_SIZE
                }
            })
    );

    const sortOptions = [
        { id: 'volume', label: t('browse.sortVolume'), icon: 'volume' as const },
        { id: 'newest', label: t('browse.sortNewest'), icon: 'sparkles' as const },
        { id: 'ending', label: t('browse.sortEnding'), icon: 'clock' as const }
    ];

    const reset = (): void => {
        setQuery('');
        setSearch('');
        setCategory('all');
        setWatchOnly(false);
        setPage(1);
    };

    const data = markets.data();

    return (
        <section className="shell py-5">
            <h1 className="mb-5 text-2xl font-bold tracking-tight motion-safe:animate-rise">{t('browse.title')}</h1>

            <div className="mb-3 flex items-center gap-2 motion-safe:animate-rise">
                <div className="min-w-0 flex-1">
                    <Input
                        icon="search"
                        label={t('nav.search')}
                        placeholder={t('nav.search')}
                        value={query}
                        onInput={onQuery}
                    />
                </div>
                <span className="sm:hidden">
                    <Tooltip label={t('browse.filters')}>
                        <button
                            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-control border border-line text-muted transition-colors duration-200 hover:text-text"
                            type="button"
                            aria-label={t('browse.filters')}
                            onClick={() => setFiltersOpen(true)}
                        >
                            <Icon name="filters" size={18} />
                        </button>
                    </Tooltip>
                </span>
            </div>

            <div className="mb-3">
                <CategoryRail
                    selected={category}
                    onSelect={(next) => {
                        setCategory(next);
                        setPage(1);
                    }}
                />
            </div>

            <div className="mb-5 hidden flex-wrap items-center gap-2 sm:flex">
                <Select
                    options={sortOptions}
                    value={sort}
                    onChange={(next) => {
                        setSort(next as MarketSort);
                        setPage(1);
                    }}
                    label={t('browse.sortLabel')}
                />
                <Chip
                    compact
                    icon="bookmark"
                    selected={watchOnly}
                    onSelect={() => {
                        setWatchOnly(!watchOnly);
                        setPage(1);
                    }}
                >
                    {t('browse.watchlist')}
                </Chip>
            </div>

            {markets.loading() && data === undefined && (
                <div className={MARKET_GRID}>
                    <Skeleton className="h-44 rounded-card" />
                    <Skeleton className="h-44 rounded-card" />
                    <Skeleton className="h-44 rounded-card" />
                    <Skeleton className="h-44 rounded-card" />
                    <Skeleton className="h-44 rounded-card" />
                    <Skeleton className="h-44 rounded-card" />
                </div>
            )}

            {data !== undefined &&
                (data.rows.length > 0 ? (
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
                    <EmptyState
                        icon={watchOnly ? 'bookmark' : 'search'}
                        title={watchOnly ? t('browse.emptyWatchlist') : t('browse.noResults')}
                        hint={watchOnly ? t('browse.emptyWatchlistHint') : t('browse.noResultsHint')}
                    >
                        <Button variant="outline" onClick={() => reset()}>
                            {t('browse.clearFilters')}
                        </Button>
                    </EmptyState>
                ))}

            <Sheet open={filtersOpen} title={t('browse.filters')} onClose={() => setFiltersOpen(false)}>
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[14px] font-bold">{t('browse.sortLabel')}</span>
                        <Select
                            options={sortOptions}
                            value={sort}
                            onChange={(next) => {
                                setSort(next as MarketSort);
                                setPage(1);
                            }}
                            label={t('browse.sortLabel')}
                        />
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Chip
                            icon="bookmark"
                            selected={watchOnly}
                            onSelect={() => {
                                setWatchOnly(!watchOnly);
                                setPage(1);
                            }}
                        >
                            {t('browse.watchlist')}
                        </Chip>
                    </div>
                    <Button block onClick={() => setFiltersOpen(false)}>
                        {t('browse.apply')} ({data?.total ?? 0})
                    </Button>
                </div>
            </Sheet>
        </section>
    );
}
