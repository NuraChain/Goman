import { useEffect, useRef } from 'react';

// The probability ring on market cards: an SVG arc that draws in on mount and animates
// between prices. Purely decorative - the number beside it carries the value, so the ring
// is aria-hidden and never the only signal (the color-alone defect class).
export default function ChanceRing(props: { share: number; size?: number }) {
    const size = props.size ?? 44;
    const stroke = 4;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;

    const arc = useRef<SVGCircleElement>(null);

    // First paint shows an empty ring; the next frame animates to the real share, and any
    // later share change rides the same transition.
    useEffect(() => {
        const target = `${Math.max(0, Math.min(1, props.share)) * circumference} ${circumference}`;
        const frame = requestAnimationFrame(() => arc.current?.setAttribute('stroke-dasharray', target));
        return () => cancelAnimationFrame(frame);
    }, [props.share, circumference]);

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            aria-hidden="true"
            style={{ transform: 'rotate(-90deg)' }}
        >
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line)" strokeWidth={stroke} />
            <circle
                ref={arc}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="var(--brand)"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`0 ${circumference}`}
                style={{ transition: 'stroke-dasharray var(--motion-slow) var(--ease-out)' }}
            />
        </svg>
    );
}
