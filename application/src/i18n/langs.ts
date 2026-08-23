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

export type Dir = 'ltr' | 'rtl';

// The literal rows. `as const` is what lets Lang be DERIVED from them rather than written a
// second time - but it also makes the tuple readonly, and the `<For>` control flow takes a
// mutable array. Hence the pair: ROWS types the union, LANGS is what the UI iterates.
const ROWS = [
    { code: 'en', endonym: 'English', dir: 'ltr', intl: 'en-US', badge: 'EN' },
    { code: 'fa', endonym: 'فارسی', dir: 'rtl', intl: 'fa-IR', badge: 'فا' },
    { code: 'ar', endonym: 'العربية', dir: 'rtl', intl: 'ar', badge: 'ع' },
    { code: 'es', endonym: 'Español', dir: 'ltr', intl: 'es-ES', badge: 'ES' },
    { code: 'pt', endonym: 'Português', dir: 'ltr', intl: 'pt-BR', badge: 'PT' },
    { code: 'hi', endonym: 'हिन्दी', dir: 'ltr', intl: 'hi-IN', badge: 'हि' },
    { code: 'zh', endonym: '中文', dir: 'ltr', intl: 'zh-CN', badge: '中' },
    { code: 'ru', endonym: 'Русский', dir: 'ltr', intl: 'ru-RU', badge: 'RU' },
    { code: 'fr', endonym: 'Français', dir: 'ltr', intl: 'fr-FR', badge: 'FR' },
    { code: 'tr', endonym: 'Türkçe', dir: 'ltr', intl: 'tr-TR', badge: 'TR' }
] as const;

/** Every language code the app can render. Derived from the rows - never written twice. */
export type Lang = typeof ROWS[number]['code'];

export interface LangRow
{
    code: Lang;
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
export function langRow(code: Lang): LangRow
{
    return BY_CODE.get(code) ?? LANGS[0];
}

/** Narrows an untrusted string (localStorage, a URL, a header) to a supported code. */
export function isLang(value: string | null): value is Lang
{
    return value !== null && BY_CODE.has(value);
}
