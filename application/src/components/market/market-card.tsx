import { Link } from 'react-router';

import type { Market } from '../../api.ts';

import { hasEnded, isBinary, leadPrice } from '../../lib/market.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useCategories } from '../../stores/categories.store.ts';

import { formatOdds, formatOddsSet, formatVolume, formatDateTimeShort } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import ChanceRing from '../ui/chance-ring.tsx';
import Tooltip from '../ui/tooltip.tsx';
import { cardClass } from '../ui/variants.ts';
import FavoriteButton from './favorite-button.tsx';
import OutcomePair from './outcome-pair.tsx';
import OutcomeRow from './outcome-row.tsx';
import MarketAvatar from './market-avatar.tsx';

// The market card - the product's atom. THREE shapes, chosen by the market's own shape:
//   binary        one collapsed Yes/No leg -> chance ring + a full-width Yes/No pair
//   head-to-head  exactly two named sides  -> a row per side, then two buttons NAMED for them
//   list          three or more candidates -> a row per candidate with its own Yes/No
// Fixes the reference site's defects by contract: price on every button, resolve date and
// volume always visible, one odds convention. The meta row holds at most three items so it
// can never wrap; trending/featured are icon marks, not row-crowding badges.
export default function MarketCard(props: { market: Market }) {
    const { t, lang, text } = useLocale();
    const { oddsMode } = usePreferences();
    const categories = useCategories();

    const detailPath = `/market/${props.market.id}`;

    // Apportioned across the WHOLE outcome set, then read per row - rounding each candidate
    // on its own prints a set that does not add up to 100.
    const outcomeOdds = formatOddsSet(
        props.market.outcomes.map((entry) => entry.price),
        lang(),
        oddsMode()
    );

    const binary = isBinary(props.market);
    const duel = !binary && props.market.outcomes.length === 2;
    const ended = hasEnded(props.market);
    const rows = duel ? props.market.outcomes : props.market.outcomes.slice(0, 3);

    const rowPath = (outcomeId: string): string => `${detailPath}?outcome=${encodeURIComponent(outcomeId)}`;

    // The two sides of a head-to-head read as competitors, not as yes/no: tinting one green
    // and the other red would claim one of them is the "no" answer, which is not the market.
    const SIDE = [
        'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-control bg-brand-soft px-2 text-[14px] font-bold text-brand no-underline transition duration-200 hover-tint active:scale-[0.98]',
        'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-control bg-gold-soft px-2 text-[14px] font-bold text-gold no-underline transition duration-200 hover-tint active:scale-[0.98]'
    ];

    return (
        <article
            className={`${cardClass({ interactive: true, animate: 'rise' })} group flex h-full flex-col hover:shadow-lg`}
        >
            <div className="mb-3 flex items-start gap-3">
                <MarketAvatar image={props.market.image} emoji={props.market.emoji} size="md" />
                <Link
                    to={detailPath}
                    className="min-h-[2.75em] min-w-0 flex-1 text-[15px] font-bold leading-snug text-text no-underline transition-colors duration-200 line-clamp-2 group-hover:text-brand"
                >
                    {text(props.market.title)}
                </Link>
                <span className="flex shrink-0 items-center gap-1">
                    <FavoriteButton marketId={props.market.id} />
                    {props.market.trending && (
                        <Tooltip label={t('home.trending')}>
                            <span
                                className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-brand"
                                role="img"
                                aria-label={t('home.trending')}
                            >
                                <Icon name="flame" size={13} />
                            </span>
                        </Tooltip>
                    )}
                    {props.market.featured && (
                        <Tooltip label={t('home.featured')}>
                            <span
                                className="flex h-6 w-6 items-center justify-center rounded-full bg-gold-soft text-gold"
                                role="img"
                                aria-label={t('home.featured')}
                            >
                                <Icon name="sparkles" size={13} />
                            </span>
                        </Tooltip>
                    )}
                    {binary && (
                        <span className="relative ms-1 flex h-11 w-11 items-center justify-center">
                            <span className="absolute inset-0">
                                <ChanceRing share={leadPrice(props.market)} size={44} />
                            </span>
                            <span className="nums relative text-[11px] font-bold text-brand">
                                {formatOdds(leadPrice(props.market), lang(), oddsMode())}
                            </span>
                        </span>
                    )}
                </span>
            </div>

            {binary && <OutcomePair yesPrice={leadPrice(props.market)} to={detailPath} className="mb-3" />}

            {duel && (
                <div className="mb-3 flex flex-col gap-2">
                    {rows.map((outcome, index) => (
                        <div key={outcome.id} className="flex items-center gap-2">
                            {outcome.icon !== '' ? (
                                <span className="h-6 w-6 shrink-0 overflow-hidden rounded-full bg-overlay">
                                    <img
                                        className="h-full w-full object-cover"
                                        src={outcome.icon}
                                        alt=""
                                        loading="lazy"
                                    />
                                </span>
                            ) : (
                                <span className="h-6 w-6 shrink-0 rounded-full bg-overlay"></span>
                            )}
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                                {text(outcome.label)}
                            </span>
                            <span className="nums shrink-0 text-[13px] font-bold">{outcomeOdds[index] ?? '-'}</span>
                        </div>
                    ))}
                    <div className="flex gap-2.5">
                        {rows.map((outcome, index) => (
                            <Link
                                key={outcome.id}
                                to={`${rowPath(outcome.id)}&side=yes`}
                                className={SIDE[index] ?? SIDE[0]!}
                            >
                                <span className="truncate">{text(outcome.label)}</span>
                            </Link>
                        ))}
                    </div>
                </div>
            )}

            {!binary && !duel && (
                <div className="mb-3 flex flex-col gap-2">
                    {rows.map((outcome, index) => (
                        <OutcomeRow
                            key={outcome.id}
                            label={text(outcome.label)}
                            icon={outcome.icon}
                            odds={outcomeOdds[index] ?? ''}
                            to={rowPath(outcome.id)}
                            outcomeId={outcome.id}
                        />
                    ))}
                    {props.market.outcomes.length > 3 && (
                        <Link
                            to={detailPath}
                            className="text-[12px] font-semibold text-faint no-underline hover:text-muted"
                        >
                            {t('common.seeMore')}
                        </Link>
                    )}
                </div>
            )}

            <div className="mt-auto flex items-center justify-between gap-2 text-[12px] text-faint">
                <span className="nums flex min-w-0 items-center gap-1.5 truncate">
                    <Icon name="volume" size={13} />
                    <span>{formatVolume(props.market.volume, lang())}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{categories.label(props.market.category)}</span>
                </span>
                {/* The countdown's slot, not an extra item: on a market that has ended the date
                     is a passed one, and the meta row holds three items precisely so it never
                     wraps. The tag says the same thing the date was there to say. */}
                {ended ? (
                    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-overlay px-2 py-0.5 font-semibold text-muted">
                        <Icon name="circle-check" size={12} />
                        {t('market.ended')}
                    </span>
                ) : (
                    <span className="nums flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line px-2 py-0.5">
                        <Icon name="clock" size={12} />
                        {formatDateTimeShort(props.market.endsAt, lang())}
                    </span>
                )}
            </div>
        </article>
    );
}
