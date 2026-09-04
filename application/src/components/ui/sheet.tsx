import { useEffect } from 'react';
import type { ReactNode } from 'react';

import { useLocale } from '../../stores/locale.store.ts';

import Icon from '../../icons/icon.tsx';

import Tooltip from './tooltip.tsx';

// ONE overlay surface for the whole app - the fix for stacked-modal chaos: anything modal
// (auth, trade, filters, menu) rides this component, and only one can be open by design.
// Mobile: a bottom sheet with a drag handle. Desktop: a centered dialog. Same children.
export default function Sheet(props: { open: boolean; title?: string; onClose: () => void; children?: ReactNode }) {
    const { t } = useLocale();
    const { open, onClose } = props;

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKeydown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', onKeydown);
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKeydown);
            document.body.style.overflow = '';
        };
    }, [open, onClose]);

    if (!open) {
        return null;
    }

    return (
        <div className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center sm:items-center">
            <div
                className="absolute inset-0 bg-backdrop motion-safe:animate-fade"
                onClick={() => onClose()}
                aria-hidden="true"
            ></div>
            <div
                className="relative w-full rounded-t-sheet border-t border-line bg-raised pb-[env(safe-area-inset-bottom)] shadow-2xl motion-safe:animate-sheet-up sm:w-[26rem] sm:rounded-sheet sm:border sm:pb-0 sm:motion-safe:animate-pop"
                role="dialog"
                aria-modal="true"
                aria-label={props.title}
            >
                <span
                    className="mx-auto mt-2.5 block h-1 w-9 rounded-full bg-line-strong sm:hidden"
                    aria-hidden="true"
                ></span>
                <div className="flex items-center justify-between ps-5 pe-3 pt-3 pb-1">
                    <h2 className="text-[17px] font-bold">{props.title ?? ''}</h2>
                    <Tooltip label={t('common.close')}>
                        <button
                            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-control text-muted transition-colors duration-200 hover:bg-overlay hover:text-text"
                            type="button"
                            aria-label={t('common.close')}
                            onClick={() => onClose()}
                        >
                            <Icon name="x" size={20} />
                        </button>
                    </Tooltip>
                </div>
                <div className="px-5 pb-6">{props.children}</div>
            </div>
        </div>
    );
}
