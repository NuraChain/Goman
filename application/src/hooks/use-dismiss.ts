import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * The dismiss contract every floating menu shares: a pointer press OUTSIDE `root` closes it
 * while the press still reaches whatever it hit - no backdrop eating the first tap, and chrome
 * that would sit above a backdrop (the tab bar) closes it like everything else - and Escape
 * closes it and hands focus back to `trigger` so the keyboard never strands.
 *
 * Listeners exist only while the menu is open; the page scrolls freely underneath. Both
 * listeners are CAPTURING, so a child that stops propagation cannot trap the menu open.
 */
export function useDismiss(options: {
    open: boolean;
    onClose: () => void;
    root: RefObject<HTMLElement | null>;
    trigger?: RefObject<HTMLElement | null>;
}): void {
    const { open, onClose, root, trigger } = options;

    useEffect(() => {
        if (!open) {
            return;
        }

        const onPress = (event: Event): void => {
            const element = root.current;
            if (element === null || (event.target instanceof Node && element.contains(event.target))) {
                return;
            }
            onClose();
        };

        const onKey = (event: KeyboardEvent): void => {
            if (event.key !== 'Escape') {
                return;
            }
            onClose();
            trigger?.current?.focus();
        };

        document.addEventListener('pointerdown', onPress, true);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('pointerdown', onPress, true);
            document.removeEventListener('keydown', onKey, true);
        };
    }, [open, onClose, root, trigger]);
}
