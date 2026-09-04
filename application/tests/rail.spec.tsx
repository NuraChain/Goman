// The shared Rail's contract: it renders every item through the row callback, exposes the
// desktop controls, and its dot mapping is scroll-PROGRESS based (not position/width, which
// pinned the first dot active forever on wide screens). happy-dom reports 0 for clientWidth
// and scrollWidth, so the geometry-dependent assertions drive measure() through a real
// scroll event with stubbed metrics rather than trusting layout.
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import Rail from '../src/components/ui/rail.tsx';

interface Row {
    id: string;
}

const ROWS: Row[] = Array.from({ length: 6 }, (_item, index) => ({ id: `r${index}` }));

function railOf(container: Element): HTMLElement {
    const rail = container.querySelector<HTMLElement>('.rail');
    if (rail === null) {
        throw new Error('rail element missing');
    }
    return rail;
}

/** Stubs the scroll geometry happy-dom does not lay out, then drives a real scroll event. */
function scrollTo(rail: HTMLElement, options: { client: number; total: number; left: number }): void {
    Object.defineProperty(rail, 'clientWidth', { value: options.client, configurable: true });
    Object.defineProperty(rail, 'scrollWidth', { value: options.total, configurable: true });
    Object.defineProperty(rail, 'scrollLeft', { value: options.left, configurable: true, writable: true });
    fireEvent.scroll(rail);
}

describe('Rail', () => {
    it('renders one slot per item through the row callback', () => {
        const { container } = render(
            <Rail items={ROWS} itemKey={(row: Row) => row.id} label="Related" slotClass="w-10 shrink-0">
                {(row: Row) => row.id}
            </Rail>
        );

        const slots = railOf(container).querySelectorAll('.w-10');
        expect(slots).toHaveLength(6);
        expect(container.textContent).toContain('r5');
    });

    it('exposes prev/next arrows, disabled at the start until the rail is scrolled', () => {
        const { container } = render(
            <Rail items={ROWS} itemKey={(row: Row) => row.id} label="Related" slotClass="shrink-0">
                {(row: Row) => row.id}
            </Rail>
        );

        const arrows = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label]')].filter((button) =>
            button.getAttribute('aria-label')?.startsWith('Related:')
        );
        expect(arrows).toHaveLength(2);
        // Nothing has scrolled, so both ends are "at" and both arrows are inert.
        expect(arrows.every((button) => button.disabled)).toBe(true);
    });

    it('maps the active dot from scroll PROGRESS, so the last page selects the last dot', () => {
        const { container } = render(
            <Rail items={ROWS} itemKey={(row: Row) => row.id} label="Related" slotClass="shrink-0">
                {(row: Row) => row.id}
            </Rail>
        );

        const rail = railOf(container);
        // 3 viewports of content: pages = ceil((900-4)/300) = 3.
        scrollTo(rail, { client: 300, total: 900, left: 0 });
        const dots = (): HTMLButtonElement[] => [
            ...container.querySelectorAll<HTMLButtonElement>('button[aria-current]')
        ];
        expect(dots()).toHaveLength(3);
        expect(dots()[0]?.getAttribute('aria-current')).toBe('true');

        // Fully scrolled: progress 1 -> the LAST dot, which position/width would have missed.
        scrollTo(rail, { client: 300, total: 900, left: 600 });
        expect(dots()[2]?.getAttribute('aria-current')).toBe('true');

        // Halfway: the middle dot.
        scrollTo(rail, { client: 300, total: 900, left: 300 });
        expect(dots()[1]?.getAttribute('aria-current')).toBe('true');
    });

    it('reads a negative scrollLeft (RTL) by magnitude, not sign', () => {
        const { container } = render(
            <Rail items={ROWS} itemKey={(row: Row) => row.id} label="Related" slotClass="shrink-0">
                {(row: Row) => row.id}
            </Rail>
        );

        const rail = railOf(container);
        scrollTo(rail, { client: 300, total: 900, left: -600 });
        const dots = [...container.querySelectorAll<HTMLButtonElement>('button[aria-current]')];
        expect(dots[2]?.getAttribute('aria-current')).toBe('true');
    });

    it('omits the dot row when dots is false, keeping the arrows', () => {
        const { container } = render(
            <Rail
                items={ROWS}
                itemKey={(row: Row) => row.id}
                label="Categories"
                slotClass="shrink-0"
                dots={false}
                arrows="edge"
            >
                {(row: Row) => row.id}
            </Rail>
        );

        scrollTo(railOf(container), { client: 300, total: 900, left: 300 });
        expect(container.querySelectorAll('button[aria-current]')).toHaveLength(0);
        const arrows = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label]')].filter((button) =>
            button.getAttribute('aria-label')?.startsWith('Categories:')
        );
        expect(arrows).toHaveLength(2);
    });
});
