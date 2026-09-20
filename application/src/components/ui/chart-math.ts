// The chart's pure math: normalized-viewbox scaling and SVG path building, kept out of the
// component so the geometry is testable without a DOM.

import type { SeriesPoint } from '../../api.ts';

export const VIEW_W = 100;
export const VIEW_H = 36;
const PAD_Y = 3;

export type Tone = 'brand' | 'gold' | 'no';

export const TONE_VAR: Record<Tone, string> = {
    brand: 'var(--chart-1)',
    gold: 'var(--chart-2)',
    no: 'var(--chart-3)'
};

let gradientCounter = 0;

/** A document-unique id for the fill gradient - one chart, one gradient def. */
export function nextGradientId(): string
{
    return `chart-fill-${ ++gradientCounter }`;
}

function scale(points: SeriesPoint[]): Array<{ x: number; y: number }>
{
    if (points.length === 0)
    {
        return [];
    }
    let min = Infinity;
    let max = -Infinity;
    for (const point of points)
    {
        min = Math.min(min, point.p);
        max = Math.max(max, point.p);
    }
    // A perfectly flat series (a market nobody traded yet) centers instead of collapsing to
    // the bottom edge - a floor-hugging line reads as a rendering fault, not as "no movement".
    const flat = max - min === 0;
    const span = max - min || 1;
    return points.map((point, index) => ({
        x: (index / Math.max(1, points.length - 1)) * VIEW_W,
        y: flat ? VIEW_H / 2 : VIEW_H - PAD_Y - ((point.p - min) / span) * (VIEW_H - 2 * PAD_Y)
    }));
}

export function linePath(points: SeriesPoint[]): string
{
    return scale(points)
        .map((point, index) => `${ index === 0 ? 'M' : 'L' }${ point.x.toFixed(2) } ${ point.y.toFixed(2) }`)
        .join(' ');
}

export function areaPath(points: SeriesPoint[]): string
{
    const line = linePath(points);
    return line === '' ? '' : `${ line } L${ VIEW_W } ${ VIEW_H } L0 ${ VIEW_H } Z`;
}
