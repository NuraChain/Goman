import { Link } from 'react-router';

import type { Market } from '../../api.ts';

import { useLocale } from '../../stores/locale.store.ts';

import Icon from '../../icons/icon.tsx';

import Rail from '../ui/rail.tsx';
import HeroCard from './hero-card.tsx';

// The featured slider: the shared Rail carrying hero cards, three per page at lg and four at
// 2xl. Everything about HOW it scrolls lives in Rail; this file only says what rides it.
export default function FeaturedRail(props: { markets: Market[] }) {
    const { t } = useLocale();

    return (
        <section className="mb-8">
            <Rail
                items={props.markets}
                itemKey={(market: Market) => market.id}
                label={t('home.featured')}
                slotClass="w-[19.5rem] shrink-0 sm:w-[22rem] lg:w-[calc((100%-2rem)/3)] 2xl:w-[calc((100%-3rem)/4)]"
                heading={
                    <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
                        <Icon name="sparkles" size={18} className="text-gold" />
                        {t('home.featured')}
                    </h2>
                }
                trailing={
                    <Link
                        to="/browse"
                        className="flex items-center gap-1 text-[13px] font-semibold text-brand no-underline hover:underline"
                    >
                        {t('home.viewAll')}
                        <Icon name="chevron-right" size={15} />
                    </Link>
                }
            >
                {(market: Market) => <HeroCard market={market} />}
            </Rail>
        </section>
    );
}
