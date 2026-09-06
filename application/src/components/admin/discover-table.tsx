import { useLocale } from '../../stores/locale.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useCreateDraft } from '../../stores/create-draft.store.ts';

import { formatMoney, formatDate, formatTimeAgo, formatFillPrice } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Card from '../ui/card.tsx';
import Input from '../ui/input.tsx';
import Chip from '../ui/chip.tsx';
import Button from '../ui/button.tsx';
import EmptyState from '../ui/empty-state.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

// What is live on Polymarket that this registry does not have. The crawl and the matching both
// run on the server (see server/src/discover.ts); this screen is the triage surface over it.
//
// "Create here" seeds the create form with the venue's wording, rules, answers, image and end
// date - it does NOT deploy. The Persian half, the category when no tag mapped, and the
// liquidity are still the admin's to write, and the market still leaves through their own
// signed transaction. `onImport` is how the host switches to the form once the draft is set.
export default function DiscoverTable(props: { onImport?: () => void }) {
    const { t, lang } = useLocale();
    const admin = useAdmin();
    const draft = useCreateDraft();

    const page = admin.discovery.data();
    const rows = page?.rows ?? [];
    const filters = admin.discoverFilters();
    const firstLoad = admin.discovery.loading() && page === undefined;

    return (
        <Card>
            <div className="mb-3 flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                    <h2 className="text-lg font-bold tracking-tight">{t('admin.discover')}</h2>
                    <p className="text-[13px] text-muted">{t('admin.discoverHint')}</p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    icon="activity"
                    loading={admin.discovery.loading()}
                    onClick={() => admin.refreshDiscovery()}
                >
                    {t('admin.discoverRefresh')}
                </Button>
            </div>

            {page !== undefined && (
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                    <span className="nums font-bold text-gold">
                        {page.missing} {t('admin.discoverMissingCount')}
                    </span>
                    <span className="nums text-muted">
                        {page.crawled} {t('admin.discoverCrawled')}
                    </span>
                    <span className="text-faint">{formatTimeAgo(page.fetchedAt, lang())}</span>
                </div>
            )}

            <div className="mb-3 flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                    <Input
                        size="sm"
                        icon="search"
                        label={t('nav.search')}
                        placeholder={t('nav.search')}
                        onInput={(next) => admin.setDiscoverSearch(next)}
                    />
                </div>
                <Chip
                    compact
                    selected={filters.missingOnly}
                    onSelect={() => admin.setDiscoverMissingOnly(!filters.missingOnly)}
                >
                    <Icon name="filters" size={14} />
                    {t('admin.discoverOnlyMissing')}
                </Chip>
            </div>

            {firstLoad && <SkeletonList count={5} height="h-14" />}

            {admin.discovery.error() !== null && page === undefined && (
                <EmptyState icon="alert" title={t('admin.discoverFailed')} hint={t('admin.discoverFailedHint')} />
            )}

            {page !== undefined && rows.length === 0 && (
                <EmptyState icon="search" title={t('admin.discoverEmpty')} hint={t('admin.discoverEmptyHint')} />
            )}

            {rows.length > 0 && (
                <ul className="flex flex-col">
                    {rows.map((row) => (
                        <li
                            key={row.sourceId}
                            className="flex items-start gap-3 border-b border-line py-3 last:border-b-0"
                        >
                            {row.image === '' ? (
                                <span
                                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-overlay text-faint"
                                    aria-hidden="true"
                                >
                                    <Icon name="globe" size={16} />
                                </span>
                            ) : (
                                <img
                                    className="h-9 w-9 shrink-0 rounded-control object-cover"
                                    src={row.image}
                                    alt=""
                                    aria-hidden="true"
                                    loading="lazy"
                                    width={36}
                                    height={36}
                                />
                            )}

                            <div className="min-w-0 flex-1">
                                <a
                                    className="flex items-start gap-1.5 text-[14px] font-semibold text-text no-underline transition-colors duration-200 hover:text-brand"
                                    href={row.url}
                                    target="_blank"
                                    rel="noreferrer"
                                >
                                    <span className="min-w-0" dir="auto">
                                        {row.question}
                                    </span>
                                    <Icon name="external" size={13} className="mt-1 shrink-0 text-faint" />
                                </a>

                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                                    {row.outcomes.slice(0, 3).map((outcome) => (
                                        <span key={outcome.label} className="nums">
                                            {outcome.label} {formatFillPrice(outcome.price, lang())}
                                        </span>
                                    ))}
                                    {row.volume > 0 && (
                                        <span className="nums">
                                            {formatMoney(row.volume, lang(), { compact: true })}
                                        </span>
                                    )}
                                    {row.endsAt !== '' && (
                                        <span className="nums">{formatDate(row.endsAt, lang())}</span>
                                    )}
                                </div>

                                {/* The match is shown WITH its score and title: a number alone asks the
                                    reader to trust it, and this one is a heuristic. */}
                                {row.match !== null && (
                                    <p className="mt-1 truncate text-[12px] text-faint">
                                        {t('admin.discoverMatched')}: {row.match.title}{' '}
                                        <span className="nums latin-nums">{row.match.score}</span>
                                    </p>
                                )}
                            </div>

                            <div className="flex shrink-0 flex-col items-end gap-2">
                                <span
                                    className={
                                        row.match === null
                                            ? 'inline-flex items-center gap-1 rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-gold'
                                            : 'inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand'
                                    }
                                >
                                    <Icon name={row.match === null ? 'plus' : 'check'} size={12} />
                                    {row.match === null ? t('admin.discoverMissing') : t('admin.discoverHave')}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon="sparkles"
                                    onClick={() => {
                                        draft.importDiscovered(row);
                                        props.onImport?.();
                                    }}
                                >
                                    {t('admin.discoverImport')}
                                </Button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
