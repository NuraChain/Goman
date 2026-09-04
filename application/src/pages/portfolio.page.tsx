import { useState } from 'react';
import { Link } from 'react-router';

import { client, PERIODS, type Period, type Position } from '../api.ts';

import { shortAddress, addressGradient } from '../lib/wallet.ts';
import { copyText } from '../lib/clipboard.ts';
import { pageOf } from '../lib/paged.ts';

import { useLocale } from '../stores/locale.store.ts';
import { useChrome } from '../stores/chrome.store.ts';
import { useSession } from '../stores/session.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { useResource } from '../hooks/use-resource.ts';

import { formatMoney, formatSigned, formatFillPrice, formatShares, formatTimeAgo } from '../i18n/format.ts';

import Chart from '../components/ui/chart.tsx';
import Ticker from '../components/ui/ticker.tsx';
import Skeleton from '../components/ui/skeleton.tsx';
import SkeletonList from '../components/ui/skeleton-list.tsx';
import Badge from '../components/ui/badge.tsx';
import Button from '../components/ui/button.tsx';
import Card from '../components/ui/card.tsx';
import StatTile from '../components/ui/stat-tile.tsx';
import EmptyState from '../components/ui/empty-state.tsx';
import PillGroup from '../components/ui/pill-group.tsx';
import { cardClass } from '../components/ui/variants.ts';
import Chip from '../components/ui/chip.tsx';
import Tabs from '../components/ui/tabs.tsx';
import Input from '../components/ui/input.tsx';
import Select from '../components/ui/select.tsx';
import Pagination from '../components/ui/pagination.tsx';

import ClaimableList from '../components/market/claimable-list.tsx';

