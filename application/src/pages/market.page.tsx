import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { client, RANGES, type Market, type Range, type Side } from '../api.ts';

import { categoryIcon, isBinary } from '../lib/market.ts';
import { shortAddress } from '../lib/wallet.ts';
import { copyText } from '../lib/clipboard.ts';

import { useLocale } from '../stores/locale.store.ts';
import { usePreferences } from '../stores/preferences.store.ts';
import { useCategories } from '../stores/categories.store.ts';
import { useChrome } from '../stores/chrome.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { useResource } from '../hooks/use-resource.ts';

import {
    formatOdds,
    formatFillPrice,
    formatShares,
    formatPoints,
    formatVolume,
    formatDateTime,
    formatTimeAgo
} from '../i18n/format.ts';

import Icon from '../icons/icon.tsx';

import Tooltip from '../components/ui/tooltip.tsx';
import Button from '../components/ui/button.tsx';
import Chart from '../components/ui/chart.tsx';
import Ticker from '../components/ui/ticker.tsx';
import Badge from '../components/ui/badge.tsx';
import Tabs from '../components/ui/tabs.tsx';
import Sheet from '../components/ui/sheet.tsx';
import Skeleton from '../components/ui/skeleton.tsx';
import MarketCard from '../components/market/market-card.tsx';
import TradeTicket from '../components/market/trade-ticket.tsx';
import FavoriteButton from '../components/market/favorite-button.tsx';
import OutcomePair from '../components/market/outcome-pair.tsx';
import Pagination from '../components/ui/pagination.tsx';
import Rail from '../components/ui/rail.tsx';
import Card from '../components/ui/card.tsx';
import SkeletonList from '../components/ui/skeleton-list.tsx';
import PillGroup from '../components/ui/pill-group.tsx';
import { cardClass } from '../components/ui/variants.ts';
import MarketAvatar from '../components/market/market-avatar.tsx';

/** Rows per page for the activity and holders tabs - the window asked of the server. */
const PAGE_SIZE = 10;

