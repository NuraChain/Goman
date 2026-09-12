import type { TwapPrice } from '../../api.ts';

import { useLocale } from '../../stores/locale.store.ts';
import { formatQuote, formatTimeAgo } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';
import Card from '../ui/card.tsx';
import Badge from '../ui/badge.tsx';
import Skeleton from '../ui/skeleton.tsx';

// The number every round on this page is settled against. It leads the page because it is the
// one thing a reader checks before betting, and because a round card showing a countdown with
// no price behind it would look live while being unable to answer anything.
export default function PriceBanner(props: { price: TwapPrice | null; now: number }) {
    const { t, lang } = useLocale();
    const price = props.price;

    return (
        <Card className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3" animate="rise">
            <div className="min-w-0">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-muted">
                    <span dir="ltr">{t('live.pair')}</span>
                    {price !== null && (
                        <span
                            className="h-1.5 w-1.5 rounded-full bg-brand motion-safe:animate-pulse"
                            aria-hidden="true"
                        />
                    )}
                </p>
                {price === null ? (
                    <Skeleton className="mt-1 h-9 w-44" />
                ) : (
                    // A price is a Latin numeric run: it reads left to right in Persian and
                    // Arabic too, however the surrounding page is laid out.
                    <p className="nums mt-0.5 text-3xl font-bold tracking-tight" dir="ltr">
                        {formatQuote(price.value, lang())}
                    </p>
                )}
            </div>

            <div className="flex flex-col items-start gap-1.5">
                <Badge tone="brand">{t('live.source')}</Badge>
                <span className="flex items-center gap-1.5 text-[12px] text-faint">
                    <Icon name="clock" size={12} />
                    {price === null ? t('live.waiting') : formatTimeAgo(price.at, lang(), props.now)}
                </span>
            </div>
        </Card>
    );
}
