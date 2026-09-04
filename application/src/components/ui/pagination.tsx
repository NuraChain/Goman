import { useLocale } from '../../stores/locale.store.ts';

import { faDigits } from '../../i18n/format.ts';

import Icon from '../../icons/icon.tsx';

import Tooltip from './tooltip.tsx';

// Pagination: first/prev/next/last jumps (chevrons mirrored under RTL by the icon
// pipeline), 44px targets, aria-current on the active page. Desktop shows the windowed
// number row with ellipses; mobile swaps it for a compact "page / pages" status so the
// four jump targets stay comfortably tappable at 390px.
export default function Pagination(props: { page: number; pages: number; onChange: (page: number) => void }) {
    const { t, lang } = useLocale();

    const window_: Array<{ position: number; value: number | 'gap' }> = (() => {
        let items: Array<number | 'gap'>;
        if (props.pages <= 7) {
            items = Array.from({ length: props.pages }, (_item, index) => index + 1);
        } else {
            const current = props.page;
            const middle = [current - 1, current, current + 1].filter((page) => page > 1 && page < props.pages);
            items = [1];
            if ((middle[0] ?? props.pages) > 2) {
                items.push('gap');
            }
            items.push(...middle);
            if ((middle[middle.length - 1] ?? 0) < props.pages - 1) {
                items.push('gap');
            }
            items.push(props.pages);
        }
        return items.map((value, position) => ({ position, value }));
    })();

    const status =
        lang() === 'fa'
            ? `${faDigits(String(props.page))} ${t('common.pageOf')} ${faDigits(String(props.pages))}`
            : `${props.page} ${t('common.pageOf')} ${props.pages}`;

    const jumpClass =
        'flex h-11 w-11 cursor-pointer items-center justify-center rounded-control text-muted transition-colors duration-200 hover:bg-overlay hover:text-text disabled:pointer-events-none disabled:opacity-40';

    if (props.pages <= 1) {
        return null;
    }

    return (
        <nav className="flex items-center justify-center gap-0.5 sm:gap-1" aria-label={t('browse.title')}>
            <Tooltip label={t('common.firstPage')}>
                <button
                    className={jumpClass}
                    type="button"
                    aria-label={t('common.firstPage')}
                    disabled={props.page <= 1}
                    onClick={() => props.onChange(1)}
                >
                    <Icon name="chevrons-left" size={17} />
                </button>
            </Tooltip>
            <Tooltip label={t('common.previous')}>
                <button
                    className={jumpClass}
                    type="button"
                    aria-label={t('common.previous')}
                    disabled={props.page <= 1}
                    onClick={() => props.onChange(props.page - 1)}
                >
                    <Icon name="chevron-left" size={17} />
                </button>
            </Tooltip>

            <span
                className="nums min-w-16 px-1 text-center text-[13px] font-semibold text-muted sm:hidden"
                aria-current="page"
            >
                {status}
            </span>
            <span className="hidden items-center gap-1 sm:flex">
                {window_.map((entry) =>
                    entry.value === 'gap' ? (
                        <span key={entry.position} className="w-6 text-center text-faint" aria-hidden="true">
                            ...
                        </span>
                    ) : (
                        <button
                            key={entry.position}
                            className={
                                entry.value === props.page
                                    ? 'nums flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-control bg-text px-2 text-[14px] font-bold text-surface'
                                    : 'nums flex h-11 min-w-11 cursor-pointer items-center justify-center rounded-control px-2 text-[14px] font-semibold text-muted transition-colors duration-200 hover:bg-overlay hover:text-text'
                            }
                            type="button"
                            aria-current={entry.value === props.page ? 'page' : undefined}
                            onClick={() => props.onChange(entry.value as number)}
                        >
                            {lang() === 'fa' ? faDigits(String(entry.value)) : entry.value}
                        </button>
                    )
                )}
            </span>

            <Tooltip label={t('common.next')}>
                <button
                    className={jumpClass}
                    type="button"
                    aria-label={t('common.next')}
                    disabled={props.page >= props.pages}
                    onClick={() => props.onChange(props.page + 1)}
                >
                    <Icon name="chevron-right" size={17} />
                </button>
            </Tooltip>
            <Tooltip label={t('common.lastPage')}>
                <button
                    className={jumpClass}
                    type="button"
                    aria-label={t('common.lastPage')}
                    disabled={props.page >= props.pages}
                    onClick={() => props.onChange(props.pages)}
                >
                    <Icon name="chevrons-right" size={17} />
                </button>
            </Tooltip>
        </nav>
    );
}
