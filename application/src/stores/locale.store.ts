// The ONE locale authority: which language is active, which direction that implies, and the
// `t()` lookup every component uses. Direction and `lang` are stamped on <html> here and
// nowhere else, so the document, Tailwind's logical properties, and the fonts all switch from
// a single write. Persisted so a returning visitor keeps their choice.
//
// The language SET lives in ../i18n/langs.ts. This file binds each code to its dictionary and
// is the only other place that has to change when a language is added.

import { createStore, createSignal, type Getter } from 'azerothjs';

import { readSetting, writeSetting } from '../lib/storage.ts';

import { LANGS, langRow, isLang, type Lang, type Dir } from '../i18n/langs.ts';

import { en } from '../i18n/en.ts';
import { fa } from '../i18n/fa.ts';
import { ar } from '../i18n/ar.ts';
import { es } from '../i18n/es.ts';
import { pt } from '../i18n/pt.ts';
import { hi } from '../i18n/hi.ts';
import { zh } from '../i18n/zh.ts';
import { ru } from '../i18n/ru.ts';
import { fr } from '../i18n/fr.ts';
import { tr } from '../i18n/tr.ts';

export type { Lang, Dir };
export { LANGS, langRow };

/** The dictionary shape every language must satisfy - en is the source of truth. */
export type Dictionary = typeof en;

/** Dot-path keys of the dictionary (one level of nesting, which is all we use). */
export type MessageKey = {
    [Section in keyof Dictionary & string]: {
        [Key in keyof Dictionary[Section] & string]: `${ Section }.${ Key }`;
    }[keyof Dictionary[Section] & string];
}[keyof Dictionary & string];

/** Every code in LANGS must appear here - `Record<Lang, ...>` makes a missing one a compile
 *  error, which is the whole reason a language cannot be half-added. */
const DICTIONARIES: Record<Lang, Dictionary> = { en, fa, ar, es, pt, hi, zh, ru, fr, tr };
const STORAGE_KEY = 'auctionhouse.lang';

function initialLang(): Lang
{
    const saved = readSetting(STORAGE_KEY);
    return isLang(saved) ? saved : 'en';
}

/** Stamps lang/dir on the document. The flip is INSTANT by design: an animated RTL mirror
 *  reads as breakage, so a one-frame `dir-flipping` class suppresses every transition. */
function stamp(lang: Lang): void
{
    if (typeof document === 'undefined')
    {
        return;
    }
    const root = document.documentElement;
    root.classList.add('dir-flipping');
    root.lang = lang;
    root.dir = langRow(lang).dir;
    requestAnimationFrame(() => root.classList.remove('dir-flipping'));
}

export interface LocaleApi
{
    /** The active language, reactively. */
    lang: Getter<Lang>;

    /** The active direction, derived from the language. */
    dir: () => Dir;

    /** Switches the language, restamps the document, persists the choice. */
    setLang(next: Lang): void;

    /** Looks a message up by `section.key`; falls back to English, then to the key itself. */
    t(key: MessageKey): string;

    /** Picks the active language's variant of a bilingual wire string (market titles, rules). */
    text(localized: { en: string; fa: string }): string;
}

export const useLocale = createStore((): LocaleApi =>
{
    const [lang, setLangSignal] = createSignal<Lang>(initialLang());
    stamp(lang());

    return {
        lang,
        dir: () => langRow(lang()).dir,
        setLang: (next) =>
        {
            setLangSignal(next);
            stamp(next);
            writeSetting(STORAGE_KEY, next);
        },
        t: (key) =>
        {
            const [section, name] = key.split('.') as [keyof Dictionary, string];
            const active = DICTIONARIES[lang()][section] as Record<string, string>;
            const fallback = en[section] as Record<string, string>;
            return active[name] ?? fallback[name] ?? key;
        },
        // Market titles, rules and outcome labels ride ON CHAIN, and that payload is en+fa -
        // it does not grow when the UI gains a language. A reader in any of the other eight
        // gets the English variant, which is the one the market author is required to fill in.
        text: (localized) => (lang() === 'fa' ? localized.fa : localized.en)
    };
});
