// The one theme authority. `data-theme` on <html> is stamped here and nowhere else; the
// pre-paint script in index.html reads the same storage key so a saved choice never flashes.

import { createStore, createSignal, type Getter } from 'azerothjs';

import { readSetting, writeSetting } from '../lib/storage.ts';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'goman.theme';
const LEGACY_STORAGE_KEY = 'auctionhouse.theme';

function initialTheme(): Theme
{
    return (readSetting(STORAGE_KEY) ?? readSetting(LEGACY_STORAGE_KEY)) === 'light' ? 'light' : 'dark';
}

function stamp(theme: Theme): void
{
    if (typeof document !== 'undefined')
    {
        document.documentElement.dataset['theme'] = theme;
    }
}

export interface ThemeApi
{
    /** The active theme, reactively. */
    theme: Getter<Theme>;

    setTheme(next: Theme): void;

    toggle(): void;
}

export const useTheme = createStore((): ThemeApi =>
{
    const [theme, setThemeSignal] = createSignal<Theme>(initialTheme());
    stamp(theme());

    const setTheme = (next: Theme): void =>
    {
        setThemeSignal(next);
        stamp(next);
        writeSetting(STORAGE_KEY, next);
    };

    return {
        theme,
        setTheme,
        toggle: () => setTheme(theme() === 'dark' ? 'light' : 'dark')
    };
});
