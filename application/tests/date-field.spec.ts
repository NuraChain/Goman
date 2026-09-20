// The date field's empty-it button. The picker itself is calendar maths, covered in
// calendar.spec.ts; what is worth a test here is the control that puts the field BACK to
// nothing - a start time means "opens immediately" when it is empty, so being unable to
// un-pick a date changes what the market does.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from './harness.ts';

import DateField from '../src/components/ui/date-field.azeroth';

function mount(value: string)
{
    const onChange = vi.fn();
    const view = render(() => DateField({ label: 'Stop time', placeholder: 'Pick when trading stops', value: value, onChange: onChange }));
    return { onChange, view };
}

describe('DateField', () =>
{
    it('offers nothing to clear while the field is empty', () =>
    {
        const { view } = mount('');

        // A control that does nothing, sitting where the affordance to open the picker is.
        expect(view.queryByRole('button', { name: 'Clear' })).toBeNull();
        expect(view.getByRole('button', { name: 'Stop time' })).toBeTruthy();
    });

    it('empties the field without opening the picker', () =>
    {
        const { onChange, view } = mount('2026-12-01T20:00');

        fireEvent.click(view.getByRole('button', { name: 'Clear' }));

        expect(onChange).toHaveBeenCalledWith('');
        // The trigger is a button too: nesting one inside it would fire both, and the picker
        // would be left open over a field that had just been emptied.
        expect(view.getByRole('button', { name: 'Stop time' }).getAttribute('aria-expanded')).toBe('false');
    });
});
