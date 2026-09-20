import { useState } from 'react';

import { MARKET_STATUSES, type AdminMarketRow, type MarketSort, type MarketStatusName } from '../../api.ts';

import { categoryIcon } from '../../lib/market.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';
import { useCategories } from '../../stores/categories.store.ts';

import { formatDateTimeShort, formatMoney, faDigits } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';
import Chip from '../ui/chip.tsx';
import EmptyState from '../ui/empty-state.tsx';
import Input from '../ui/input.tsx';
import Pagination from '../ui/pagination.tsx';
import Select from '../ui/select.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';
import Tooltip from '../ui/tooltip.tsx';
import { cardClass, type BadgeTone } from '../ui/variants.ts';

import MarketRowDetail from './market-row-detail.tsx';
import ResolveDialog from './resolve-dialog.tsx';
import EditMarketDialog from './edit-market-dialog.tsx';

/** Status name -> badge label key + tone. */
const STATUS: Record<MarketStatusName, { key: `admin.${ string }`; tone: BadgeTone }> = {
    open: { key: 'admin.statusOpen', tone: 'yes' },
    paused: { key: 'admin.statusPaused', tone: 'gold' },
    closed: { key: 'admin.statusClosed', tone: 'muted' },
    resolved: { key: 'admin.statusResolved', tone: 'brand' },
    voided: { key: 'admin.statusVoided', tone: 'no' }
};

