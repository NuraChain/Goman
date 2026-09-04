import { Link } from 'react-router';

import { useLocale } from '../../stores/locale.store.ts';

// One candidate on a multi-outcome card: art, name, its odds, and its OWN Yes/No pair. The
// card used to render a name and a percent with no action at all, so picking a candidate
// meant opening the market and finding it again. Each button carries the outcome and the
// side in the link, so the ticket opens on exactly what was clicked.
export default function OutcomeRow(props: {
    label: string;
    icon: string;
    odds: string;
    to: string;
    outcomeId: string;
}) {
    const { t } = useLocale();

    const tradeable = props.odds !== '';

    return (
        <div className="flex items-center gap-2">
            {props.icon !== '' && (
                <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-overlay">
                    <img className="h-full w-full object-cover" src={props.icon} alt="" loading="lazy" />
                </span>
            )}
            <Link
                to={props.to}
                className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text no-underline hover:text-brand"
            >
                {props.label}
            </Link>
            <span className="nums shrink-0 text-[13px] font-bold">{tradeable ? props.odds : '-'}</span>
            <span className="flex shrink-0 gap-1">
                <Link
                    to={`${props.to}&side=yes`}
                    className="flex h-7 min-w-[2.75rem] items-center justify-center rounded-control bg-yes-soft px-2 text-[12px] font-bold text-yes no-underline transition duration-200 hover-tint active:scale-[0.97]"
                    aria-label={`${t('market.yes')} - ${props.label}`}
                >
                    {t('market.yes')}
                </Link>
                <Link
                    to={`${props.to}&side=no`}
                    className="flex h-7 min-w-[2.75rem] items-center justify-center rounded-control bg-no-soft px-2 text-[12px] font-bold text-no no-underline transition duration-200 hover-tint active:scale-[0.97]"
                    aria-label={`${t('market.no')} - ${props.label}`}
                >
                    {t('market.no')}
                </Link>
            </span>
        </div>
    );
}
