import { useState } from 'react';

import type { MarketKindName, MarketStatusName } from '../../api.ts';

import { fetchMarketDetail, claimWindowOf, distributionOf, shortEther } from '../../lib/admin.ts';
import { chain } from '../../lib/chain.ts';
import { copyText } from '../../lib/clipboard.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';
import { useResource } from '../../hooks/use-resource.ts';
import { useNow } from '../../hooks/use-now.ts';

import { formatOdds, formatDateTimeShort } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

// The expanded strip under a market row: live per-outcome prices and reserves read from the
// clone itself (trustless), the clone address, the fees this market sent the treasury, and the
// two per-market treasury actions the factory exposes - re-pointing a clone at the current
// treasury, and sweeping what nobody claimed once the claim window has run out.
export default function MarketRowDetail(props: {
    marketId: string;
    address: string;
    status: MarketStatusName;
    kind: MarketKindName;
    collected: number;
}) {
    const { t, lang, text } = useLocale();
    const { oddsMode, calendarSystem } = usePreferences();
    const admin = useAdmin();
    const onchain = useOnchain();
    const toasts = useToasts();

    // Sweeping moves money out of a market for good, so it arms first like close and void.
    const [arming, setArming] = useState(false);

    const settled = props.status === 'resolved' || props.status === 'voided';

    const detail = useResource(
        () => `${props.address}|${props.kind}|${props.status}`,
        (key: string) => {
            const [address = '', kind = 'amm', status = ''] = key.split('|');
            return fetchMarketDetail(address as `0x${string}`, status === 'resolved', kind as MarketKindName);
        }
    );

    // Only settled markets have a deadline at all, and a clone deployed before the claim
    // window existed answers null - which is exactly how the sweep stays hidden on markets
    // whose contract cannot perform it.
    const claimWindow = useResource(
        () => (settled ? `${props.address}|${onchain.writes()}` : false),
        (key: string) => claimWindowOf(key.split('|')[0] as `0x${string}`)
    );

    // Not gated on settlement: auto-payout is a switch that decides what HAPPENS at
    // settlement, so an operator has to be able to set it while the market is still trading.
    const distribution = useResource(
        () => `${props.address}|${props.kind}|${onchain.writes()}`,
        (key: string) => {
            const [address = '', kind = 'amm'] = key.split('|');
            return distributionOf(address as `0x${string}`, kind as MarketKindName);
        }
    );

    const payout = distribution.data() ?? null;

    const now = useNow(60_000);
    const deadline = claimWindow.data() ?? null;
    const expired = deadline !== null && now >= deadline * 1000;

    const copy = async (): Promise<void> => {
        if (await copyText(props.address)) {
            toasts.push('info', t('profile.copied'), 'copy');
            return;
        }
        toasts.push('error', t('toast.copyFailed'), 'alert');
    };

    const sweep = async (): Promise<void> => {
        await admin.sweep(Number(props.marketId));
        setArming(false);
    };

    const data = detail.data();

    return (
        <div className="border-t border-line pt-3">
            {detail.loading() && <SkeletonList count={2} height="h-8" radius="control" />}
            {data !== undefined && (
                <div className="flex flex-col gap-2">
                    <ul className="flex flex-col gap-1.5">
                        {data.outcomes.map((outcome, index) => (
                            <li key={outcome.label.en} className="flex items-center gap-2 text-[13px]">
                                {data.winningOutcome === index && (
                                    <Icon name="trophy" size={14} className="text-gold" />
                                )}
                                <span className="min-w-0 flex-1 truncate font-semibold">{text(outcome.label)}</span>
                                <span className="nums latin-nums text-muted" dir="ltr">
                                    {formatOdds(Number(outcome.price) / 1e18, lang(), oddsMode())}
                                </span>
                                <span className="nums latin-nums w-28 text-end text-faint" dir="ltr">
                                    {shortEther(outcome.reserve)} {chain.nativeCurrency.symbol}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-faint">
                        <button
                            className="nums latin-nums inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-faint transition-colors duration-200 hover:text-text"
                            type="button"
                            aria-label={t('common.copy')}
                            onClick={() => void copy()}
                        >
                            <span className="truncate" dir="ltr">
                                {props.address}
                            </span>
                            <Icon name="copy" size={13} />
                        </button>
                        <Badge tone="muted">{props.kind === 'pool' ? t('admin.kindPool') : t('admin.kindAmm')}</Badge>
                        <Badge tone="muted">
                            {props.kind === 'pool' ? t('admin.poolTotal') : t('admin.backing')}:{' '}
                            <span className="nums latin-nums" dir="ltr">
                                {shortEther(data.totalSets)} {chain.nativeCurrency.symbol}
                            </span>
                        </Badge>
                        <Badge tone="gold">
                            {t('admin.collected')}:{' '}
                            <span className="nums latin-nums" dir="ltr">
                                {props.collected.toFixed(4)} {chain.nativeCurrency.symbol}
                            </span>
                        </Badge>
                        {payout !== null && payout.total > 0 && (
                            <Badge tone={payout.cursor >= payout.total ? 'yes' : 'gold'} icon="deposit">
                                {t('admin.distributeProgress')}:{' '}
                                <span className="nums latin-nums" dir="ltr">
                                    {payout.cursor}/{payout.total}
                                </span>
                            </Badge>
                        )}
                        {deadline !== null && (
                            <Badge tone={expired ? 'no' : 'muted'} icon="clock">
                                {expired ? t('admin.claimsClosed') : t('admin.claimsClose')}:{' '}
                                <span className="nums latin-nums" dir="ltr">
                                    {formatDateTimeShort(
                                        new Date(deadline * 1000).toISOString(),
                                        lang(),
                                        calendarSystem()
                                    )}
                                </span>
                            </Badge>
                        )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {/* Changing the factory's treasury only redirects markets created after
                             it; every clone already deployed keeps paying the address it was
                             born with until this runs against it. */}
                        <Button
                            variant="ghost"
                            size="sm"
                            icon="wallet"
                            disabled={onchain.pending()}
                            loading={onchain.busy(`repoint:${props.marketId}`)}
                            onClick={() => void admin.repoint(Number(props.marketId))}
                        >
                            {t('admin.repoint')}
                        </Button>
                        {/* A payout is a PUSH now: winners are paid in batches instead of
                             having to come back and claim. The button runs the next batch, and
                             the toggle decides whether settling a market starts that by itself. */}
                        {payout !== null && payout.cursor < payout.total && (
                            <Button
                                variant="primary"
                                size="sm"
                                icon="deposit"
                                disabled={onchain.pending()}
                                loading={onchain.busy(`distribute:${props.marketId}`)}
                                onClick={() => void admin.distribute(Number(props.marketId), 0)}
                            >
                                {t('admin.distribute')}
                            </Button>
                        )}
                        {payout !== null && (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={onchain.pending()}
                                loading={onchain.busy(`auto:${props.marketId}`)}
                                onClick={() => void admin.setAutoDistribute(Number(props.marketId), !payout.auto)}
                            >
                                {payout.auto ? t('admin.autoDisable') : t('admin.autoEnable')}
                            </Button>
                        )}
                        {expired &&
                            (arming ? (
                                <Button
                                    variant="danger"
                                    size="sm"
                                    icon="alert"
                                    disabled={onchain.pending()}
                                    loading={onchain.busy(`sweep:${props.marketId}`)}
                                    onClick={() => void sweep()}
                                >
                                    {t('admin.confirmSweep')}
                                </Button>
                            ) : (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    icon="deposit"
                                    disabled={onchain.pending()}
                                    onClick={() => setArming(true)}
                                >
                                    {t('admin.sweep')}
                                </Button>
                            ))}
                    </div>
                </div>
            )}
        </div>
    );
}
