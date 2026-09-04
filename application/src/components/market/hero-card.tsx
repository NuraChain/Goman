import { Link } from 'react-router';

import { client, type Market } from '../../api.ts';

import { isBinary } from '../../lib/market.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useResource } from '../../hooks/use-resource.ts';

import { formatOdds, formatVolume, formatDateTimeShort } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Chart from '../ui/chart.tsx';
import Badge from '../ui/badge.tsx';
import Skeleton from '../ui/skeleton.tsx';
import { cardClass } from '../ui/variants.ts';
import FavoriteButton from './favorite-button.tsx';
import OutcomePair from './outcome-pair.tsx';
import MarketAvatar from './market-avatar.tsx';

// The featured rail's wide card: headline chance, a live week chart, and the outcome
// buttons - the storefront window. Series load lazily per card, anchored to the shown
// price. The card is width-agnostic: the rail that mounts it owns the sizing.
export default function HeroCard(props: { market: Market }) {
    const { t, lang, text } = useLocale();
    const { oddsMode } = usePreferences();

    const lead = props.market.outcomes.reduce(
        (best, candidate) => (candidate.price > best.price ? candidate : best),
        props.market.outcomes[0]!
    );
    const detailPath = `/market/${props.market.id}`;

    const series = useResource(
        () => `${props.market.id}|${lead.id}`,
        () =>
            client.markets.series({
                params: { id: props.market.id },
                query: { outcome: lead.id, range: '1w' }
            })
    );

    return (
        <article className={`${cardClass({ interactive: true })} flex h-full flex-col`}>
            <div className="mb-2 flex items-start gap-3">
                <MarketAvatar image={props.market.image} emoji={props.market.emoji} size="md" />
                <Link
                    to={detailPath}
                    className="min-h-[2.75em] min-w-0 flex-1 text-[15px] font-bold leading-snug text-text no-underline line-clamp-2 hover:text-brand"
                >
                    {text(props.market.title)}
                </Link>
                <FavoriteButton marketId={props.market.id} />
            </div>

            <div className="mb-1 flex items-end justify-between">
                <div>
                    <p className="nums text-2xl font-bold text-brand">{formatOdds(lead.price, lang(), oddsMode())}</p>
                    <p className="text-[12px] text-muted">
                        {isBinary(props.market) ? t('market.chance') : text(lead.label)}
                    </p>
                </div>
                <Badge tone="gold" icon="sparkles">
                    {t('home.featured')}
                </Badge>
            </div>

            <div className="mb-3 h-14">
                {series.loading() ? (
                    <Skeleton className="h-full rounded-control" />
                ) : (
                    <Chart points={series.data()?.points ?? []} className="h-full" />
                )}
            </div>

            <OutcomePair yesPrice={lead.price} to={detailPath} className="mb-3" />

            <div className="mt-auto flex items-center justify-between gap-3 text-[12px] text-faint">
                <span className="nums flex items-center gap-1">
                    <Icon name="volume" size={13} />
                    {formatVolume(props.market.volume, lang())}
                </span>
                <span className="nums flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line px-2 py-0.5">
                    <Icon name="clock" size={12} />
                    {formatDateTimeShort(props.market.endsAt, lang())}
                </span>
            </div>
        </article>
    );
}
