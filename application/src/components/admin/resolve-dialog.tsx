import { useEffect, useState } from 'react';

import type { AdminMarketRow } from '../../api.ts';

import { fetchMarketDetail } from '../../lib/admin.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useResource } from '../../hooks/use-resource.ts';

import { formatOdds } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Sheet from '../ui/sheet.tsx';
import Button from '../ui/button.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

// The resolution surface: pick a winner, confirm with a second explicit click, or void
// instead. Both paths are irreversible on-chain, so neither ever fires from one click.
export default function ResolveDialog(props: { market: AdminMarketRow | null; onClose: () => void }) {
    const { t, lang, text } = useLocale();
    const { oddsMode } = usePreferences();
    const admin = useAdmin();
    const onchain = useOnchain();

    const [picked, setPicked] = useState(-1);
    const [arming, setArming] = useState<'none' | 'resolve' | 'void'>('none');

    const detail = useResource(
        () => (props.market === null ? false : props.market.address),
        (address: string) => fetchMarketDetail(address as `0x${string}`, false)
    );

    // A different market in the same dialog starts from scratch: a selection carried over
    // from the previous one would be an irreversible payout aimed at the wrong market.
    const marketId = props.market?.id ?? null;
    useEffect(() => {
        setPicked(-1);
        setArming('none');
    }, [marketId]);

    // The confirm button NAMES the winner. It used to read only "Confirm resolve" while the
    // selection sat in a scrollable list above it - an irreversible payout decision confirmed
    // by a bare red button that never restated what was being decided.
    const pickedLabel = detail.data()?.outcomes[picked]?.label;
    const pickedName = pickedLabel === undefined ? '' : text(pickedLabel);

    const stillTrading = props.market?.status === 'open' || props.market?.status === 'paused';

    const resolve = async (): Promise<void> => {
        if (props.market === null || picked < 0) {
            return;
        }
        if (await admin.resolve(Number(props.market.id), picked)) {
            props.onClose();
            return;
        }
        setArming('none');
    };

    const voidOut = async (): Promise<void> => {
        if (props.market === null) {
            return;
        }
        if (await admin.voidOut(Number(props.market.id))) {
            props.onClose();
            return;
        }
        setArming('none');
    };

    const data = detail.data();

    return (
        <Sheet open={props.market !== null} title={t('admin.resolveTitle')} onClose={() => props.onClose()}>
            <div className="flex flex-col gap-4">
                <div>
                    <p className="text-[14px] font-bold">{props.market === null ? '' : text(props.market.title)}</p>
                    <p className="mt-1 text-[13px] text-muted">{t('admin.resolveHint')}</p>
                </div>

                {stillTrading && (
                    <p className="flex items-start gap-2 rounded-control bg-gold-soft p-3 text-[13px] font-semibold leading-relaxed text-gold">
                        <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                        <span>{t('admin.resolveWhileOpen')}</span>
                    </p>
                )}

                {detail.loading() && <SkeletonList count={2} height="h-12" radius="control" />}

                {data !== undefined && (
                    <ul className="flex flex-col gap-2" role="radiogroup" aria-label={t('admin.outcomes')}>
                        {data.outcomes.map((outcome, index) => (
                            <li key={outcome.label.en}>
                                <button
                                    className={
                                        picked === index
                                            ? 'flex h-12 w-full cursor-pointer items-center gap-3 rounded-control border border-brand bg-brand-soft px-3 text-[14px] font-semibold text-text'
                                            : 'flex h-12 w-full cursor-pointer items-center gap-3 rounded-control border border-line bg-raised px-3 text-[14px] font-semibold text-muted transition-colors duration-200 hover:border-line-strong hover:text-text'
                                    }
                                    type="button"
                                    role="radio"
                                    aria-checked={picked === index}
                                    onClick={() => {
                                        setPicked(index);
                                        setArming('none');
                                    }}
                                >
                                    <span className="min-w-0 flex-1 truncate text-start">{text(outcome.label)}</span>
                                    <span className="nums latin-nums text-[13px] text-faint" dir="ltr">
                                        {formatOdds(Number(outcome.price) / 1e18, lang(), oddsMode())}
                                    </span>
                                    {picked === index && <Icon name="circle-check" size={17} className="text-brand" />}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {arming === 'resolve' ? (
                    <Button
                        variant="danger"
                        block
                        icon="alert"
                        disabled={picked < 0 || onchain.pending()}
                        loading={onchain.busy(`resolve:${props.market?.id ?? ''}`)}
                        onClick={() => void resolve()}
                    >
                        {t('admin.confirmResolve')}: {pickedName}
                    </Button>
                ) : (
                    <Button
                        variant="primary"
                        block
                        icon="gavel"
                        disabled={picked < 0 || onchain.pending()}
                        onClick={() => setArming('resolve')}
                    >
                        {t('admin.resolveAction')}
                    </Button>
                )}

                <div className="border-t border-line pt-3">
                    <p className="mb-2 text-[12px] text-faint">{t('admin.voidHint')}</p>
                    {arming === 'void' ? (
                        <Button
                            variant="danger"
                            size="sm"
                            icon="alert"
                            disabled={onchain.pending()}
                            loading={onchain.busy(`void:${props.market?.id ?? ''}`)}
                            onClick={() => void voidOut()}
                        >
                            {t('admin.confirmVoid')}
                        </Button>
                    ) : (
                        <Button
                            variant="outline"
                            size="sm"
                            icon="circle-x"
                            disabled={onchain.pending()}
                            onClick={() => setArming('void')}
                        >
                            {t('admin.voidAction')}
                        </Button>
                    )}
                </div>
            </div>
        </Sheet>
    );
}
