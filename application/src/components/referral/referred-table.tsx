import type { ReferredUser } from '../../api.ts';

import { shortAddress, addressGradient } from '../../lib/wallet.ts';

import { useLocale } from '../../stores/locale.store.ts';

import { formatMoney, formatCount, formatTimeAgo } from '../../i18n/format.ts';

import Card from '../ui/card.tsx';
import Badge from '../ui/badge.tsx';
import EmptyState from '../ui/empty-state.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

// Everyone a referrer has brought in, both tiers in one list. The tier travels as a labelled
// badge rather than as a colour, because which one someone is decides what they are worth.
//
// The roster is never filtered by the selected period - a quiet week should read as zeros
// against real names, not as an empty page - but the trading columns beside each name are
// the window's.
export default function ReferredTable(props: { rows: ReferredUser[]; loading: boolean }) {
    const { t, lang } = useLocale();

    return (
        <Card animate="rise">
            <h2 className="text-lg font-bold tracking-tight">{t('referral.referred')}</h2>
            <p className="mb-4 text-[13px] text-muted">{t('referral.referredHint')}</p>

            {props.loading && props.rows.length === 0 && <SkeletonList count={4} height="h-12" />}

            {!props.loading && props.rows.length === 0 && (
                <EmptyState icon="user" title={t('referral.noReferred')} hint={t('referral.noReferredHint')} />
            )}

            {props.rows.length > 0 && (
                <ul className="flex flex-col">
                    {props.rows.map((row) => (
                        <li
                            key={row.address}
                            className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line py-3 last:border-b-0"
                        >
                            <span
                                className="h-8 w-8 shrink-0 overflow-hidden rounded-full ring-1 ring-line"
                                style={{ background: addressGradient(row.address) }}
                                aria-hidden="true"
                            ></span>

                            <div className="min-w-0 flex-1">
                                <p className="nums latin-nums text-[14px] font-semibold">
                                    <bdi dir="ltr">{shortAddress(row.address)}</bdi>
                                </p>
                                <p className="text-[12px] text-faint">
                                    {row.lastTradeAt === null
                                        ? t('referral.noTrades')
                                        : formatTimeAgo(row.lastTradeAt, lang())}
                                </p>
                            </div>

                            <Badge tone={row.tier === 'direct' ? 'brand' : 'gold'}>
                                {row.tier === 'direct' ? t('referral.direct') : t('referral.indirect')}
                            </Badge>

                            <div className="flex items-center gap-4 text-end">
                                <div>
                                    <p className="text-[11px] text-muted">{t('referral.trades')}</p>
                                    <p className="nums text-[14px] font-bold">{formatCount(row.trades, lang())}</p>
                                </div>
                                <div>
                                    <p className="text-[11px] text-muted">{t('referral.volume')}</p>
                                    <p className="nums text-[14px] font-bold">
                                        {formatMoney(row.volume, lang(), { compact: true })}
                                    </p>
                                </div>
                                <div>
                                    <p className="text-[11px] text-muted">{t('referral.earned')}</p>
                                    <p className="nums text-[14px] font-bold text-brand">
                                        {formatMoney(row.earned, lang(), { compact: true })}
                                    </p>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </Card>
    );
}
