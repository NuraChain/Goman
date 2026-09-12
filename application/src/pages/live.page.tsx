import { useState } from 'react';

import { client, ApiError } from '../api.ts';

import { useLocale } from '../stores/locale.store.ts';
import { useSession } from '../stores/session.store.ts';
import { useOnchain } from '../stores/onchain.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { useResource } from '../hooks/use-resource.ts';
import { useNow } from '../hooks/use-now.ts';

import Icon from '../icons/icon.tsx';
import Card from '../components/ui/card.tsx';
import Skeleton from '../components/ui/skeleton.tsx';

import PriceBanner from '../components/live/price-banner.tsx';
import RoundBetCard from '../components/live/round-bet-card.tsx';
import LockedRoundCard from '../components/live/locked-round-card.tsx';
import RoundHistory from '../components/live/round-history.tsx';

// The rounds surface. Everything here moves on a clock rather than on a click, so the page
// keeps two independent heartbeats: `now` re-renders the countdowns every second, and a
// coarser tick in the resource key re-reads the schedule from the server every few seconds.
// Deriving the poll from the same clock is what keeps them in step - two intervals would
// drift, and the countdown would visibly jump each time the slower one landed.

/** Seconds between reads of the schedule. Fast enough that a new round appears promptly. */
const POLL_SECONDS = 3;

/** Finished rounds shown under the live ones. */
const HISTORY = 10;

export default function Live() {
    const { t } = useLocale();
    const session = useSession();
    const onchain = useOnchain();
    const toasts = useToasts();

    const [submitting, setSubmitting] = useState(false);

    const now = useNow();
    const beat = Math.floor(now / (POLL_SECONDS * 1000));

    // `onchain.writes()` is in the key on purpose: a bet that lands has to show up in the pool
    // it joined without waiting for the next tick, and the store only bumps it once the
    // indexer has actually caught up with the transaction.
    const rounds = useResource(
        () => `rounds|${beat}|${onchain.writes()}`,
        () => client.rounds.get({ query: { history: HISTORY } })
    );

    // Gated on a wallet: signed out there is nothing to claim, and the endpoint would be asked
    // for the positions of an empty address on every poll.
    const positions = useResource(
        () => (session.connected() ? `${session.address()}|${onchain.writes()}` : false),
        (key: string) => client.portfolio.positions({ query: { address: key.split('|')[0] ?? '' } })
    );

    /**
     * Push a finished round through. No wallet is involved - the server signs - so the only
     * thing that can come back is "not yet", which is worth saying out loud: the button is
     * offered the second the countdown hits zero, and the closing price can land a beat later.
     */
    const submit = async (epoch: number): Promise<void> => {
        setSubmitting(true);
        try {
            await client.rounds.submit({ params: { epoch } });
            toasts.push('success', t('live.submitDone'), 'circle-check');
        } catch (error) {
            toasts.push('error', error instanceof ApiError ? t('live.submitFailed') : t('common.error'), 'alert');
        } finally {
            setSubmitting(false);
            rounds.refetch();
        }
    };

    const snapshot = rounds.data();
    const firstLoad = rounds.loading() && snapshot === undefined;
    // A deployment with ROUNDS_ENABLED=off serves no /api/rounds at all, so the request 404s.
    // That is the same situation as a paused engine from the reader's side, and saying so beats
    // a page of empty regions with no explanation.
    const idle = (snapshot !== undefined && !snapshot.running) || rounds.error() !== null;
    const live = snapshot?.live ?? null;
    const locked = snapshot?.locked ?? null;

    return (
        <div className="shell py-6">
            <h1 className="text-2xl font-bold tracking-tight motion-safe:animate-rise">{t('live.title')}</h1>
            <p className="mt-1 mb-5 text-[14px] text-muted motion-safe:animate-rise">{t('live.subtitle')}</p>

            <div className="flex flex-col gap-5">
                {firstLoad ? (
                    <Skeleton className="h-24 rounded-card" />
                ) : (
                    <PriceBanner price={snapshot?.price ?? null} now={now} />
                )}

                {idle && (
                    <Card className="flex items-center gap-3">
                        <span
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-overlay text-muted"
                            aria-hidden="true"
                        >
                            <Icon name="clock" size={18} />
                        </span>
                        <span className="min-w-0">
                            <span className="block text-[14px] font-bold">{t('live.idle')}</span>
                            <span className="block text-[13px] text-muted">{t('live.idleHint')}</span>
                        </span>
                    </Card>
                )}

                {firstLoad && (
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <Skeleton className="h-72 rounded-card" />
                        <Skeleton className="h-72 rounded-card" />
                    </div>
                )}

                {(live !== null || locked !== null) && (
                    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
                        {live !== null && <RoundBetCard round={live} now={now} onBet={() => rounds.refetch()} />}
                        {locked !== null && (
                            <LockedRoundCard
                                round={locked}
                                price={snapshot?.price ?? null}
                                now={now}
                                submitting={submitting}
                                onSubmit={() => void submit(locked.epoch)}
                            />
                        )}
                    </div>
                )}

                {snapshot?.running === true && live === null && locked === null && (
                    <Card className="flex items-center gap-3">
                        <span
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand"
                            aria-hidden="true"
                        >
                            <Icon name="zap" size={18} />
                        </span>
                        <span className="text-[14px] font-bold">{t('live.opening')}</span>
                    </Card>
                )}

                <section className="flex flex-col gap-3">
                    <h2 className="text-lg font-bold tracking-tight">{t('live.history')}</h2>
                    <RoundHistory
                        rounds={snapshot?.history ?? []}
                        positions={positions.data() ?? []}
                        loading={firstLoad}
                        onClaimed={() => positions.refetch()}
                    />
                </section>
            </div>
        </div>
    );
}
