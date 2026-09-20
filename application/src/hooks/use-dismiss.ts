import { createEffect, onCleanup, type Ref } from 'azerothjs';

/**
 * The dismiss contract every floating menu shares: a pointer press OUTSIDE `root` closes it
 * while the press still reaches whatever it hit - no backdrop eating the first tap, and chrome
 * that would sit above a backdrop (the tab bar) closes it like everything else - and Escape
 * closes it and hands focus back to `trigger` so the keyboard never strands.
 *
 * Listeners exist only while the menu is open; the page scrolls freely underneath. Both
 * listeners are CAPTURING, so a child that stops propagation cannot trap the menu open.
 *
 * `open` is a GETTER, not a boolean: the calling component's body runs once, so a plain
 * boolean would freeze at whatever it was when the menu was first built.
 */
export function useDismiss(options: {
    open: () => boolean;
    onClose: () => void;
    root: Ref<HTMLElement>;
    trigger?: Ref<HTMLElement>;
}): void
{
    const { open, onClose, root, trigger } = options;

    createEffect(() =>
    {
        if (!open())
        {
            return;
        }

        const onPress = (event: Event): void =>
        {
            const element = root.current;
            if (element === null || (event.target instanceof Node && element.contains(event.target)))
            {
                return;
            }
            onClose();
        };

        const onKey = (event: KeyboardEvent): void =>
        {
            if (event.key !== 'Escape')
            {
                return;
            }
            onClose();
            trigger?.current?.focus();
        };

        document.addEventListener('pointerdown', onPress, true);
        document.addEventListener('keydown', onKey, true);
        onCleanup(() =>
        {
            document.removeEventListener('pointerdown', onPress, true);
            document.removeEventListener('keydown', onKey, true);
        });
    });
}
