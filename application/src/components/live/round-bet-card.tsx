import { useState } from 'react';

import type { Round, RoundSide } from '../../api.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useChrome } from '../../stores/chrome.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';

import { formatCountdown, formatMoney } from '../../i18n/format.ts';
import { secondsUntil } from '../../hooks/use-now.ts';

import Icon from '../../icons/icon.tsx';
import Card from '../ui/card.tsx';
import Badge from '../ui/badge.tsx';
import Button from '../ui/button.tsx';
import Input from '../ui/input.tsx';

import { payoutLabel, SIDE_INDEX } from './side.ts';

// The round taking bets. Two symmetrical columns rather than a side toggle plus one button:
// with ten minutes on the clock, the fastest correct path from "I think it goes up" to a
// signed transaction is one press, and a toggle makes it two - with a wrong-side bet available
// to anyone who mistakes which state the toggle is in.

/** Preset stakes. Bumps beat typing when the whole decision has to fit inside a countdown. */
const BUMPS = [5, 25, 100];

export default function RoundBetCard(props: { round: Round; now: number; onBet?: () => void }) {
    const { t, lang } = useLocale();
    const session = useSession();
    const chrome = useChrome();
    const onchain = useOnchain();

    const [amount, setAmount] = useState('25');
    const [side, setSide] = useState<RoundSide | null>(null);

    const round = props.round;
    const remaining = secondsUntil(round.locksAt, props.now);
    const stake = Number(amount);
    // A number field reports an empty string, and Number('') is 0 - which passes a `> 0` test
    // written against NaN and lets an empty field reach the wallet.
    const valid = Number.isFinite(stake) && stake > 0;

    const place = async (chosen: RoundSide): Promise<void> => {
        if (!session.connected()) {
            chrome.openAuth();
            return;
        }
        if (round.address === null || !valid) {
            return;
        }
        setSide(chosen);
        const ok = await onchain.bet(round.address as `0x${string}`, SIDE_INDEX[chosen], stake);
        setSide(null);
        if (ok) {
            props.onBet?.();
        }
    };

    const busy = onchain.busy(`bet:${round.address ?? ''}`);
    const pools: Record<RoundSide, number> = { up: round.upPool, down: round.downPool };

    const column = (chosen: RoundSide): ReturnType<typeof Card> => {
        const isUp = chosen === 'up';
        const tint = isUp ? 'bg-yes-soft text-yes' : 'bg-no-soft text-no';

        return (
            <div className="flex flex-col gap-2">
                <div className={`flex flex-col gap-1 rounded-card p-3 ${tint}`}>
                    <span className="flex items-center gap-1.5 text-[14px] font-bold">
                        <Icon name={isUp ? 'trending-up' : 'trending-down'} size={16} />
                        {t(isUp ? 'live.up' : 'live.down')}
                    </span>
                    <span className="nums text-[13px] font-semibold opacity-80">
                        {payoutLabel(round, chosen, lang())}
                    </span>
                    <span className="text-[12px] opacity-70">
                        {t('live.pool')} <span className="nums">{formatMoney(pools[chosen], lang())}</span>
                    </span>
                </div>
                <Button
                    variant={isUp ? 'yes' : 'no'}
                    size="lg"
                    block
                    icon={isUp ? 'trending-up' : 'trending-down'}
                    loading={busy && side === chosen}
                    disabled={(busy && side !== chosen) || remaining === 0 || (session.connected() && !valid)}
                    onClick={() => void place(chosen)}
                >
                    {session.connected() ? t(isUp ? 'live.betUp' : 'live.betDown') : t('nav.connect')}
                </Button>
            </div>
        );
    };

    return (
        <Card className="flex flex-col gap-4" animate="rise">
            <div className="flex items-center justify-between gap-3">
                <Badge tone="brand" icon="zap">
                    {t('live.taking')}
                </Badge>
                <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
                    {t('live.locksIn')}
                    <span className="nums text-[15px] font-bold text-text" dir="ltr">
                        {formatCountdown(remaining, lang())}
                    </span>
                </span>
            </div>

            <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                    <Input label={t('live.amount')} type="number" value={amount} dir="ltr" onInput={setAmount} />
                </div>
                <div className="flex gap-1.5">
                    {BUMPS.map((bump) => (
                        <button
                            key={bump}
                            type="button"
                            className="nums h-11 w-11 cursor-pointer rounded-control bg-overlay text-[13px] font-semibold text-muted transition duration-[var(--motion-base)] hover:text-text active:scale-95"
                            onClick={() => setAmount(String(bump))}
                        >
                            {bump}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {column('up')}
                {column('down')}
            </div>
        </Card>
    );
}
