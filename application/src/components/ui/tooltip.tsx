import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

import { useDismiss } from '../../hooks/use-dismiss.ts';

// A token-matched tooltip for icon-only controls: pointer hover and KEYBOARD focus reveal it,
// a touch tap does not (hover-less devices get nothing - the control's aria-label speaks there).
//
// The bubble is PORTALED to the body and positioned `fixed` from the trigger's rect, because
// a z-index only orders siblings inside its own stacking context: rendered in place, the
// tooltip sat under sheets and toasts whenever its trigger lived in the header (sticky +
// z-index + backdrop-filter), and was CLIPPED outright inside a `.rail`, whose `overflow-x`
// makes the vertical axis a clip box and whose mask paints over it. Escaping to the body is
// what makes the layer ladder in tokens.css true rather than aspirational.
//
// The bubble is aria-hidden: every trigger already carries the same string as its accessible
// name, so exposing it again would announce twice. It is a visual affordance, not content.
export default function Tooltip(props: { label: string; children?: ReactNode }) {
    const [open, setOpen] = useState(false);
    const [below, setBelow] = useState(false);
    const [left, setLeft] = useState(0);
    const [top, setTop] = useState(0);

    const wrap = useRef<HTMLSpanElement>(null);
    const bubble = useRef<HTMLSpanElement>(null);

    // Read per event, never captured once: a value resolved at setup would pin the first
    // answer for the element's whole life, and the pointer type can change under it.
    const hoverable = (): boolean => typeof matchMedia !== 'undefined' && matchMedia('(hover: hover)').matches;

    // Focus opens the tooltip only for KEYBOARD focus, decided from the interaction that
    // caused it rather than from `:focus-visible`: engines exist that report support for the
    // selector and still never match it, which would silently kill the affordance for
    // keyboard users. A pointer press immediately before the focus is a tap or a click - the
    // mouse already gets the tooltip through hover, and a touch should get nothing.
    const viaPointer = useRef(false);

    const openOnFocus = (): void => {
        if (viaPointer.current) {
            viaPointer.current = false;
            return;
        }
        setOpen(true);
    };

    /**
     * Anchors the bubble to the trigger in viewport coordinates: flipped below when there is
     * no room above, and its centre clamped so a trigger near either edge cannot push the
     * bubble off-screen (the app's scroll region is `overflow-x-hidden`, so an overflowing
     * tooltip was simply cut off). Runs again on scroll/resize because a fixed bubble does
     * not follow its trigger.
     */
    const place = useCallback((): void => {
        const element = wrap.current;
        if (element === null) {
            return;
        }
        const rect = element.getBoundingClientRect();
        const half = (bubble.current?.getBoundingClientRect().width ?? 0) / 2;
        const min = 8 + half;
        const max = Math.max(min, window.innerWidth - 8 - half);
        setLeft(Math.min(Math.max(rect.left + rect.width / 2, min), max));
        // Flip against the TRIGGER's own box, not a fixed viewport threshold: what matters is
        // whether the bubble fits above this control, wherever the control sits.
        const flipped = rect.top < 44;
        setBelow(flipped);
        setTop(flipped ? rect.bottom + 6 : rect.top - 6);
    }, []);

    useEffect(() => {
        if (!open) {
            return;
        }
        // Twice: once now for the flip and a coarse centre, then after paint when the bubble
        // has a measurable width and the clamp can be exact.
        place();
        const frame = requestAnimationFrame(place);
        window.addEventListener('resize', place);
        // Capture phase: the app scrolls in an inner container, not on window.
        document.addEventListener('scroll', place, true);
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', place);
            document.removeEventListener('scroll', place, true);
        };
    }, [open, place]);

    // Escape dismisses (WCAG 1.4.13), and a press elsewhere closes one opened by focus. No
    // trigger refocus is passed - focus never left the control.
    const close = useCallback(() => setOpen(false), []);
    useDismiss({ open, onClose: close, root: wrap });

    return (
        <span
            className="relative inline-flex"
            ref={wrap}
            onPointerDown={() => {
                viaPointer.current = true;
            }}
            onMouseEnter={() => {
                if (hoverable()) {
                    setOpen(true);
                }
            }}
            onMouseLeave={() => setOpen(false)}
            onFocus={openOnFocus}
            onBlur={() => {
                viaPointer.current = false;
                setOpen(false);
            }}
        >
            {props.children}
            {open &&
                createPortal(
                    <span
                        ref={bubble}
                        className={
                            below
                                ? 'pointer-events-none fixed z-[var(--z-tooltip)] -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-line bg-overlay px-2 py-1 text-[12px] font-semibold text-text shadow-lg motion-safe:animate-fade'
                                : 'pointer-events-none fixed z-[var(--z-tooltip)] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[6px] border border-line bg-overlay px-2 py-1 text-[12px] font-semibold text-text shadow-lg motion-safe:animate-fade'
                        }
                        style={{ left: `${left}px`, top: `${top}px` }}
                        aria-hidden="true"
                    >
                        {props.label}
                    </span>,
                    document.body
                )}
        </span>
    );
}
