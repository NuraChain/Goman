import { useEffect, useRef, useState } from 'react';

import type { SeriesPoint } from '../../api.ts';

import { VIEW_W, VIEW_H, TONE_VAR, type Tone, nextGradientId, linePath, areaPath } from './chart-math.ts';

// The price chart: a normalized SVG area line. Charts are the one place the UI stays LTR in
// both languages (time flows left-to-right by convention even in RTL interfaces), so the
// container pins dir="ltr". Digits around it use .latin-nums per the locale contract.
export default function Chart(props: { points: SeriesPoint[]; tone?: Tone; className?: string }) {
    // A lazy initialiser, so the id is minted ONCE per chart instance rather than on every
    // render - two charts sharing a gradient id would silently take each other's fill.
    const [gradientId] = useState(nextGradientId);
    const color = TONE_VAR[props.tone ?? 'brand'];

    const line = useRef<SVGPathElement>(null);

    // Draw-in: the dash offset walks from a full hide to zero on the frame after mount,
    // and again whenever the series changes.
    useEffect(() => {
        const frame = requestAnimationFrame(() => line.current?.style.setProperty('stroke-dashoffset', '0'));
        return () => cancelAnimationFrame(frame);
    }, [props.points]);

    return (
        <div className={`latin-nums ${props.className ?? ''}`} dir="ltr">
            <svg
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                preserveAspectRatio="none"
                className="block h-full w-full"
                aria-hidden="true"
            >
                <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.22" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <path d={areaPath(props.points)} fill={`url(#${gradientId})`} />
                <path
                    ref={line}
                    d={linePath(props.points)}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    pathLength="1"
                    style={{
                        strokeDasharray: 1,
                        strokeDashoffset: 1,
                        transition: 'stroke-dashoffset 700ms var(--ease-out)'
                    }}
                />
            </svg>
        </div>
    );
}
