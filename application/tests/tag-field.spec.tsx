// The tag field: the one place a market's subjects are written, in the create form and in
// the post-deploy edit dialog both. What is worth testing is the part a user would get
// wrong on the author's behalf - typing the same subject twice in two spellings, pasting a
// comma-separated list someone wrote in a chat, and the cap that keeps a market from being
// filed under everything.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import TagField from '../src/components/ui/tag-field.tsx';
import { TAGS_PER_MARKET } from '../src/api.ts';

/** The autocomplete is a fetch; nothing here is testing the network. */
function stubTags(rows: Array<{ slug: string; name: string; count: number }> = []): void
{
    vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response(JSON.stringify(rows), { headers: { 'content-type': 'text/json' } })))
    );
}

/** Renders the field as a caller holding the list would - state and all. */
function mount(initial: string[] = [])
{
    const onChange = vi.fn();
    const view = render(<TagField label="Tags" value={initial} onChange={onChange} />);
    const field = view.container.querySelector('input');
    if (field === null)
    {
        throw new Error('the tag input is missing');
    }
    return { onChange, field, view };
}

describe('TagField', () =>
{
    it('adds what was typed when Enter is pressed', () =>
    {
        stubTags();
        const { onChange, field } = mount();

        fireEvent.change(field, { target: { value: 'Iran Football' } });
        fireEvent.keyDown(field, { key: 'Enter' });

        // The author's own spelling is kept - the slug is what identifies it, not what is
        // shown back to the person who typed it.
        expect(onChange).toHaveBeenCalledWith(['Iran Football']);
    });

    it('refuses a second spelling of a tag the market already carries', () =>
    {
        stubTags();
        const { onChange, field } = mount(['Football']);

        fireEvent.change(field, { target: { value: 'FOOTBALL' } });
        fireEvent.keyDown(field, { key: 'Enter' });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('refuses a tag with no word in it', () =>
    {
        stubTags();
        const { onChange, field } = mount();

        fireEvent.change(field, { target: { value: '   !!!   ' } });
        fireEvent.keyDown(field, { key: 'Enter' });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('takes a pasted comma-separated list as separate tags', () =>
    {
        stubTags();
        const { onChange, field } = mount();

        // How a list arrives from anywhere that is not this form: a chat, a spreadsheet,
        // another operator's notes.
        fireEvent.change(field, { target: { value: 'football, iran, league' } });

        expect(onChange).toHaveBeenCalledWith(['football', 'iran']);
    });

    it('takes the last tag off on backspace in an empty field', () =>
    {
        stubTags();
        const { onChange, field } = mount(['football', 'iran']);

        fireEvent.keyDown(field, { key: 'Backspace' });

        expect(onChange).toHaveBeenCalledWith(['football']);
    });

    it('keeps a backspace that is deleting TEXT away from the tags', () =>
    {
        stubTags();
        const { onChange, field } = mount(['football']);

        fireEvent.change(field, { target: { value: 'ira' } });
        fireEvent.keyDown(field, { key: 'Backspace' });

        expect(onChange).not.toHaveBeenCalled();
    });

    it('stops accepting tags at the ceiling rather than silently dropping them', () =>
    {
        stubTags();
        const full = Array.from({ length: TAGS_PER_MARKET }, (_, at) => `tag-${ at }`);
        const { field } = mount(full);

        expect(field.disabled).toBe(true);
    });

    it('offers a completion and adds the one that is picked', async () =>
    {
        stubTags([{ slug: 'football', name: 'Football', count: 42 }]);
        const { onChange, field } = mount();

        fireEvent.focus(field);
        const suggestion = await screen.findByText('Football');

        // `mousedown`, because the input's blur fires before a click would land.
        fireEvent.mouseDown(suggestion);
        await waitFor(() => expect(onChange).toHaveBeenCalledWith(['Football']));
    });

    it('does not offer a tag the market already has', async () =>
    {
        stubTags([{ slug: 'football', name: 'Football', count: 42 }]);
        const { field } = mount(['Football']);

        fireEvent.focus(field);
        // The chip shows the tag once; the list must not offer it a second time.
        await waitFor(() => expect(screen.getAllByText('Football')).toHaveLength(1));
    });

    it('removes a tag from its chip', () =>
    {
        stubTags();
        const { onChange } = mount(['football', 'iran']);

        fireEvent.click(screen.getByLabelText(/football/i));

        expect(onChange).toHaveBeenCalledWith(['iran']);
    });
});
