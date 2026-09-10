// THE language registry. A language exists in this app when it has a row here AND a
// dictionary bound to its code in locale.store.ts - nothing else enumerates languages, so
// adding the eleventh is two edits, not eleven. The row carries everything the rest of the
// app asks about a language:
//
//   endonym - the name in its OWN language, which is the only name a speaker scanning a
//             language list can find. "Persian" is useless to someone who reads فارسی.
//   dir     - stamped on <html> by the locale store; Tailwind's logical properties do the rest.
//   intl    - the BCP-47 tag handed to Intl for dates and numbers. NOT the same string as the
//             code: 'pt' means Brazilian Portuguese here, 'zh' means Simplified.
//   badge   - the 2-3 glyph label the header toggle shows for the ACTIVE language.
//   flag    - ISO 3166-1 alpha-2 of the country whose flag stands for the language, and the
//             filename under public/flags. A language is not a country - 'ar' picks one of
//             twenty - so this is a PRESENTATION choice, never a source of locale truth.

import type { ContentLang } from '../../../server/src/wire.ts';

export type Dir = 'ltr' | 'rtl';

// The literal rows. `as const` is what lets Lang be DERIVED from them rather than written a
// second time - but it also makes the tuple readonly, and the `<For>` control flow takes a
// mutable array. Hence the pair: ROWS types the union, LANGS is what the UI iterates.
const ROWS = [
    { code: 'en', flag: 'us', endonym: 'English', dir: 'ltr', intl: 'en-US', badge: 'EN' },
    { code: 'fa', flag: 'ir', endonym: 'فارسی', dir: 'rtl', intl: 'fa-IR', badge: 'فا' },
    { code: 'ar', flag: 'sa', endonym: 'العربية', dir: 'rtl', intl: 'ar', badge: 'ع' },
    { code: 'es', flag: 'es', endonym: 'Español', dir: 'ltr', intl: 'es-ES', badge: 'ES' },
    { code: 'pt', flag: 'br', endonym: 'Português', dir: 'ltr', intl: 'pt-BR', badge: 'PT' },
    { code: 'hi', flag: 'in', endonym: 'हिन्दी', dir: 'ltr', intl: 'hi-IN', badge: 'हि' },
    { code: 'zh', flag: 'cn', endonym: '中文', dir: 'ltr', intl: 'zh-CN', badge: '中' },
    { code: 'ru', flag: 'ru', endonym: 'Русский', dir: 'ltr', intl: 'ru-RU', badge: 'RU' },
    { code: 'fr', flag: 'fr', endonym: 'Français', dir: 'ltr', intl: 'fr-FR', badge: 'FR' },
    { code: 'tr', flag: 'tr', endonym: 'Türkçe', dir: 'ltr', intl: 'tr-TR', badge: 'TR' }
] as const;

/** Every language code the app can render. Derived from the rows - never written twice. */
export type Lang = (typeof ROWS)[number]['code'];

export interface LangRow {
    code: Lang;
    flag: string;
    endonym: string;
    dir: Dir;
    intl: string;
    badge: string;
}

/** The rows the pickers iterate. The `LangRow[]` annotation is the shape gate: a row with a
 *  bad `dir` or a stray field fails here, at the source, not at a call site. */
export const LANGS: LangRow[] = ROWS.map((row) => ({ ...row }));

const BY_CODE = new Map<string, LangRow>(LANGS.map((row) => [row.code, row]));

/** The row for a code. `en` is the floor: it is the only dictionary guaranteed complete. */
export function langRow(code: Lang): LangRow {
    return BY_CODE.get(code) ?? LANGS[0];
}

/** Narrows an untrusted string (localStorage, a URL, a header) to a supported code. */
export function isLang(value: string | null): value is Lang {
    return value !== null && BY_CODE.has(value);
}

/** code -> dir, for the pre-paint script in index.html. Vite injects THIS object into that
 *  inline script at transform time, which is what keeps the document's very first frame
 *  agreeing with `preferredLang` below without a second copy of the language list in HTML. */
export const LANG_DIRS: Record<string, Dir> = Object.fromEntries(LANGS.map((row) => [row.code, row.dir]));

/**
 * The best supported language for a visitor who has never chosen one - `navigator.languages`
 * in browser order, English when none of it is a language we render.
 *
 * Matched on the PRIMARY SUBTAG only: a browser asking for `pt-PT`, `zh-TW` or `es-419` gets
 * the one Portuguese, Chinese or Spanish this app has rather than nothing at all. That is a
 * deliberate approximation - see the `intl` field above for which regional variant each code
 * actually formats as.
 *
 * `tags` is injectable so this is testable without stubbing a global; production passes none.
 */
export function preferredLang(tags?: readonly string[]): Lang {
    const wanted = tags ?? globalThis.navigator?.languages ?? [];
    for (const tag of wanted) {
        const primary = String(tag).toLowerCase().split('-')[0] ?? '';
        if (isLang(primary)) {
            return primary;
        }
    }
    return 'en';
}

/**
 * The languages the UI renders and the languages a market can be WRITTEN in are ONE set. The
 * create form iterates LANGS and stores each translation under that code; `text()` in the
 * locale store then reads a wire `Localized` by the active code. Adding a language to only
 * one of the two lists is a compile error here rather than a market nobody can read.
 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type _SameLanguages = Assert<Equals<Lang, ContentLang>>;
