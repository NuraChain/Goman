// The Tooltip's layering contract. The bubble must leave its trigger's DOM subtree entirely:
// rendered in place it inherited whatever stacking context and overflow clip its trigger sat
// in - under sheets in the header, and cut off outright inside a `.rail`, whose overflow-x
// makes the vertical axis a clip box. Escaping to the body is what makes its z-index mean
// anything, so that is what these assert.
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

import Tooltip from '../src/components/ui/tooltip.tsx';

/** The portaled bubble, found on the body rather than under the trigger. */
function bubble(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('[aria-hidden="true"].fixed');
}

function triggerOf(container: Element): HTMLElement {
    const wrap = container.querySelector<HTMLElement>('span.relative');
    if (wrap === null) {
        throw new Error('tooltip wrapper missing');
    }
    return wrap;
}

describe('Tooltip', () => {
    it('renders nothing until it is opened', () => {
        render(<Tooltip label="Copy link">x</Tooltip>);
        expect(bubble()).toBeNull();
    });

    it('portals the bubble OUT of the trigger subtree, onto the body', () => {
        const { container } = render(<Tooltip label="Copy link">x</Tooltip>);
        const wrap = triggerOf(container);

        fireEvent.focusIn(wrap);

        const tip = bubble();
        expect(tip).not.toBeNull();
        expect(tip?.textContent).toBe('Copy link');
        // The point of the whole component: the bubble is NOT inside the trigger, so no
        // ancestor of the trigger can clip it or cap its z-index.
        expect(wrap.contains(tip)).toBe(false);
        expect(document.body.contains(tip)).toBe(true);
    });

    it('positions the bubble with fixed coordinates, not inside the flow', () => {
        const { container } = render(<Tooltip label="Copy link">x</Tooltip>);
        fireEvent.focusIn(triggerOf(container));

        const tip = bubble();
        expect(tip?.className).toContain('fixed');
        expect(tip?.className).toContain('z-[var(--z-tooltip)]');
        // React serialises a style object with spaces after the colon and semicolon, so the
        // assertion tolerates whitespace rather than pinning one renderer's exact spelling.
        expect(tip?.getAttribute('style')).toMatch(/left:\s*-?[\d.]+px;\s*top:\s*-?[\d.]+px/);
    });

    it('closes on blur and removes the bubble from the body', () => {
        const { container } = render(<Tooltip label="Copy link">x</Tooltip>);
        const wrap = triggerOf(container);

        fireEvent.focusIn(wrap);
        expect(bubble()).not.toBeNull();

        fireEvent.focusOut(wrap);
        expect(bubble()).toBeNull();
    });

    it('dismisses on Escape (WCAG 1.4.13)', () => {
        const { container } = render(<Tooltip label="Copy link">x</Tooltip>);
        fireEvent.focusIn(triggerOf(container));
        expect(bubble()).not.toBeNull();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(bubble()).toBeNull();
    });

    it('keeps the bubble clear of the viewport edge', () => {
        const { container } = render(<Tooltip label="Copy link">x</Tooltip>);
        const wrap = triggerOf(container);
        // A trigger pinned to the left edge: centring on it alone would put the bubble's left
        // half off-screen, where the app shell's overflow-x-hidden simply cuts it off.
        wrap.getBoundingClientRect = () =>
            ({
                top: 300,
                bottom: 340,
                left: 0,
                right: 30,
                width: 30,
                height: 40,
                x: 0,
                y: 300,
                toJSON: () => ({})
            }) as DOMRect;

        fireEvent.focusIn(wrap);

        const left = Number(/left:\s*(-?[\d.]+)px/.exec(bubble()?.getAttribute('style') ?? '')?.[1]);
        expect(left).toBeGreaterThanOrEqual(8);
    });
});
