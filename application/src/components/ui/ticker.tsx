import { useEffect, useRef } from 'react';

// A number that announces its own change: when `value` moves, the rendered text flashes a
// decaying yes/no wash in the move's direction. Text and value are separate props because
// display strings are locale-formatted (possibly Persian digits) - comparing them would
// misread direction; the raw number never lies.
export default function Ticker(props: { text: string; value?: number; className?: string }) {
    const span = useRef<HTMLSpanElement>(null);
    const previous = useRef<number | undefined>(undefined);

    useEffect(() => {
        const next = props.value;
        const element = span.current;
        if (element !== null && previous.current !== undefined && next !== undefined && next !== previous.current) {
            const direction =
                next > previous.current ? 'motion-safe:animate-flash-up' : 'motion-safe:animate-flash-down';
            element.classList.remove('motion-safe:animate-flash-up', 'motion-safe:animate-flash-down');
            // Forces style recalculation so re-adding the class restarts the animation.
            void element.offsetWidth;
            element.classList.add(direction);
        }
        previous.current = next;
    }, [props.value]);

    return (
        <span className={`nums inline-block rounded px-0.5 ${props.className ?? ''}`} ref={span}>
            {props.text}
        </span>
    );
}
