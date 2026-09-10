// First visit: the app opens in the visitor's own language, or English when it has none of
// theirs. The pre-paint script in index.html has to reach the SAME answer as the store, so
// the table it is handed is pinned here too - a language added to langs.ts and missing from
// that table would flash LTR English before the bundle corrected it.
import { describe, it, expect, vi, afterEach } from 'vitest';

import { LANGS, LANG_DIRS, preferredLang } from '../src/i18n/langs.ts';

describe('preferred language', () => {
    it('takes the first supported language the browser asks for', () => {
        expect(preferredLang(['fa-IR', 'en-US'])).toBe('fa');
        expect(preferredLang(['tr', 'de'])).toBe('tr');
    });

    it('skips languages this app does not render rather than giving up at the first', () => {
        expect(preferredLang(['de-DE', 'nl', 'ru-RU', 'en'])).toBe('ru');
    });

    it('matches on the primary subtag, so a regional variant still lands', () => {
        // pt-PT reads Brazilian Portuguese here, zh-TW reads Simplified - the only ones we have.
        expect(preferredLang(['pt-PT'])).toBe('pt');
        expect(preferredLang(['zh-TW'])).toBe('zh');
        expect(preferredLang(['ES-419'])).toBe('es');
    });

    it('falls back to English on nothing, on junk, and on a language we do not carry', () => {
        expect(preferredLang([])).toBe('en');
        expect(preferredLang(['de', 'ja', 'ko'])).toBe('en');
        expect(preferredLang(['', '-', 'not a tag'])).toBe('en');
    });

    it('offers every language in the registry', () => {
        for (const row of LANGS) {
            expect(preferredLang([row.code])).toBe(row.code);
        }
    });
});

describe('pre-paint language table', () => {
    it('carries every language, with its direction, for index.html', () => {
        expect(Object.keys(LANG_DIRS).sort()).toEqual(LANGS.map((row) => row.code).sort());
        for (const row of LANGS) {
            expect(LANG_DIRS[row.code]).toBe(row.dir);
        }
        // The RTL pair is what the stamp exists for; a silent regression here is a mirrored UI.
        expect(LANG_DIRS.fa).toBe('rtl');
        expect(LANG_DIRS.ar).toBe('rtl');
        expect(LANG_DIRS.en).toBe('ltr');
    });
});

// The store is a singleton built on first read, so each case needs a fresh module registry
// AND a fresh navigator - which is the whole reason these are not in stores.spec.ts.
describe('locale store on a first visit', () => {
    const load = async (tags: string[], saved?: string) => {
        vi.resetModules();
        localStorage.clear();
        if (saved !== undefined) {
            localStorage.setItem('goman.lang', saved);
        }
        vi.stubGlobal('navigator', { languages: tags });
        const { useLocale } = await import('../src/stores/locale.store.ts');
        return useLocale.peek();
    };

    afterEach(() => {
        vi.unstubAllGlobals();
        localStorage.clear();
    });

    it('opens in the browser language, and stamps its direction on the document', async () => {
        const locale = await load(['fa-IR', 'en-US']);
        expect(locale.lang()).toBe('fa');
        expect(locale.dir()).toBe('rtl');
        expect(document.documentElement.lang).toBe('fa');
        expect(document.documentElement.dir).toBe('rtl');
    });

    it('opens in English when the browser asks for nothing we render', async () => {
        const locale = await load(['de-DE', 'ja']);
        expect(locale.lang()).toBe('en');
        expect(document.documentElement.dir).toBe('ltr');
    });

    // A guess must never harden into a choice, or switching the browser to Persian later
    // would keep serving the English we picked on the very first visit.
    it('does not persist what it detected', async () => {
        await load(['tr-TR']);
        expect(localStorage.getItem('goman.lang')).toBeNull();
    });

    it('a saved choice outranks the browser, and IS persisted when made', async () => {
        const locale = await load(['fa-IR'], 'tr');
        expect(locale.lang()).toBe('tr');

        locale.setLang('ar');
        expect(localStorage.getItem('goman.lang')).toBe('ar');
        expect(document.documentElement.dir).toBe('rtl');
    });
});
