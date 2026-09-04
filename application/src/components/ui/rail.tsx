import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useLocale } from '../../stores/locale.store.ts';

import Icon from '../../icons/icon.tsx';

import Tooltip from './tooltip.tsx';

// THE horizontal rail. Mobile/tablet: a swipe rail bleeding to the screen edge with the next
// item peeking. Desktop: a contained, page-wise slider - arrows beside the heading, optional
// dot indicators. The scroll math is direction-aware (RTL scrollLeft runs negative) and honors
// prefers-reduced-motion.
//
// One owner on purpose: the dot mapping, the RTL sign, and the rounding slop below are each a
// bug that was found and fixed once. A second rail that restated them would be a second place
// for them to be wrong, and the two would drift silently because they look identical.
//
// An EMPTY rail renders nothing at all - heading included. A section title with arrows over
// no content reads as a loading failure, and the caller should not have to guard every use.
//
// Two arrow placements, because a rail with a section heading and a bare chip strip want
// different things: 'heading' (default) puts them in the heading row beside `heading`/
// `trailing`; 'edge' floats them over the rail's own left/right edges, for a rail that has no
// heading to hang them from. Both appear only from lg - below that the rail bleeds to the
// screen edge and is swipe-only, which is the design law FeaturedRail established.
//
// `itemKey`, not `key`: React reserves `key` on every element, so a prop by that name would be
// swallowed by the runtime and never reach this component.
export default function Rail<T>(props: {
    items: T[];
    itemKey: (item: T) => string | number;
    children: (item: T) => ReactNode;
    label: string;
    slotClass: string;
    dots?: boolean;
    arrows?: 'heading' | 'edge';
    heading?: ReactNode;
    trailing?: ReactNode;
    railClass?: string;
}) {
    const { t, dir } = useLocale();

    const [page, setPage] = useState(0);
    const [pages, setPages] = useState(1);
    const [atStart, setAtStart] = useState(true);
    const [atEnd, setAtEnd] = useState(true);

    const rail = useRef<HTMLDivElement>(null);

    const measure = useCallback((): void => {
        const element = rail.current;
        if (element === null) {
            return;
        }
        const width = element.clientWidth;
        const total = element.scrollWidth;
        const position = Math.abs(element.scrollLeft);
        const nextPages = width > 0 ? Math.max(1, Math.ceil((total - 4) / width)) : 1;
        setPages(nextPages);
        // The active dot maps scroll PROGRESS onto the dot range - never `position / width`:
        // the last page is usually a fraction of a viewport (5 cards, 4 per view leaves 0.27),
        // and viewport rounding pins the first dot active forever on wide screens.
        const maxScroll = Math.max(1, total - width);
        setPage(nextPages > 1 ? Math.min(nextPages - 1, Math.round((position / maxScroll) * (nextPages - 1))) : 0);
        setAtStart(position <= 1);
        setAtEnd(position >= total - width - 1);
    }, []);

    const behavior = (): ScrollBehavior =>
        typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

    /** +1 pages toward the reading end; RTL scroll offsets run negative. */
    const forward = (): number => (dir() === 'rtl' ? -1 : 1);

    const go = (delta: number): void => {
        const element = rail.current;
        element?.scrollBy({ left: forward() * delta * element.clientWidth, behavior: behavior() });
    };

    const jump = (target: number): void => {
        const element = rail.current;
        if (element === null) {
            return;
        }
        // The inverse of measure()'s mapping, so landing on dot N always measures back to N.
        const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
        element.scrollTo({
            left: forward() * (pages > 1 ? (target * maxScroll) / (pages - 1) : 0),
            behavior: behavior()
        });
    };

    useEffect(() => {
        const frame = requestAnimationFrame(measure);
        window.addEventListener('resize', measure);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', measure);
        };
    }, [props.items, measure]);

    const arrowClass =
        'flex h-8 w-8 cursor-pointer items-center justify-center rounded-control border border-line text-muted transition-colors duration-200 hover:bg-overlay hover:text-text disabled:pointer-events-none disabled:opacity-40';

    if (props.items.length === 0) {
        return null;
    }

    return (
        <div className={props.arrows === 'edge' ? 'relative' : ''}>
            {props.arrows !== 'edge' && (
                <div className="mb-3 flex items-center justify-between gap-2">
                    {props.heading}
                    <div className="flex items-center gap-2">
                        {props.trailing}
                        <div className="hidden items-center gap-1 lg:flex">
                            <Tooltip label={t('common.previous')}>
                                <button
                                    className={arrowClass}
                                    type="button"
                                    aria-label={`${props.label}: ${t('common.previous')}`}
                                    disabled={atStart}
                                    onClick={() => go(-1)}
                                >
                                    <Icon name="chevron-left" size={16} />
                                </button>
                            </Tooltip>
                            <Tooltip label={t('common.next')}>
                                <button
                                    className={arrowClass}
                                    type="button"
                                    aria-label={`${props.label}: ${t('common.next')}`}
                                    disabled={atEnd}
                                    onClick={() => go(1)}
                                >
                                    <Icon name="chevron-right" size={16} />
                                </button>
                            </Tooltip>
                        </div>
                    </div>
                </div>
            )}

            <div
                ref={rail}
                className={`rail rail-bleed rail-fade gap-4 pb-1 lg:[scroll-snap-type:x_mandatory] ${props.railClass ?? ''}`}
                onScroll={() => measure()}
            >
                {props.items.map((item) => (
                    <div key={props.itemKey(item)} className={props.slotClass}>
                        {props.children(item)}
                    </div>
                ))}
            </div>

            {props.arrows === 'edge' && (
                <div>
                    <div className={atStart ? 'hidden' : 'absolute inset-y-0 start-0 hidden items-center lg:flex'}>
                        <button
                            className={`${arrowClass} bg-surface shadow-md`}
                            type="button"
                            aria-label={`${props.label}: ${t('common.previous')}`}
                            onClick={() => go(-1)}
                        >
                            <Icon name="chevron-left" size={16} />
                        </button>
                    </div>
                    <div className={atEnd ? 'hidden' : 'absolute inset-y-0 end-0 hidden items-center lg:flex'}>
                        <button
                            className={`${arrowClass} bg-surface shadow-md`}
                            type="button"
                            aria-label={`${props.label}: ${t('common.next')}`}
                            onClick={() => go(1)}
                        >
                            <Icon name="chevron-right" size={16} />
                        </button>
                    </div>
                </div>
            )}

            {props.dots !== false && pages > 1 && (
                <div className="mt-3 hidden justify-center gap-1.5 lg:flex">
                    {Array.from({ length: pages }, (_item, position) => (
                        <button
                            key={position}
                            className={
                                page === position
                                    ? 'h-1.5 w-5 rounded-full bg-brand transition-all duration-200'
                                    : 'h-1.5 w-1.5 cursor-pointer rounded-full bg-text/25 transition-all duration-200 hover:bg-text/45'
                            }
                            type="button"
                            aria-label={`${props.label} ${position + 1}`}
                            aria-current={page === position}
                            onClick={() => jump(position)}
                        ></button>
                    ))}
                </div>
            )}
        </div>
    );
}
