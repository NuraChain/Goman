import { useEffect, useState } from 'react';

import type { ToastEntry } from '../../stores/toasts.store.ts';
import { useLocale } from '../../stores/locale.store.ts';

import Icon from '../../icons/icon.tsx';

// One toast row: slides in, self-dismisses after 4s, pauses while hovered. The tone icon
// travels WITH the color so meaning never rides color alone.
export default function ToastItem(props: { toast: ToastEntry; onDismiss: () => void }) {
    const { t } = useLocale();

    const [paused, setPaused] = useState(false);

    useEffect(() => {
        if (paused) {
            return;
        }
        const timer = setTimeout(() => props.onDismiss(), 4000);
        return () => clearTimeout(timer);
    });

    const toneClass =
        props.toast.tone === 'success'
            ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-yes-soft text-yes'
            : props.toast.tone === 'error'
              ? 'flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-no-soft text-no'
              : 'flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-brand-soft text-brand';

    const toneIcon =
        props.toast.icon ??
        (props.toast.tone === 'success' ? 'circle-check' : props.toast.tone === 'error' ? 'circle-x' : 'info');

    return (
        <div
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-card border border-line bg-overlay p-3 shadow-2xl motion-safe:animate-rise"
            role="status"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            <span className={toneClass}>
                <Icon name={toneIcon} size={18} />
            </span>
            <p className="min-w-0 flex-1 text-[13.5px] font-semibold leading-snug">{props.toast.message}</p>
            <button
                className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-control text-faint transition-colors duration-200 hover:bg-raised hover:text-text"
                type="button"
                aria-label={t('common.close')}
                onClick={() => props.onDismiss()}
            >
                <Icon name="x" size={15} />
            </button>
        </div>
    );
}
