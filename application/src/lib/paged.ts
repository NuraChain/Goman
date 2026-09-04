// The one pagination window: clamped current page plus the visible slice, so every list
// derives the same three values instead of re-spelling the math.

export interface Paged<T> {
    rows: T[];

    /** Total pages, never below 1 - an empty list still has page 1. */
    pages: number;

    /** The requested page clamped into range, so a shrinking list never strands the view. */
    current: number;
}

export function pageOf<T>(items: readonly T[], page: number, size: number): Paged<T> {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(page, pages);
    return { rows: items.slice((current - 1) * size, current * size), pages, current };
}
