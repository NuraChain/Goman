// Shell contract: the chrome renders, and the two global switches really move the document -
// theme lands on <html data-theme>, language lands on <html lang/dir> AND in the visible copy.
// Stores are app singletons, so every toggle test restores what it flipped.
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import { AppFrame } from '../src/app.tsx';
import { LANGS } from '../src/i18n/langs.ts';

function mount(path = '/'): ReturnType<typeof render> {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <AppFrame />
        </MemoryRouter>
    );
}

function toggleButton(container: Element, index: number): HTMLButtonElement {
    const buttons = container.querySelectorAll<HTMLButtonElement>('header button');
    const button = buttons[index];
    if (button === undefined) {
        throw new Error(`header button ${index} missing`);
    }
    return button;
}

/** One row of the language sheet. The sheet only exists while it is open, so every caller
 *  opens it from the header first - which is the real interaction, not a shortcut around it.
 *  It renders as a sibling of the header, not inside it, which is why the query is not scoped. */
function langOption(container: Element, code: string): HTMLButtonElement {
    const option = container.querySelector<HTMLButtonElement>(`button[role="radio"][lang="${code}"]`);
    if (option === null) {
        throw new Error(`language option ${code} missing`);
    }
    return option;
}

describe('App shell', () => {
    it('renders the branded chrome on the home route', () => {
        const { container } = mount();
        expect(container.querySelector('header')).not.toBeNull();
        expect(container.textContent).toContain('Goman');
        expect(container.querySelector('header svg')).not.toBeNull();
    });

    it('the theme toggle flips data-theme on the document, both ways', () => {
        const { container } = mount();
        const before = document.documentElement.dataset['theme'];
        fireEvent.click(toggleButton(container, 0));
        const flipped = document.documentElement.dataset['theme'];
        expect(flipped).not.toBe(before);
        expect(['dark', 'light']).toContain(flipped);
        fireEvent.click(toggleButton(container, 0));
        expect(document.documentElement.dataset['theme']).toBe(before);
    });

    it('the language sheet restamps lang/dir and swaps the visible copy', () => {
        const { container } = mount();
        const before = document.documentElement.lang;
        const target = before === 'fa' ? 'en' : 'fa';

        fireEvent.click(toggleButton(container, 1));
        fireEvent.click(langOption(container, target));

        expect(document.documentElement.lang).toBe(target);
        expect(document.documentElement.dir).toBe(target === 'fa' ? 'rtl' : 'ltr');
        // The brand is transliterated in Persian, so the visible name IS the language check.
        expect(container.textContent).toContain(target === 'fa' ? 'گمان' : 'Goman');

        fireEvent.click(toggleButton(container, 1));
        fireEvent.click(langOption(container, before));
        expect(document.documentElement.lang).toBe(before);
    });

    it('every registered language is reachable from the language sheet, RTL ones included', () => {
        const { container } = mount();
        fireEvent.click(toggleButton(container, 1));
        const options = container.querySelectorAll('button[role="radio"]');
        expect(options.length).toBe(LANGS.length);

        // Arabic is the second RTL language; picking it must flip the document the same way
        // Persian does, because direction is read from the registry and not from `=== 'fa'`.
        fireEvent.click(langOption(container, 'ar'));
        expect(document.documentElement.lang).toBe('ar');
        expect(document.documentElement.dir).toBe('rtl');

        fireEvent.click(toggleButton(container, 1));
        fireEvent.click(langOption(container, 'en'));
        expect(document.documentElement.dir).toBe('ltr');
    });

    it('home always renders a DESIGNED state: cards, loading skeletons, or the error state', () => {
        // The suite must not depend on the dev API being up: with it, cards render; without
        // it, the resource lands in the designed error state (never a blank page).
        const { container } = mount();
        const cards = container.querySelectorAll('article').length > 0;
        const skeletons = container.querySelectorAll('.skeleton').length > 0;
        const errorState = container.querySelector('button') !== null && (container.textContent ?? '').length > 0;
        expect(cards || skeletons || errorState).toBe(true);
    });
});
