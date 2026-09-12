import type { Round, TwapPrice } from '../../api.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { formatCountdown, formatMoney, formatQuote, formatQuoteDelta } from '../../i18n/format.ts';
import { secondsUntil } from '../../hooks/use-now.ts';

import Icon from '../../icons/icon.tsx';
import Card from '../ui/card.tsx';
import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';

// The round whose measured window is running: bets are shut, the reference price is written
// down, and the only thing left to happen is the clock. It is on the page because it is the
// half of the game a bettor actually watches - a page that showed only the round taking bets
// would hide the outcome of the bet they just placed.
export default function LockedRoundCard(props: {
    round: Round;
    price: TwapPrice | null;
    now: number;
    submitting?: boolean;
    onSubmit?: () => void;
}) {
    const { t, lang } = useLocale();
    const round = props.round;

    // The measured window is over and the round is still unanswered. The engine settles these
    // on its own clock; the button is there so a reader who is already looking at a finished
    // round does not have to sit through the gap - and so a round survives an engine that
    // stalled, without an admin.
    const remaining = secondsUntil(round.closesAt, props.now);
    const ready = remaining === 0 && props.onSubmit !== undefined;

    const lock = round.lockPrice;
    const current = props.price?.value ?? null;
    const move = lock === null || current === null ? null : current - lock;

    // Direction drives the colour AND the icon: the YES/NO scale never carries meaning alone,
    // and a reader who cannot separate emerald from rose still has the arrow.
    const rising = move !== null && move > 0;
    const falling = move !== null && move < 0;
    const tone = rising ? 'text-yes' : falling ? 'text-no' : 'text-muted';

    return (
        <Card className="flex flex-col gap-4" animate="rise">
            <div className="flex items-center justify-between gap-3">
                <Badge tone="gold" icon="clock">
                    {t('live.measuring')}
                </Badge>
                {ready ? (
                    <Button
                        variant="primary"
                        size="sm"
                        icon="check"
                        loading={props.submitting === true}
                        onClick={() => props.onSubmit?.()}
                    >
                        {t('live.submit')}
                    </Button>
                ) : (
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
                        {t('live.settlesIn')}
                        <span className="nums text-[15px] font-bold text-text" dir="ltr">
                            {formatCountdown(remaining, lang())}
                        </span>
                    </span>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3">
                <div className="rounded-card bg-overlay p-3">
                    <p className="text-[12px] text-muted">{t('live.lockedAt')}</p>
                    <p className="nums mt-0.5 text-[15px] font-bold sm:text-lg" dir="ltr">
                        {lock === null ? '—' : formatQuote(lock, lang())}
                    </p>
                </div>
                <div className="rounded-card bg-overlay p-3">
                    <p className="text-[12px] text-muted">{t('live.current')}</p>
                    <p className="nums mt-0.5 text-[15px] font-bold sm:text-lg" dir="ltr">
                        {current === null ? '—' : formatQuote(current, lang())}
                    </p>
                </div>
            </div>

            {ready && <p className="-mt-1 text-[12px] text-muted">{t('live.submitHint')}</p>}

            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <span className={`flex items-center gap-1.5 text-[15px] font-bold ${tone}`}>
                    <Icon name={falling ? 'trending-down' : 'trending-up'} size={16} />
                    <span className="text-[12px] font-semibold text-muted">{t('live.move')}</span>
                    <span className="nums" dir="ltr">
                        {move === null ? '—' : formatQuoteDelta(move, lang())}
                    </span>
                </span>
                <span className="flex items-center gap-3 text-[12px] text-muted">
                    <span className="flex items-center gap-1">
                        <Icon name="trending-up" size={12} />
                        <span className="nums">{formatMoney(round.upPool, lang())}</span>
                    </span>
                    <span className="flex items-center gap-1">
                        <Icon name="trending-down" size={12} />
                        <span className="nums">{formatMoney(round.downPool, lang())}</span>
                    </span>
                </span>
            </div>
        </Card>
    );
}