export default function MarketPage() {
    const { t, lang, text } = useLocale();
    const { oddsMode } = usePreferences();
    const categories = useCategories();
    const params = useParams();
    const [searchParams] = useSearchParams();
    const chrome = useChrome();
    const toasts = useToasts();

    const [side, setSide] = useState<Side | ''>('');
    const [chosenOutcomeId, setChosenOutcomeId] = useState('');
    const [range, setRange] = useState<Range>('1w');
    const [tab, setTab] = useState('activity');
    const [rulesOpen, setRulesOpen] = useState(false);
    const [tradeOpen, setTradeOpen] = useState(false);
    const [activityPage, setActivityPage] = useState(1);
    const [holdersPage, setHoldersPage] = useState(1);

    const requestConnect = (): void => {
        setTradeOpen(false);
        chrome.openAuth();
    };

    const share = async (): Promise<void> => {
        if (await copyText(location.href)) {
            toasts.push('info', t('toast.linkCopied'), 'copy');
            return;
        }
        toasts.push('error', t('toast.copyFailed'), 'alert');
    };

    // Navigating AWAY clears the route param while these resources are still live, and
    // interpolating an absent param into a template literal yields the STRING "undefined" - a
    // perfectly non-empty source key. That fetched `/api/markets/undefined/activity` on every
    // departure: a guaranteed 404 and a red console error. A source of `false` is how a
    // resource says "nothing to fetch".
    const marketId = params['id'];

    const market = useResource(
        () => marketId ?? false,
        (id: string) => client.markets.one({ params: { id } })
    );

    const data = market.data();
    const outcomes = data?.outcomes ?? [];
    const linkedOutcomeId = searchParams.get('outcome') ?? '';
    const linkedSide: Side = searchParams.get('side') === 'no' ? 'no' : 'yes';
    const pickedSide: Side = side === '' ? linkedSide : side;
    const outcome =
        outcomes.find((candidate) => candidate.id === (chosenOutcomeId === '' ? linkedOutcomeId : chosenOutcomeId)) ??
        outcomes[0];

    const series = useResource(
        () => (data !== undefined && outcome !== undefined ? `${data.id}|${outcome.id}|${range}` : false),
        (key: string) => {
            const [id = '', outcomeId = '', activeRange = '1w'] = key.split('|');
            return client.markets.series({
                params: { id },
                query: { outcome: outcomeId, range: activeRange as Range }
            });
        }
    );

    // Both lists page on the SERVER, so the page rides the source key: changing it refetches
    // that window instead of re-slicing a fixed prefix the server happened to send.
    const activity = useResource(
        () => (tab === 'activity' && marketId !== undefined ? `${marketId}|${activityPage}` : false),
        (key: string) => {
            const [id = '', page = '1'] = key.split('|');
            return client.markets.activity({ params: { id }, query: { page: Number(page), limit: PAGE_SIZE } });
        }
    );

    const holders = useResource(
        () => (tab === 'holders' && marketId !== undefined ? `${marketId}|${holdersPage}` : false),
        (key: string) => {
            const [id = '', page = '1'] = key.split('|');
            return client.markets.holders({ params: { id }, query: { page: Number(page), limit: PAGE_SIZE } });
        }
    );

    const relatedPage = useResource(
        () => (data === undefined ? false : `${data.category}|${data.id}`),
        (key: string) => {
            const [category = '', exclude = ''] = key.split('|');
            return client.markets.list({ query: { category, exclude, limit: 12 } });
        }
    );

    const related = relatedPage.data()?.rows ?? [];

    /** Everything a confirmed trade changes - the document alone was never enough. */
    const refreshMarket = (): void => {
        market.refetch();
        series.refetch();
        activity.refetch();
        holders.refetch();
    };

    const open = data?.status === 'open';
    const activityRows = activity.data()?.rows ?? [];
    const holderRows = holders.data()?.rows ?? [];

    // `side` belongs in the key: a BINARY market reports both sides under the SAME outcomeId
    // ('yes'), so an account holding yes and no produced two rows with one key - the second
    // displaced the first on every update.
    const holderKey = (entry: { user: string; outcomeId: string; side: string }): string =>
        `${entry.user}/${entry.outcomeId}/${entry.side}`;

    if (market.loading() || data === undefined || outcome === undefined) {
        return (
            <section className="shell py-5">
                <Skeleton className="mb-4 h-9 max-w-xl rounded-control" />
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_21rem]">
                    <Skeleton className="h-72 rounded-card" />
                    <Skeleton className="h-72 rounded-card" />
                </div>
            </section>
        );
    }

    const lead = outcome;

    return (
        <section className="shell py-5">
            <div>
                <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
                    <div className="min-w-0">
                        <header className="mb-4 motion-safe:animate-rise">
                            <div className="mb-2 flex items-center gap-2 text-[13px] text-muted">
                                <Badge tone="muted" icon={categoryIcon(data.category)}>
                                    {categories.label(data.category)}
                                </Badge>
                                <span className="nums flex min-w-0 items-center gap-1 truncate">
                                    <Icon name="clock" size={13} className="shrink-0" />
                                    {t('market.resolves')} {formatDateTime(data.endsAt, lang())}
                                </span>
                                <span className="ms-auto flex gap-1">
                                    <FavoriteButton marketId={data.id} size="md" />
                                    <Tooltip label={t('market.share')}>
                                        <button
                                            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-control text-muted transition-colors duration-200 hover:bg-overlay hover:text-text"
                                            type="button"
                                            aria-label={t('market.share')}
                                            onClick={() => void share()}
                                        >
                                            <Icon name="share" size={17} />
                                        </button>
                                    </Tooltip>
                                </span>
                            </div>
                            <div className="flex items-start gap-3">
                                <MarketAvatar image={data.image} emoji={data.emoji} size="lg" />
                                <h1 className="text-xl font-bold leading-snug sm:text-2xl">{text(data.title)}</h1>
                            </div>
                            {!open && (
                                <div
                                    className={
                                        data.status === 'resolved'
                                            ? 'mt-3 flex items-center gap-2 rounded-control bg-yes-soft px-3 py-2 text-[13px] font-semibold text-yes'
                                            : 'mt-3 flex items-center gap-2 rounded-control bg-overlay px-3 py-2 text-[13px] font-semibold text-muted'
                                    }
                                >
                                    <Icon name={data.status === 'resolved' ? 'trophy' : 'info'} size={15} />
                                    <span>{t(`market.status_${data.status}` as 'market.status_resolved')}</span>
                                    {data.status === 'resolved' && data.winningOutcomeId !== null && (
                                        <span className="font-bold">
                                            {data.winningOutcomeId === 'yes'
                                                ? t('market.yes')
                                                : data.winningOutcomeId === 'no'
                                                  ? t('market.no')
                                                  : text(
                                                        outcomes.find((entry) => entry.id === data.winningOutcomeId)
                                                            ?.label ?? { en: '', fa: '' }
                                                    )}
                                        </span>
                                    )}
                                </div>
                            )}
                            <div className="mt-3 flex items-center gap-4">
                                <p className="text-3xl font-bold text-brand">
                                    <Ticker text={formatOdds(lead.price, lang(), oddsMode())} value={lead.price} />
                                </p>
                                <Badge
                                    tone={lead.change24h >= 0 ? 'yes' : 'no'}
                                    icon={lead.change24h >= 0 ? 'trending-up' : 'trending-down'}
                                >
                                    <span className="latin-nums" dir="ltr">
                                        {formatPoints(lead.change24h, lang())} {t('market.points')}
                                    </span>
                                </Badge>
                                <span className="nums ms-auto flex items-center gap-1 text-[13px] text-faint">
                                    <Icon name="volume" size={14} />
                                    {formatVolume(data.volume, lang())}
                                </span>
                            </div>
                        </header>

                        <Card animate="rise" className="mb-5">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                {!isBinary(data) && (
                                    <div className="rail gap-1.5">
                                        {outcomes.map((entry) => (
                                            <button
                                                key={entry.id}
                                                className={
                                                    lead.id === entry.id
                                                        ? 'h-8 shrink-0 cursor-pointer rounded-full bg-text px-3 text-[12px] font-bold text-surface'
                                                        : 'h-8 shrink-0 cursor-pointer rounded-full border border-line px-3 text-[12px] font-semibold text-muted transition-colors duration-200 hover:text-text'
                                                }
                                                type="button"
                                                onClick={() => setChosenOutcomeId(entry.id)}
                                            >
                                                {text(entry.label)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <PillGroup
                                    items={[...RANGES].map((entry) => ({ id: entry, label: entry }))}
                                    active={range}
                                    onChange={(next) => setRange(next as Range)}
                                    latinNums
                                    className="ms-auto"
                                />
                            </div>
                            <div className="h-44">
                                {series.loading() ? (
                                    <Skeleton className="h-full rounded-control" />
                                ) : (
                                    <Chart points={series.data()?.points ?? []} className="h-full" />
                                )}
                            </div>
                        </Card>

                        <Card padding="none" animate="rise" className="mb-5">
                            <button
                                className="flex h-12 w-full cursor-pointer items-center gap-2 px-4 text-[14px] font-bold"
                                type="button"
                                aria-expanded={rulesOpen}
                                onClick={() => setRulesOpen(!rulesOpen)}
                            >
                                <Icon name="rules" size={16} className="text-muted" />
                                <span>{t('market.rules')}</span>
                                <Icon
                                    name={rulesOpen ? 'chevron-up' : 'chevron-down'}
                                    size={16}
                                    className="ms-auto text-faint"
                                />
                            </button>
                            {rulesOpen && (
                                <p className="border-t border-line px-4 py-3 text-[14px] leading-relaxed text-muted motion-safe:animate-fade">
                                    {text(data.rules)}
                                </p>
                            )}
                        </Card>

                        <div className="mb-6 motion-safe:animate-rise">
                            <Tabs
                                tabs={[
                                    { id: 'activity', label: t('market.activity') },
                                    { id: 'holders', label: t('market.holders') }
                                ]}
                                active={tab}
                                onChange={setTab}
                            />
                            <div className="pt-3">
                                {tab === 'activity' &&
                                    (activity.loading() ? (
                                        <SkeletonList count={3} height="h-9" className="pt-1" />
                                    ) : (
                                        <>
                                            <ul className="flex flex-col">
                                                {activityRows.map((entry) => (
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
                                                            <span className="nums latin-nums font-semibold" dir="ltr">
                                                                {shortAddress(entry.user)}
                                                            </span>
                                                            <span className="text-muted">
                                                                {' '}
                                                                {entry.action === 'buy'
                                                                    ? t('market.bought')
                                                                    : t('market.sold')}{' '}
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
                                                                {entry.side === 'yes'
                                                                    ? t('market.yes')
                                                                    : t('market.no')}{' '}
                                                            </span>
                                                            <span className="nums text-muted">
                                                                @ {formatFillPrice(entry.price, lang())}
                                                            </span>
                                                        </span>
                                                        <span className="shrink-0 text-faint">
                                                            {formatTimeAgo(entry.at, lang())}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                            <div className="mt-4">
                                                <Pagination
                                                    page={activity.data()?.page ?? 1}
                                                    pages={activity.data()?.pages ?? 1}
                                                    onChange={setActivityPage}
                                                />
                                            </div>
                                        </>
                                    ))}
                                {tab === 'holders' &&
                                    (holders.loading() ? (
                                        <SkeletonList count={3} height="h-9" className="pt-1" />
                                    ) : (
                                        <>
                                            <ul className="flex flex-col">
                                                {holderRows.map((entry) => (
                                                    <li
                                                        key={holderKey(entry)}
                                                        className="flex items-center gap-3 border-b border-line py-2.5 text-[13px] last:border-b-0"
                                                    >
                                                        <span
                                                            className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-soft text-[11px] font-bold text-gold"
                                                            aria-hidden="true"
                                                        >
                                                            {entry.user.slice(2, 3).toUpperCase()}
                                                        </span>
                                                        <span
                                                            className="nums latin-nums min-w-0 flex-1 truncate font-semibold"
                                                            dir="ltr"
                                                        >
                                                            {shortAddress(entry.user)}
                                                        </span>
                                                        <Badge tone={entry.side === 'yes' ? 'yes' : 'no'}>
                                                            {entry.side === 'yes' ? t('market.yes') : t('market.no')}
                                                        </Badge>
                                                        <span className="nums w-20 text-end font-semibold">
                                                            {formatShares(entry.shares, lang())}
                                                        </span>
                                                    </li>
                                                ))}
                                            </ul>
                                            <div className="mt-4">
                                                <Pagination
                                                    page={holders.data()?.page ?? 1}
                                                    pages={holders.data()?.pages ?? 1}
                                                    onChange={setHoldersPage}
                                                />
                                            </div>
                                        </>
                                    ))}
                            </div>
                        </div>

                        {related.length > 0 && (
                            <Rail
                                items={related}
                                itemKey={(entry: Market) => entry.id}
                                label={t('market.related')}
                                slotClass="w-[19rem] shrink-0 sm:w-[21rem] lg:w-[calc((100%-1rem)/2)] 2xl:w-[calc((100%-2rem)/3)]"
                                heading={<h2 className="text-lg font-bold tracking-tight">{t('market.related')}</h2>}
                            >
                                {(entry: Market) => <MarketCard market={entry} />}
                            </Rail>
                        )}
                    </div>

                    {open && (
                        <aside className={`${cardClass({})} sticky top-20 hidden lg:block`}>
                            <TradeTicket
                                market={data}
                                outcome={lead}
                                side={pickedSide}
                                onSideChange={setSide}
                                onConnect={() => requestConnect()}
                                onTraded={() => {
                                    setTradeOpen(false);
                                    refreshMarket();
                                }}
                            />
                        </aside>
                    )}
                </div>

                {open && (
                    <div className="fixed inset-x-0 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom))] z-[var(--z-buybar)] border-t border-line bg-chrome px-4 py-2.5 backdrop-blur-md lg:hidden">
                        {data.noIndex !== null ? (
                            <OutcomePair
                                yesPrice={lead.price}
                                size="lg"
                                buyLabel
                                onPick={(picked) => {
                                    setSide(picked);
                                    setTradeOpen(true);
                                }}
                            />
                        ) : (
                            <Button
                                variant="primary"
                                size="lg"
                                block
                                onClick={() => {
                                    setSide('yes');
                                    setTradeOpen(true);
                                }}
                            >
                                {t('market.buy')} · {text(lead.label)}
                            </Button>
                        )}
                    </div>
                )}

                <Sheet open={tradeOpen} title={text(data.title)} onClose={() => setTradeOpen(false)}>
                    <TradeTicket
                        market={data}
                        outcome={lead}
                        side={pickedSide}
                        onSideChange={setSide}
                        onConnect={() => requestConnect()}
                        onTraded={() => {
                            setTradeOpen(false);
                            refreshMarket();
                        }}
                    />
                </Sheet>
            </div>
        </section>
    );
}
