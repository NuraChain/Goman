import { useState } from 'react';

import type { Market, Outcome, Side } from '../../api.ts';

import { parseEther, formatEther } from 'viem';

import { chain } from '../../lib/chain.ts';
import { quoteBuy } from '../../lib/contracts.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useSession } from '../../stores/session.store.ts';
import { useOnchain } from '../../stores/onchain.store.ts';
import { useResource } from '../../hooks/use-resource.ts';

import { formatMoney, formatOddsSet, formatFillPrice, formatShares, formatCount } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Button from '../ui/button.tsx';
import MarketAvatar from './market-avatar.tsx';

// The trade ticket - one component, two homes: the desktop right-column panel and the
// mobile bottom sheet render exactly this. Signed out, the CTA becomes connect-wallet
// (via onConnect so the host can close its own sheet first - one surface, ever).
// Every market IS on-chain now: the address and outcome indices arrive on the wire, and
// Buy signs a real transaction through the connected wallet.
export default function TradeTicket(props: {
    market: Market;
    outcome: Outcome;
    side: Side;
    onSideChange: (side: Side) => void;
    onConnect?: () => void;
    onTraded?: () => void;
}) {
    const { t, lang, text } = useLocale();
    const { oddsMode } = usePreferences();
    const session = useSession();
    const onchain = useOnchain();

    const [amount, setAmount] = useState(25);

    // Only a binary market HAS a NO token; a multi-outcome candidate can only be bought FOR,
    // so the side toggle disappears and the side is pinned to yes.
    const sideOdds = formatOddsSet([props.outcome.price, 1 - props.outcome.price], lang(), oddsMode());

    const binary = props.market.noIndex !== null;
    const activeSide = binary ? props.side : 'yes';

    const outcomeIndex =
        activeSide === 'no' && props.market.noIndex !== null ? props.market.noIndex : props.outcome.index;

    // The MARGINAL probability - what the next infinitesimal share costs. It is the honest
    // basis for an instant estimate and nothing more: it ignores both the trading fee and the
    // price impact of the order itself.
    const price = activeSide === 'yes' ? props.outcome.price : 1 - props.outcome.price;
    const estimate = price > 0 ? amount / price : 0;

    const isPool = props.market.kind === 'pool';

    // ...so the number the trader actually sees comes from the MARKET'S OWN MATH. `calcBuy` is
    // the same function the transaction executes, so the quote and the fill cannot disagree.
    // Pool markets have no `calcBuy`/`buy` - they use `bet`/`impliedOdds` and split the pot.
    const quote = useResource(
        () =>
            !isPool && amount > 0 && Number.isFinite(amount)
                ? `${props.market.address}|${outcomeIndex}|${amount}`
                : false,
        (key: string) => {
            const [, index = '0', value = '0'] = key.split('|');
            return quoteBuy(props.market.address as `0x${string}`, Number(index), parseEther(value));
        }
    );

    const quoted = quote.data();
    const shares = isPool ? estimate : quoted === undefined ? estimate : Number(formatEther(quoted));

    // Winning shares redeem 1:1 (AMM) or pro-rata of the pool (Pool); estimate via amount/price keeps UI honest for both.
    const payout = shares;

    // What the AMM's marginal price would have promised, minus what it will actually mint - pool has no slippage quote.
    const cost = isPool || quoted === undefined ? 0 : Math.max(0, estimate - shares);
    const effective = shares > 0 ? amount / shares : price;

    // A number input reports NaN when emptied, and NaN fails every comparison - so the
    // old `amount <= 0` guard let an empty field straight through to the wallet.
    const tradeable = Number.isFinite(amount) && amount > 0 && !onchain.pending();

    const submit = async (): Promise<void> => {
        const ok = isPool
            ? await onchain.bet(props.market.address as `0x${string}`, outcomeIndex, amount)
            : await onchain.buy(props.market.address as `0x${string}`, outcomeIndex, amount);
        if (ok) {
            props.onTraded?.();
        }
    };

    const bump =
        'h-9 flex-1 cursor-pointer rounded-control bg-overlay text-[13px] font-semibold text-muted transition duration-200 hover:text-text active:scale-95';

    return (
        <div className="flex flex-col gap-4">
            {props.market.outcomes.length > 1 && (
                <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                    <MarketAvatar image={props.market.image} emoji={props.market.emoji} size="sm" />
                    {text(props.outcome.label)}
                </p>
            )}

            {binary && (
                <div
                    className="grid grid-cols-2 gap-2 rounded-control bg-overlay p-1"
                    role="radiogroup"
                    aria-label={t('market.outcomes')}
                >
                    <button
                        className={
                            activeSide === 'yes'
                                ? 'flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] bg-yes-soft text-[14px] font-bold text-yes'
                                : 'flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] text-[14px] font-semibold text-muted transition-colors duration-200 hover:text-text'
                        }
                        type="button"
                        role="radio"
                        aria-checked={activeSide === 'yes'}
                        onClick={() => props.onSideChange('yes')}
                    >
                        <Icon name="circle-check" size={16} />
                        <span>{t('market.yes')}</span>
                        <span className="nums">{sideOdds[0]}</span>
                    </button>
                    <button
                        className={
                            activeSide === 'no'
                                ? 'flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] bg-no-soft text-[14px] font-bold text-no'
                                : 'flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] text-[14px] font-semibold text-muted transition-colors duration-200 hover:text-text'
                        }
                        type="button"
                        role="radio"
                        aria-checked={activeSide === 'no'}
                        onClick={() => props.onSideChange('no')}
                    >
                        <Icon name="circle-x" size={16} />
                        <span>{t('market.no')}</span>
                        <span className="nums">{sideOdds[1]}</span>
                    </button>
                </div>
            )}

            <div>
                {/* The currency prefix sits IN the flex row rather than floating over a padded input:
                    a fixed inline-start padding has to guess the symbol's width, and NURA already
                    overran the guess and ran into the digits. The wrapping label keeps the whole box
                    a click target, prefix included - and the association is by nesting, not by id: on
                    mobile the hidden desktop panel and the sheet mount this ticket at the same time, and
                    a `for` pointing at a shared id lands on the wrong one. */}
                <label className="block cursor-text">
                    <span className="mb-1.5 block text-[13px] font-semibold text-muted">{t('market.amount')}</span>
                    <span className="flex h-12 items-center gap-2 rounded-control border border-line bg-raised px-3.5 transition-colors duration-200 focus-within:border-brand">
                        <span className="shrink-0 text-[13px] font-semibold text-muted" aria-hidden="true">
                            {chain.nativeCurrency.symbol}
                        </span>
                        <input
                            className="nums h-full min-w-0 flex-1 bg-transparent text-lg font-bold text-text focus:outline-none"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            value={Number.isFinite(amount) ? amount : ''}
                            onChange={(event) => setAmount(event.target.valueAsNumber)}
                        />
                    </span>
                </label>
                <div className="mt-2 flex gap-2">
                    {[10, 50, 100, 500].map((step) => (
                        // A leading plus is bidi-neutral, so in an RTL row it drifts to the wrong
                        // side of the digits ('10+'); pinning the button LTR keeps the sign in front.
                        <button
                            key={step}
                            className={bump}
                            type="button"
                            dir="ltr"
                            onClick={() => setAmount((current) => (Number.isFinite(current) ? current : 0) + step)}
                        >
                            +{formatCount(step, lang())}
                        </button>
                    ))}
                </div>
            </div>

            <dl className="flex flex-col gap-2 border-t border-line pt-3 text-[14px]">
                <div className="flex justify-between">
                    <dt className="text-muted">{t('market.pricePerShare')}</dt>
                    <dd className="nums font-semibold">{formatFillPrice(effective, lang())}</dd>
                </div>
                <div className="flex justify-between">
                    <dt className="text-muted">{t('market.shares')}</dt>
                    <dd className="nums font-semibold">{formatShares(shares, lang())}</dd>
                </div>
                {cost > 0 && (
                    <div className="flex justify-between text-[13px]">
                        <dt className="text-faint">{t('market.feeImpact')}</dt>
                        <dd className="nums text-faint">-{formatShares(cost, lang())}</dd>
                    </div>
                )}
                <div className="flex justify-between text-[16px]">
                    <dt className="font-semibold">{t('market.payoutIfRight')}</dt>
                    <dd className="nums font-bold text-brand">{formatMoney(payout, lang())}</dd>
                </div>
            </dl>

            {session.connected() ? (
                <Button
                    variant={activeSide === 'yes' ? 'primary' : 'danger'}
                    size="lg"
                    block
                    disabled={!tradeable}
                    loading={
                        isPool
                            ? onchain.busy(`bet:${props.market.address}`)
                            : onchain.busy(`buy:${props.market.address}`)
                    }
                    onClick={() => void submit()}
                >
                    {isPool ? t('market.bet') : t('market.buy')}
                </Button>
            ) : (
                <Button variant="primary" size="lg" block icon="wallet" onClick={() => props.onConnect?.()}>
                    {t('auth.title')}
                </Button>
            )}
            <p className="flex items-center gap-1.5 text-[12px] text-faint">
                <Icon name="verified" size={13} />
                <span>{t('chain.onchainMarket')}</span>
            </p>
        </div>
    );
}