// The signed-in dashboard, all address-scoped and all real: the wallet IS the account, so
// the identity is the address and every number is derived from that address's chain history
// by the indexer. Signed out, the page is a designed connect prompt.
export default function Portfolio() {
    const { t, lang, text } = useLocale();
    const chrome = useChrome();
    const session = useSession();
    const toasts = useToasts();

    const [period, setPeriod] = useState<Period>('week');
    const [tab, setTab] = useState('positions');
    const [statusFilter, setStatusFilter] = useState<'active' | 'closed'>('active');
    const [query, setQuery] = useState('');
    const [valueDescending, setValueDescending] = useState(true);
    const [positionsPage, setPositionsPage] = useState(1);
    const [activityPage, setActivityPage] = useState(1);

    const connected = session.connected();
    const address = session.address();

    const summary = useResource(
        () => (connected ? address : false),
        (who: string) => client.portfolio.summary({ query: { address: who } })
    );
    const positions = useResource(
        () => (connected ? address : false),
        (who: string) => client.portfolio.positions({ query: { address: who } })
    );
    const profitCurve = useResource(
        () => (connected ? `${address}|${period}` : false),
        (key: string) => {
            const [who = '', activePeriod = 'week'] = key.split('|');
            return client.portfolio.series({ query: { address: who, period: activePeriod as Period } });
        }
    );
    const activity = useResource(
        () => (connected && tab === 'activity' ? address : false),
        (who: string) => client.portfolio.activity({ query: { address: who } })
    );

    const valueOf = (position: Position): number => {
        const outcome = position.market.outcomes.find((candidate) => candidate.id === position.outcomeId);
        const price = outcome?.price ?? 0;
        return position.shares * (position.side === 'yes' ? price : 1 - price);
    };

    const gainOf = (position: Position): number => valueOf(position) - position.shares * position.avgPrice;

    const biggestWin = (positions.data() ?? []).reduce((best, position) => Math.max(best, gainOf(position)), 0);

    const titleOf = (marketId: string): string => {
        const match = (positions.data() ?? []).find((position) => position.marketId === marketId);
        return match === undefined ? `#${marketId}` : text(match.market.title);
    };

    const visiblePositions = (positions.data() ?? [])
        .filter((position) => {
            const settled = position.market.status === 'resolved' || position.market.status === 'voided';
            return statusFilter === 'closed' ? settled : !settled;
        })
        .filter((position) =>
            query.trim() === ''
                ? true
                : position.market.title.en.toLowerCase().includes(query.trim().toLowerCase()) ||
                  position.market.title.fa.includes(query.trim())
        )
        .sort((left, right) => (valueDescending ? valueOf(right) - valueOf(left) : valueOf(left) - valueOf(right)));

    const positionsView = pageOf(visiblePositions, positionsPage, 10);
    const activityView = pageOf(activity.data() ?? [], activityPage, 15);

    const copyAddress = async (): Promise<void> => {
        if (await copyText(address)) {
            toasts.push('info', t('profile.copied'), 'copy');
            return;
        }
        toasts.push('error', t('toast.copyFailed'), 'alert');
    };

    if (!connected) {
        return (
            <section className="shell py-5">
                <div className="mx-auto max-w-5xl">
                    <EmptyState
                        icon="wallet"
                        tone="brand"
                        size="lg"
                        heading
                        title={t('profile.connectTitle')}
                        hint={t('profile.connectHint')}
                    >
                        <Button onClick={() => chrome.openAuth()}>{t('auth.title')}</Button>
                    </EmptyState>
                </div>
            </section>
        );
    }

    const data = summary.data();

    return (
        <section className="shell py-5">
            <div className="mx-auto max-w-5xl">
                <header className="mb-5 flex flex-wrap items-center gap-3 motion-safe:animate-rise">
                    <span
                        className="h-11 w-11 shrink-0 overflow-hidden rounded-full ring-2 ring-line sm:h-12 sm:w-12"
                        style={{ background: addressGradient(address) }}
                        aria-hidden="true"
                    ></span>
                    <div className="min-w-0 flex-1">
                        <h1 className="nums latin-nums text-[17px] font-bold tracking-tight sm:text-xl" dir="ltr">
                            {shortAddress(address)}
                        </h1>
                        <button
                            className="nums latin-nums max-w-full cursor-pointer truncate text-[12px] text-faint transition-colors duration-200 hover:text-text"
                            type="button"
                            dir="ltr"
                            aria-label={t('common.copy')}
                            onClick={() => void copyAddress()}
                        >
                            {address}
                        </button>
                    </div>
                </header>

                {summary.loading() && data === undefined && <Skeleton className="mb-5 h-40 rounded-card" />}

                {data !== undefined && (
                    <div className="mb-8">
                        <div className="mb-3 grid grid-cols-3 gap-2 motion-safe:animate-rise sm:gap-3">
                            <StatTile
                                label={t('profile.positionsValue')}
                                value={formatMoney(data.current, lang(), { compact: true })}
                            />
                            <StatTile
                                label={t('profile.biggestWin')}
                                value={formatSigned(biggestWin, lang())}
                                tone="yes"
                            />
                            <StatTile
                                label={t('profile.predictions')}
                                value={String((positions.data() ?? []).length)}
                            />
                        </div>

                        <Card animate="rise">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-[13px] text-muted">{t('portfolio.profitLoss')}</p>
                                    <p
                                        className={
                                            data.profit >= 0
                                                ? 'text-2xl font-bold text-yes sm:text-3xl'
                                                : 'text-2xl font-bold text-no sm:text-3xl'
                                        }
                                    >
                                        <Ticker text={formatSigned(data.profit, lang())} value={data.profit} />
                                    </p>
                                    <p className="nums mt-0.5 text-[12px] text-faint">
                                        {formatSigned(data.profitToday, lang())} {t('common.today')} ·{' '}
                                        {t('portfolio.balance')}: {formatMoney(data.balance, lang(), { compact: true })}
                                    </p>
                                </div>
                                <PillGroup
                                    items={[...PERIODS].map((entry) => ({
                                        id: entry,
                                        label: t(`leaderboard.${entry}` as 'leaderboard.day')
                                    }))}
                                    active={period}
                                    onChange={(next) => setPeriod(next as Period)}
                                    className="max-w-full overflow-x-auto"
                                />
                            </div>
                            <div className="h-32">
                                {profitCurve.loading() ? (
                                    <Skeleton className="h-full rounded-control" />
                                ) : (
                                    <Chart
                                        points={profitCurve.data()?.points ?? []}
                                        tone={data.profit >= 0 ? 'brand' : 'no'}
                                        className="h-full"
                                    />
                                )}
                            </div>
                        </Card>
                    </div>
                )}

                <div className="mb-8">
                    <ClaimableList
                        onClaimed={() => {
                            summary.refetch();
                            positions.refetch();
                            profitCurve.refetch();
                            activity.refetch();
                        }}
                    />
                </div>

                <Tabs
                    tabs={[
                        { id: 'positions', label: t('portfolio.positions') },
                        { id: 'activity', label: t('portfolio.activity') }
                    ]}
                    active={tab}
                    onChange={setTab}
                />

                {tab === 'positions' && (
                    <div className="pt-3">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                            <Chip
                                compact
                                selected={statusFilter === 'active'}
                                onSelect={() => {
                                    setStatusFilter('active');
                                    setPositionsPage(1);
                                }}
                            >
                                {t('profile.active')}
                            </Chip>
                            <Chip
                                compact
                                selected={statusFilter === 'closed'}
                                onSelect={() => {
                                    setStatusFilter('closed');
                                    setPositionsPage(1);
                                }}
                            >
                                {t('profile.closed')}
                            </Chip>
                            <div className="min-w-40 flex-1">
                                <Input
                                    icon="search"
                                    label={t('profile.searchPositions')}
                                    placeholder={t('profile.searchPositions')}
                                    value={query}
                                    onInput={(next) => {
                                        setQuery(next);
                                        setPositionsPage(1);
                                    }}
                                />
                            </div>
                            <Select
                                options={[
                                    { id: 'desc', label: t('portfolio.valueHigh'), icon: 'sort' as const },
                                    { id: 'asc', label: t('portfolio.valueLow'), icon: 'sort' as const }
                                ]}
                                value={valueDescending ? 'desc' : 'asc'}
                                onChange={(next) => {
                                    setValueDescending(next === 'desc');
                                    setPositionsPage(1);
                                }}
                                label={t('portfolio.current')}
                            />
                        </div>

                        {positions.loading() && positions.data() === undefined && (
                            <SkeletonList count={3} height="h-20" radius="card" gap="md" />
                        )}

                        {positions.data() !== undefined &&
                            (visiblePositions.length > 0 ? (
                                <>
                                    <ul className="grid grid-cols-1 gap-3">
                                        {positionsView.rows.map((position) => (
                                            <li key={position.id}>
                                                <Link
                                                    to={`/market/${position.marketId}`}
                                                    className={`${cardClass({ interactive: true, animate: 'rise' })} flex items-center gap-3 text-text no-underline`}
                                                >
                                                    <span
                                                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-overlay text-xl"
                                                        aria-hidden="true"
                                                    >
                                                        {position.market.emoji}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        <span className="block truncate text-[14px] font-bold">
                                                            {text(position.market.title)}
                                                        </span>
                                                        <span className="mt-0.5 flex items-center gap-2 text-[12px] text-muted">
                                                            <Badge tone={position.side === 'yes' ? 'yes' : 'no'}>
                                                                {position.side === 'yes'
                                                                    ? t('market.yes')
                                                                    : t('market.no')}
                                                            </Badge>
                                                            <span className="nums">
                                                                {formatShares(position.shares, lang())} ×{' '}
                                                                {formatFillPrice(position.avgPrice, lang())}
                                                            </span>
                                                        </span>
                                                    </span>
                                                    <span className="text-end">
                                                        <span className="nums block text-[15px] font-bold">
                                                            {formatMoney(valueOf(position), lang(), { compact: true })}
                                                        </span>
                                                        <span
                                                            className={
                                                                gainOf(position) >= 0
                                                                    ? 'nums block text-[12px] font-semibold text-yes'
                                                                    : 'nums block text-[12px] font-semibold text-no'
                                                            }
                                                        >
                                                            {formatSigned(gainOf(position), lang())}
                                                        </span>
                                                    </span>
                                                </Link>
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="mt-5">
                                        <Pagination
                                            page={positionsView.current}
                                            pages={positionsView.pages}
                                            onChange={setPositionsPage}
                                        />
                                    </div>
                                </>
                            ) : (
                                <EmptyState
                                    icon="wallet"
                                    title={statusFilter === 'closed' ? t('profile.noClosed') : t('portfolio.empty')}
                                    hint={
                                        statusFilter === 'closed' ? t('profile.noClosedHint') : t('portfolio.emptyHint')
                                    }
                                >
                                    <Link to="/browse" className="no-underline">
                                        <Button variant="primary" icon="flame">
                                            {t('portfolio.explore')}
                                        </Button>
                                    </Link>
                                </EmptyState>
                            ))}
                    </div>
                )}

                {tab === 'activity' &&
                    (activity.loading() ? (
                        <SkeletonList count={3} height="h-10" className="pt-3" />
                    ) : (
                        <>
                            <ul className="flex flex-col pt-3">
                                {activityView.rows.map((entry) => (
                                    <li
                                        key={entry.id}
                                        className="flex items-center gap-3 border-b border-line py-2.5 text-[13px] last:border-b-0"
                                    >
                                        <span
                                            className={
                                                entry.side === 'yes'
                                                    ? 'h-2 w-2 shrink-0 rounded-full bg-yes'
                                                    : 'h-2 w-2 shrink-0 rounded-full bg-no'
                                            }
                                            aria-hidden="true"
                                        ></span>
                                        <span className="min-w-0 flex-1 truncate">
                                            <span className="text-muted">
                                                {entry.action === 'buy' ? t('market.bought') : t('market.sold')}{' '}
                                            </span>
                                            <span className="nums font-semibold">
                                                {formatShares(entry.shares, lang())}
                                            </span>
                                            <span
                                                className={
                                                    entry.side === 'yes'
                                                        ? 'font-semibold text-yes'
                                                        : 'font-semibold text-no'
                                                }
                                            >
                                                {' '}
                                                {entry.side === 'yes' ? t('market.yes') : t('market.no')}{' '}
                                            </span>
                                            <span className="text-muted">· {titleOf(entry.marketId)}</span>
                                        </span>
                                        <span className="nums shrink-0 text-muted">
                                            @ {formatFillPrice(entry.price, lang())}
                                        </span>
                                        <span className="shrink-0 text-faint">{formatTimeAgo(entry.at, lang())}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-5">
                                <Pagination
                                    page={activityView.current}
                                    pages={activityView.pages}
                                    onChange={setActivityPage}
                                />
                            </div>
                        </>
                    ))}
            </div>
        </section>
    );
}
