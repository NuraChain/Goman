import type { Ref } from 'azerothjs';

/**
 * Arrow/Home/End focus walking for menu-pattern popups (focus MOVES between items, per the
 * ARIA menu pattern - listboxes like Select keep focus on the trigger instead and highlight an
 * active option). Wire the returned handler on the wrapper's onKeyDown so it works from the
 * trigger and from any item; items are queried live, so it needs no ref to the panel - only to
 * the wrapper that contains it.
 *
 * `open` is a GETTER: the handler is built once and must read the current state, not the one
 * the menu was created with.
 */
export function useRovingFocus(options: {
    open: () => boolean;
    root: Ref<HTMLElement>;
    selector?: string;
}): (event: KeyboardEvent) => void
{
    const { open, root, selector } = options;

    return (event: KeyboardEvent) =>
    {
        if (!open())
        {
            return;
        }

        const focusItem = (pick: (at: number) => number): void =>
        {
            const items = [...(root.current?.querySelectorAll<HTMLElement>(selector ?? '[role="menuitem"]') ?? [])];
            if (items.length === 0)
            {
                return;
            }
            const at = items.indexOf(document.activeElement as HTMLElement);
            const next = Math.min(items.length - 1, Math.max(0, pick(at)));
            items[next]?.focus();
        };

        if (event.key === 'ArrowDown')
        {
            event.preventDefault();
            focusItem((at) => at + 1);
        }
        else if (event.key === 'ArrowUp')
        {
            event.preventDefault();
            focusItem((at) => (at === -1 ? Number.MAX_SAFE_INTEGER : at - 1));
        }
        else if (event.key === 'Home')
        {
            event.preventDefault();
            focusItem(() => 0);
        }
        else if (event.key === 'End')
        {
            event.preventDefault();
            focusItem(() => Number.MAX_SAFE_INTEGER);
        }
    };
}
