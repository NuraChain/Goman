// The ONE locale authority: which language is active, which direction that implies, and the
// `t()` lookup every component uses. Direction and `lang` are stamped on <html> here and
// nowhere else, so the document, Tailwind's logical properties, and the fonts all switch from
// a single write.
//
// The choice is persisted in a COOKIE rather than local storage, because the server is what
// has to act on it: `mountPages` negotiates the language per request and renders the page in
// it, so the first paint is already right instead of being corrected afterwards. A page that
// arrives stamped therefore outranks everything here - the server has already decided.
//
// The language SET lives in ../i18n/langs.ts. This file binds each code to its dictionary and
// is the only other place that has to change when a language is added.

import { createStore, createSignal, setLocale, useLocale as hostLocale, type Getter } from 'azerothjs';

import { readSetting } from '../lib/storage.ts';

import { LANGS, langRow, isLang, preferredLang, type Lang, type Dir } from '../i18n/langs.ts';

import type { Localized } from '../../../server/src/wire.ts';

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
const STORAGE_KEY = 'goman.lang';
const LEGACY_STORAGE_KEY = 'auctionhouse.lang';

// The order is a precedence, not a search. A STAMPED `<html lang>` is the language the server
// negotiated and rendered this document in, so it outranks everything - disagreeing with it
// would mean repainting a page that is already correct. The shell carries no `lang` of its own
// precisely so that an absent one means "nobody decided", which is the dev server and an
// offline cache hit. Behind it sits the one-time read of the old saved setting, so a returning
// visitor's choice survives the move off local storage, and then the browser's own languages.
//
// A detected language is deliberately NOT persisted: writing it back would freeze a guess into
// a choice, and a visitor who later switched their browser to Persian would stay on the
// English picked for them once.
function initialLang(): Lang
{
    if (typeof document === 'undefined')
    {
        // A server render. The host negotiated a locale and pinned it for this render, which
        // is the only place the answer exists - there is no document to read it back off yet,
        // because this render is what produces one.
        const pinned = hostLocale()();
        return isLang(pinned) ? pinned : 'en';
    }
    const stamped = document.documentElement.lang;
    if (isLang(stamped))
    {
        return stamped;
    }
    const saved = readSetting(STORAGE_KEY) ?? readSetting(LEGACY_STORAGE_KEY);
    return isLang(saved) ? saved : preferredLang();
}

function stamp(lang: Lang): void
{
    if (typeof document === 'undefined')
    {
        return;
    }
    const root = document.documentElement;
    root.classList.add('dir-flipping');
    setLocale(lang);
    requestAnimationFrame(() => root.classList.remove('dir-flipping'));
}

export interface LocaleApi {
    /** The active language, reactively. */
    lang: Getter<Lang>;

    /** The active direction, derived from the language. */
    dir: () => Dir;

    /** Switches the language, restamps the document, and writes the cookie the server reads. */
    setLang(next: Lang): void;

    /** Looks a message up by `section.key`; falls back to English, then to the key itself. */
    t(key: MessageKey): string;

    /** Picks the active language's variant of a translated wire string (market titles, rules). */
    text(localized: Localized): string;
}

export const useLocale = createStore((): LocaleApi =>
{
    const [lang, setLangSignal] = createSignal<Lang>(initialLang());

    // A negotiated document already says this, and re-saying it is free; a shell nobody
    // negotiated for is stamped here instead. Either way nothing is PERSISTED - a language
    // nobody chose must not become a choice.
    if (typeof document !== 'undefined')
    {
        document.documentElement.lang = lang();
        document.documentElement.dir = langRow(lang()).dir;
    }

    return {
        lang,
        dir: () => langRow(lang()).dir,
        setLang: (next) =>
        {
            setLangSignal(next);
            stamp(next);
        },
        t: (key) =>
        {
            const [section, name] = key.split('.') as [keyof Dictionary, string];
            const active = DICTIONARIES[lang()][section] as Record<string, string>;
            const fallback = en[section] as Record<string, string>;
            return active[name] ?? fallback[name] ?? key;
        },
        // Market titles, rules and outcome labels ride ON CHAIN, in whichever languages their
        // author wrote them. A market carries only those, never blank filler, so THIS is where
        // the fallback lives: a reader whose language the author skipped gets the English,
        // which is the one variant the create form refuses to deploy without.
        text: (localized) =>
        {
            // `?? ` alone is not enough: a stored empty string is a language someone opened
            // and never filled, and returning it renders a blank title rather than English.
            const chosen = localized[lang()];
            return chosen === undefined || chosen === '' ? localized.en : chosen;
        }
    };
});
