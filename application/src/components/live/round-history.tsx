import type { Position, Round } from '../../api.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';

import { formatDateTimeShort, formatMoney, formatQuote, formatQuoteDelta } from '../../i18n/format.ts';
import { explorerTxUrl } from '../../lib/chain.ts';

import Icon from '../../icons/icon.tsx';
import Card from '../ui/card.tsx';
import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';
import EmptyState from '../ui/empty-state.tsx';
import SkeletonList from '../ui/skeleton-list.tsx';

// Settled rounds, newest first: the two prices, the answer, and - when the connected wallet
// holds a winning stake in one - the button that pays it out. Claiming lives HERE as well as
// in the portfolio because a ten-minute round is won and forgotten in the time it takes to
// navigate to another page.
export default function RoundHistory(props: {
    rounds: Round[];
    positions: Position[];
    loading: boolean;
    onClaimed?: () => void;
}) {
    const { t, lang } = useLocale();
    const { calendarSystem } = usePreferences();
    const onchain = useOnchain();

    /** The connected wallet's redeemable stake in a round, if it has one. */
    const claimable = (round: Round): Position | undefined =>
        round.marketId === null
            ? undefined
            : props.positions.find((position) => position.marketId === round.marketId && position.claimable);

    const claim = async (address: string): Promise<void> => {
        if (await onchain.claim(address as `0x${string}`)) {
            props.onClaimed?.();
        }
    };

    if (props.loading && props.rounds.length === 0) {
        return <SkeletonList count={3} height="h-16" radius="card" gap="md" />;
    }

    if (props.rounds.length === 0) {
        return <EmptyState icon="clock" title={t('live.noHistory')} hint={t('live.noHistoryHint')} />;
    }

    return (
        <ul className="grid grid-cols-1 gap-3">
            {props.rounds.map((round) => {
                const move =
                    round.lockPrice === null || round.closePrice === null ? null : round.closePrice - round.lockPrice;
                const won = claimable(round);
                const voided = round.winner === null;
                // Null when the deployment has no explorer, or the round never reached a
                // settling transaction. Either way there is no link to render.
                const receipt = round.settleTx === null ? null : explorerTxUrl(round.settleTx);

                return (
                    <li key={round.epoch}>
                        <Card className="flex flex-wrap items-center gap-x-4 gap-y-3">
                            <span
                                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control ${
                                    voided
                                        ? 'bg-overlay text-muted'
                                        : round.winner === 'up'
                                          ? 'bg-yes-soft text-yes'
                                          : 'bg-no-soft text-no'
                                }`}
                                aria-hidden="true"
                            >
                                <Icon
                                    name={voided ? 'minus' : round.winner === 'up' ? 'trending-up' : 'trending-down'}
                                    size={18}
                                />
                            </span>

                            <span className="min-w-0 flex-1">
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="text-[14px] font-bold">
                                        {voided ? t('live.flat') : t(round.winner === 'up' ? 'live.up' : 'live.down')}
                                    </span>
                                    {voided && <Badge tone="muted">{t('live.refunded')}</Badge>}
                                    {won !== undefined && <Badge tone="gold">{t('live.won')}</Badge>}
                                </span>
                                <span className="nums block text-[12px] text-muted" dir="ltr">
                                    {round.lockPrice === null ? '—' : formatQuote(round.lockPrice, lang())}
                                    {' → '}
                                    {round.closePrice === null ? '—' : formatQuote(round.closePrice, lang())}
                                    {move !== null && `  (${formatQuoteDelta(move, lang())})`}
                                </span>
                            </span>

                            <span className="flex items-center gap-2">
                                <span className="text-end text-[12px] text-muted">
                                    <span className="block">
                                        {formatDateTimeShort(round.closesAt, lang(), calendarSystem())}
                                    </span>
                                    <span className="nums block">
                                        {formatMoney(round.upPool + round.downPool, lang())}
                                    </span>
                                </span>

                                {won !== undefined && round.address !== null && (
                                    <Button
                                        size="sm"
                                        variant="gold"
                                        icon="trophy"
                                        loading={onchain.busy(`claim:${round.address}`)}
                                        onClick={() => void claim(round.address as string)}
                                    >
                                        {t('chain.claim')}
                                    </Button>
                                )}

                                {receipt !== null && (
                                    <a
                                        className="flex h-9 w-9 items-center justify-center rounded-control text-muted transition-colors duration-[var(--motion-base)] hover:bg-overlay hover:text-text"
                                        href={receipt}
                                        target="_blank"
                                        rel="noreferrer"
                                        aria-label={t('chain.viewTx')}
                                    >
                                        <Icon name="external" size={15} />
                                    </a>
                                )}
                            </span>
                        </Card>
                    </li>
                );
            })}
        </ul>
    );
}