// The registry, searched/filtered/sorted/paged SERVER-SIDE - the console stays instant at
// a 100k-market registry. Rows are mobile-first decks: title line, meta line, a touch-sized
// action row, and an expandable trustless detail strip. Resolution goes through the
// confirming dialog only.
export default function MarketTable()
{
    const { t, lang, text } = useLocale();
    const { calendarSystem } = usePreferences();
    const admin = useAdmin();
    const onchain = useOnchain();
    const toasts = useToasts();

    const [expandedId, setExpandedId] = useState('');
    const [resolveTarget, setResolveTarget] = useState<AdminMarketRow | null>(null);
    const [editTarget, setEditTarget] = useState<AdminMarketRow | null>(null);

    // Closing halts trading on a live market FOREVER, so it arms first like resolve and void.
    // It was the only irreversible action in the console that fired from a single click, on a
    // small ghost button sitting in a row of four.
    const [closing, setClosing] = useState('');

    // Signing is in flight until the request returns, so the star reports its own busy state:
    // it is not a transaction, so onchain.pending() never covers it and a second click would
    // open a second signature prompt for the same row.
    const [featuring, setFeaturing] = useState('');

    const closeMarket = async (row: AdminMarketRow): Promise<void> =>
    {
        await admin.close(Number(row.id));
        setClosing('');
    };

    // The shared registry, not a private fetch: a category's NAME is per-language and lives
    // there, so a table resolving ids on its own is a table showing raw slugs.
    const categories = useCategories();

    const counts = admin.stats.data();
    const countOf = (status: MarketStatusName): number => counts?.[status] ?? 0;
    const count = (value: number): string => (lang() === 'fa' ? faDigits(String(value)) : String(value));
    const when = (iso: string): string => formatDateTimeShort(iso, lang(), calendarSystem());

    const categoryOptions = [
        { id: 'all', label: t('admin.all') },
        ...(categories.list.data() ?? []).map((entry) => ({
            id: entry.id,
            label: categories.label(entry.id),
            icon: categoryIcon(entry.id)
        }))
    ];

    const sortOptions = [
        { id: 'newest', label: t('browse.sortNewest'), icon: 'sparkles' as const },
        { id: 'volume', label: t('browse.sortVolume'), icon: 'volume' as const },
        { id: 'ending', label: t('browse.sortEnding'), icon: 'clock' as const }
    ];

    const star = async (row: AdminMarketRow): Promise<void> =>
    {
        if (featuring !== '')
        {
            return;
        }
        const next = !row.featured;
        setFeaturing(row.id);
        const ok = await admin.feature(row.id, next);
        setFeaturing('');
        if (ok)
        {
            toasts.push('success', next ? t('toast.featured') : t('toast.unfeatured'), 'sparkles');
        }
    };

    const page = admin.rows.data();

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <h2 className="me-auto text-lg font-bold tracking-tight">{t('admin.markets')}</h2>
                <Select
                    options={categoryOptions}
                    value={admin.filters().category}
                    onChange={(next) => admin.setCategory(next)}
                    label={t('admin.formCategory')}
                />
                <Select
                    options={sortOptions}
                    value={admin.filters().sort}
                    onChange={(next) => admin.setSort(next as MarketSort)}
                    label={t('browse.sortLabel')}
                />
            </div>

            <Input
                icon="search"
                label={t('admin.searchMarkets')}
                placeholder={t('admin.searchMarkets')}
                value={admin.searchInput()}
                onInput={(next) => admin.setSearch(next)}
            />

            <div className="rail rail-bleed rail-fade gap-1.5 py-1 sm:gap-2">
                <Chip compact selected={admin.filters().status === 'all'} onSelect={() => admin.setStatus('all')}>
                    {t('admin.all')} · {count(counts?.markets ?? 0)}
                </Chip>
                {MARKET_STATUSES.map((status) => (
                    <Chip
                        key={status}
                        compact
                        selected={admin.filters().status === status}
                        onSelect={() => admin.setStatus(status)}
                    >
                        {t(STATUS[status].key as 'admin.statusOpen')} · {count(countOf(status))}
                    </Chip>
                ))}
            </div>

            {admin.rows.loading() && page === undefined && (
                <SkeletonList count={4} height="h-32" radius="card" gap="md" />
            )}

            {page !== undefined &&
                (page.rows.length === 0 ? (
                    <EmptyState icon="gavel" title={t('admin.empty')} hint={t('admin.emptyHint')} />
                ) : (
                    <div>
                        <ul className="grid grid-cols-1 gap-3">
                            {page.rows.map((row) => (
                                <li key={row.id} className={cardClass({ animate: 'rise' })}>
                                    <div className="flex items-start gap-3">
                                        <span
                                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-overlay text-xl"
                                            aria-hidden="true"
                                        >
                                            {row.emoji}
                                        </span>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-[14px] font-bold">{text(row.title)}</p>
                                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
                                                <span className="inline-flex items-center gap-1">
                                                    <Icon name={categoryIcon(row.category)} size={12} />
                                                    {categories.label(row.category)}
                                                </span>
                                                <span className="nums">
                                                    {formatMoney(row.liquidity, lang(), { compact: true })}
                                                </span>
                                            </p>
                                        </div>
                                        {/* Only ever on a market whose text an admin has
                                             corrected. The chain still holds the original, and
                                             the badge is what stops that being a secret. */}
                                        {row.edited && (
                                            <Tooltip label={t('admin.editedHint')}>
                                                <span>
                                                    <Badge tone="muted" icon="edit">
                                                        {t('admin.edited')}
                                                    </Badge>
                                                </span>
                                            </Tooltip>
                                        )}
                                        <Badge tone={STATUS[row.status].tone}>
                                            {t(STATUS[row.status].key as 'admin.statusOpen')}
                                        </Badge>
                                        {/* Only pools are called out. The AMM is the default
                                             engine, and a badge on every row would cost the
                                             narrow deck a line to say "ordinary". */}
                                        {row.kind === 'pool' && <Badge tone="muted">{t('admin.kindPool')}</Badge>}
                                        <Tooltip label={t('home.featured')}>
                                            <button
                                                className={
                                                    row.featured
                                                        ? 'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-control bg-gold-soft text-gold disabled:cursor-default disabled:opacity-40'
                                                        : 'flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-faint transition-colors duration-200 hover:bg-overlay hover:text-gold disabled:cursor-default disabled:opacity-40'
                                                }
                                                type="button"
                                                aria-label={t('home.featured')}
                                                aria-pressed={row.featured}
                                                disabled={featuring !== '' || onchain.pending()}
                                                onClick={() => void star(row)}
                                            >
                                                <Icon name="sparkles" size={16} />
                                            </button>
                                        </Tooltip>
                                    </div>

                                    <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[12px] text-faint">
                                        <span className="nums latin-nums" dir="ltr">
                                            {t('admin.locks')}: {when(row.locksAt)}
                                        </span>
                                        <span className="nums latin-nums" dir="ltr">
                                            {t('admin.resolves')}: {when(row.resolvesAt)}
                                        </span>
                                    </p>

                                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                        {/* Available at every status, including resolved: this
                                             writes no transaction, and a market whose question
                                             was worded wrongly is worth correcting after the
                                             fact as much as before it. */}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            icon="edit"
                                            onClick={() => setEditTarget(row)}
                                        >
                                            {t('admin.editAction')}
                                        </Button>
                                        {row.status === 'open' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={onchain.pending()}
                                                onClick={() => void admin.pause(Number(row.id))}
                                            >
                                                {t('admin.pause')}
                                            </Button>
                                        )}
                                        {row.status === 'paused' && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                disabled={onchain.pending()}
                                                onClick={() => void admin.unpause(Number(row.id))}
                                            >
                                                {t('admin.unpause')}
                                            </Button>
                                        )}
                                        {(row.status === 'open' || row.status === 'paused') &&
                                            (closing === row.id ? (
                                                <Button
                                                    variant="danger"
                                                    size="sm"
                                                    icon="alert"
                                                    disabled={onchain.pending()}
                                                    loading={onchain.busy(`close:${ row.id }`)}
                                                    onClick={() => void closeMarket(row)}
                                                >
                                                    {t('admin.confirmClose')}
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={onchain.pending()}
                                                    onClick={() => setClosing(row.id)}
                                                >
                                                    {t('admin.close')}
                                                </Button>
                                            ))}
                                        {(row.status === 'open' ||
                                            row.status === 'paused' ||
                                            row.status === 'closed') && (
                                            <Button
                                                variant="primary"
                                                size="sm"
                                                icon="gavel"
                                                disabled={onchain.pending()}
                                                onClick={() => setResolveTarget(row)}
                                            >
                                                {t('admin.resolveAction')}
                                            </Button>
                                        )}
                                        <span className="ms-auto">
                                            <Tooltip label={t('admin.details')}>
                                                <button
                                                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-control text-muted transition-colors duration-200 hover:bg-overlay hover:text-text"
                                                    type="button"
                                                    aria-label={t('admin.details')}
                                                    aria-expanded={expandedId === row.id}
                                                    onClick={() => setExpandedId(expandedId === row.id ? '' : row.id)}
                                                >
                                                    <Icon
                                                        name={expandedId === row.id ? 'chevron-up' : 'chevron-down'}
                                                        size={17}
                                                    />
                                                </button>
                                            </Tooltip>
                                        </span>
                                    </div>

                                    {expandedId === row.id && (
                                        <div className="mt-3">
                                            <MarketRowDetail
                                                marketId={row.id}
                                                address={row.address}
                                                status={row.status}
                                                kind={row.kind}
                                                collected={row.collected}
                                            />
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                        <div className="mt-5">
                            <Pagination page={page.page} pages={page.pages} onChange={(next) => admin.setPage(next)} />
                        </div>
                    </div>
                ))}

            <ResolveDialog market={resolveTarget} onClose={() => setResolveTarget(null)} />
            <EditMarketDialog market={editTarget} onClose={() => setEditTarget(null)} />
        </div>
    );
}
