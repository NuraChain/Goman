import { Link } from 'react-router';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';

import { formatOddsSet } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

// The YES/NO pair every market surface renders: icon + label + dual price on soft fills.
// Link mode (`to`) navigates to the detail page; pick mode (`onPick`) opens the ticket.
// `buyLabel` prefixes the verb for the mobile buy bar.
export default function OutcomePair(props: {
    yesPrice: number;
    to?: string;
    onPick?: (side: 'yes' | 'no') => void;
    size?: 'base' | 'lg';
    buyLabel?: boolean;
    className?: string;
}) {
    const { t, lang } = useLocale();
    const { oddsMode } = usePreferences();

    // Rendered as a SET, not two independent roundings: 0.345 and 0.655 each round up on
    // their own and print 35 + 66 = 101, which reads as a broken market.
    const pair = formatOddsSet([props.yesPrice, 1 - props.yesPrice], lang(), oddsMode());

    const yesClass =
        props.size === 'lg'
            ? 'flex h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-control bg-yes-soft text-[15px] font-bold text-yes transition duration-200 active:scale-[0.98]'
            : 'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-control bg-yes-soft text-[14px] font-semibold text-yes no-underline transition duration-200 hover-tint active:scale-[0.98]';
    const noClass =
        props.size === 'lg'
            ? 'flex h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-control bg-no-soft text-[15px] font-bold text-no transition duration-200 active:scale-[0.98]'
            : 'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-control bg-no-soft text-[14px] font-semibold text-no no-underline transition duration-200 hover-tint active:scale-[0.98]';
    const yesLabel = props.buyLabel === true ? `${t('market.buy')} ${t('market.yes')}` : t('market.yes');
    const noLabel = props.buyLabel === true ? `${t('market.buy')} ${t('market.no')}` : t('market.no');
    const iconSize = props.size === 'lg' ? 17 : 16;

    return (
        <div className={`flex gap-2.5${props.className !== undefined ? ` ${props.className}` : ''}`}>
            {props.to !== undefined ? (
                <>
                    <Link to={props.to} className={yesClass}>
                        <Icon name="circle-check" size={iconSize} />
                        <span>{yesLabel}</span>
                        <span className="nums">{pair[0]}</span>
                    </Link>
                    <Link to={props.to} className={noClass}>
                        <Icon name="circle-x" size={iconSize} />
                        <span>{noLabel}</span>
                        <span className="nums">{pair[1]}</span>
                    </Link>
                </>
            ) : (
                <>
                    <button className={yesClass} type="button" onClick={() => props.onPick?.('yes')}>
                        <Icon name="circle-check" size={iconSize} />
                        <span>{yesLabel}</span>
                        <span className="nums">{pair[0]}</span>
                    </button>
                    <button className={noClass} type="button" onClick={() => props.onPick?.('no')}>
                        <Icon name="circle-x" size={iconSize} />
                        <span>{noLabel}</span>
                        <span className="nums">{pair[1]}</span>
                    </button>
                </>
            )}
        </div>
    );
}
