import { useEffect, useState } from 'react';

import type { AdminMarketRow } from '../../api.ts';

import { fetchMarketDetail, resolutionVotes } from '../../lib/admin.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useAdmin } from '../../stores/admin.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useConfig } from '../../stores/config.store.ts';
import { useResource } from '../../hooks/use-resource.ts';

import { formatOdds, faDigits } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Sheet from '../ui/sheet.tsx';
import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

// The resolution surface: pick a winner, confirm with a second explicit click, or void
// instead. Both paths are irreversible on-chain, so neither ever fires from one click.
//
// Resolution is an N-of-M multisig on the factory, so a confirmation is usually NOT a
// settlement: it records this signer's vote and the market only resolves when one outcome
// holds `requiredConfirmations` of them. The dialog has to say which of the two a click is
// about to do - it used to promise resolution every time, so an admin clicked Resolve, got a
// success toast, and watched the market stay Closed with nothing to explain it.
export default function ResolveDialog(props: { market: AdminMarketRow | null; onClose: () => void }) {
    const { t, lang, text } = useLocale();
    const { oddsMode } = usePreferences();
    const session = useSession();
    const admin = useAdmin();
    const onchain = useOnchain();
    const config = useConfig();

    const [picked, setPicked] = useState(-1);
    const [arming, setArming] = useState<'none' | 'resolve' | 'void'>('none');

    const detail = useResource(
        () => (props.market === null ? false : `${props.market.address}|${props.market.kind}`),
        (key: string) => {
            const [address = '', kind = 'amm'] = key.split('|');
            return fetchMarketDetail(address as `0x${string}`, false, kind as 'amm' | 'pool');
        }
    );

    const factory = config.data()?.factory ?? '';

    // `writes()` rides the source so the tally re-reads the moment this wallet's own
    // confirmation is mined and indexed - the whole point of the panel is to show the count
    // move without a reload.
    const votes = useResource(
        () =>
            props.market === null || factory === ''
                ? false
                : `${factory}|${props.market.id}|${props.market.outcomeCount}|${session.address()}|${onchain.writes()}`,
        (key: string) => {
            const [address = '', id = '0', count = '0', account = ''] = key.split('|');
            return resolutionVotes(address as `0x${string}`, Number(id), Number(count), account);
        }
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

    // Counts in the reader's own digits: a Latin tally sitting beside Persian odds in the
    // same row is exactly the mix the app pins numerals to avoid.
    const count = (value: number): string => (lang() === 'fa' ? faDigits(String(value)) : String(value));

    const stillTrading = props.market?.status === 'open' || props.market?.status === 'paused';

    const required = admin.policy.data()?.required ?? 0;
    const tally = votes.data();
    const counts = tally?.counts ?? [];
    const mine = tally?.mine ?? null;
    // Undefined while the read is in flight: the confirm button stays enabled rather than
    // flickering shut on every re-read, and the factory rejects a non-signer anyway.
    const barred = tally !== undefined && !tally.isSigner;

    // Re-confirming the outcome this wallet already voted for SETTLES the market in the
    // factory, whatever the tally says; any other confirmation moves the vote, and only the one
    // that reaches quorum settles. The button says which of the two it is about to do - and with
    // nothing picked yet it names the ACTION, because a disabled button should not be guessing.
    const settles = picked < 0 || required === 0 || mine === picked || (counts[picked] ?? 0) + 1 >= required;

    const resolve = async (): Promise<void> => {
        if (props.market === null || picked < 0) {
            return;
        }
        const settling = settles;
        if (await admin.resolve(Number(props.market.id), picked)) {
            // A vote that did not reach quorum leaves the market exactly where it was. Closing
            // on it would report a settlement that has not happened; stay, and show the count.
            if (settling) {
                props.onClose();
                return;
            }
            votes.refetch();
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

                {required > 1 && (
                    <div className="rounded-control border border-line bg-raised p-3">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold">
                            <Icon name="holders" size={15} className="shrink-0 text-faint" />
                            <span>{t('admin.quorum')}</span>
                            <span className="nums text-muted">{count(required)}</span>
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-faint">{t('admin.quorumHint')}</p>
                    </div>
                )}

                {barred && (
                    <p className="flex items-start gap-2 rounded-control bg-no-soft p-3 text-[13px] font-semibold leading-relaxed text-no">
                        <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                        <span>{t('admin.notSigner')}</span>
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
                                            ? 'flex min-h-12 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-brand bg-brand-soft px-3 py-2 text-[14px] font-semibold text-text'
                                            : 'flex min-h-12 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 rounded-control border border-line bg-raised px-3 py-2 text-[14px] font-semibold text-muted transition-colors duration-200 hover:border-line-strong hover:text-text'
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
                                    {mine === index && <Badge tone="brand">{t('admin.yourVote')}</Badge>}
                                    {required > 1 && (counts[index] ?? 0) > 0 && (
                                        <Badge tone="gold">
                                            <span className="nums" dir="ltr">
                                                {count(counts[index] ?? 0)}/{count(required)}
                                            </span>
                                        </Badge>
                                    )}
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
                        disabled={picked < 0 || barred || onchain.pending()}
                        loading={onchain.busy(`resolve:${props.market?.id ?? ''}`)}
                        onClick={() => void resolve()}
                    >
                        {settles ? t('admin.confirmResolve') : t('admin.confirmVote')}: {pickedName}
                    </Button>
                ) : (
                    <Button
                        variant="primary"
                        block
                        icon="gavel"
                        disabled={picked < 0 || barred || onchain.pending()}
                        onClick={() => setArming('resolve')}
                    >
                        {settles ? t('admin.resolveAction') : t('admin.voteAction')}
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
