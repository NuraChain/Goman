// Field direction. This app renders in ten languages, two of them RTL, and a field left to
// inherit the page direction is where a Latin value gets visually taken apart: `world-cup-2026`
// reads as `2026-world-cup`, `-12.5` puts its minus at the far end, and the browser's own number
// spinner lands on top of the digits. A number always goes LTR; anything else says so itself.
import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import Input from '../src/components/ui/input.tsx';

function fieldOf(container: Element): HTMLInputElement
{
    const input = container.querySelector('input');
    if (input === null)
    {
        throw new Error('input missing');
    }
    return input;
}

describe('Input direction', () =>
{
    it('pins a numeric field to LTR without the call site asking', () =>
    {
        const { container } = render(<Input type="number" label="Fee" value="250" />);
        expect(fieldOf(container).getAttribute('dir')).toBe('ltr');
        cleanup();
    });

    it('leaves a text field to the page, so Persian copy is typed in Persian', () =>
    {
        const { container } = render(<Input label="Search" value="" />);
        expect(fieldOf(container).getAttribute('dir')).toBeNull();
        cleanup();
    });

    it('lets an explicit direction win over the numeric default', () =>
    {
        const { container } = render(<Input type="number" dir="rtl" label="Fee" value="250" />);
        expect(fieldOf(container).getAttribute('dir')).toBe('rtl');
        cleanup();
    });

    it('carries a Latin run LTR when the call site says so', () =>
    {
        // The address, URL and category-id fields in the admin console.
        const { container } = render(<Input label="Treasury" dir="ltr" value="0xDABE" />);
        expect(fieldOf(container).getAttribute('dir')).toBe('ltr');
        cleanup();
    });

    // An empty field is showing its placeholder, and a placeholder is page copy - not a value.
    // Pinned to the value's direction, the Persian hint on the admin console's category field
    // rendered flush against the left edge of a right-aligned form with its comma stranded.
    it('follows the placeholder while the field is empty', () =>
    {
        const { container } = render(
            <Input label="Category" dir="ltr" placeholder="برای جستجو تایپ کن، یا دسته جدید بساز" value="" />
        );
        expect(fieldOf(container).getAttribute('dir')).toBe('rtl');
        cleanup();
    });

    it('hands the field back to the value on the first character typed', () =>
    {
        const { container } = render(<Input label="Category" dir="ltr" placeholder="برای جستجو تایپ کن" value="c" />);
        expect(fieldOf(container).getAttribute('dir')).toBe('ltr');
        cleanup();
    });

    it('keeps a Latin hint LTR, so https:// does not render as ://https', () =>
    {
        const { container } = render(<Input label="Image" dir="ltr" placeholder="https://" value="" />);
        expect(fieldOf(container).getAttribute('dir')).toBe('ltr');
        cleanup();
    });

    it('leaves a hint with no direction of its own to the field it sits in', () =>
    {
        // '0.00' is digits and a dot: nothing in it points either way, so the numeric default holds.
        const { container } = render(<Input type="number" label="Amount" placeholder="0.00" value="" />);
        expect(fieldOf(container).getAttribute('dir')).toBe('ltr');
        cleanup();
    });
});
