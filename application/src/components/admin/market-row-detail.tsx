import type { MarketStatusName } from '../../api.ts';

import { fetchMarketDetail, shortEther } from '../../lib/admin.ts';
import { chain } from '../../lib/chain.ts';
import { copyText } from '../../lib/clipboard.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';
import { useResource } from '../../hooks/use-resource.ts';

import { formatOdds } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Badge from '../ui/badge.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

// The expanded strip under a market row: live per-outcome prices and reserves read from the
// clone itself (trustless), the clone address, and the fees this market sent the treasury.
export default function MarketRowDetail(props: { address: string; status: MarketStatusName; collected: number }) {
    const { t, lang, text } = useLocale();
    const { oddsMode } = usePreferences();
    const toasts = useToasts();

    const detail = useResource(
        () => props.address,
        (address: string) => fetchMarketDetail(address as `0x${string}`, props.status === 'resolved')
    );

    const copy = async (): Promise<void> => {
        if (await copyText(props.address)) {
            toasts.push('info', t('profile.copied'), 'copy');
            return;
        }
        toasts.push('error', t('toast.copyFailed'), 'alert');
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
                        <Badge tone="gold">
                            {t('admin.collected')}:{' '}
                            <span className="nums latin-nums" dir="ltr">
                                {props.collected.toFixed(4)} {chain.nativeCurrency.symbol}
                            </span>
                        </Badge>
                    </div>
                </div>
            )}
        </div>
    );
}
