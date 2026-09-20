import { langRow, type Lang } from './langs.ts';

// THE calendar module. Which calendar a date is read in is a separate axis from which language
// it is read in - an Iranian reader using the app in English still thinks in Jalali years, and
// a market's deadline is the same instant either way.
//
// Everything here goes through Intl's `persian` calendar rather than a hand-written conversion
// or a date library. Intl already ships the arithmetic in every browser this app supports, it
// gets the leap years right (1403 has a 30th of Esfand and 1404 does not), and it is the same
// engine that renders the dates, so a picker built on it can never disagree with the label
// beside it.
//
// Intl only converts FORWARD - an instant to calendar parts. The inverse is done here by
// landing near the target with plain arithmetic and walking the last few days, which keeps one
// source of truth for what a Jalali date means.

/** The stored preference. `auto` is the default and means "follow the language". */
export const CALENDARS = ['auto', 'gregorian', 'jalali'] as const;
export type CalendarMode = (typeof CALENDARS)[number];

/** A calendar actually in force, once `auto` has been resolved against the language. */
export type CalendarSystem = 'gregorian' | 'jalali';

/** A calendar date, 1-based month, as the reader sees it - NOT a Gregorian triple. */
export interface DateParts {
    year: number;
    month: number;
    day: number;
}

/**
 * The calendar to render in.
 * @param mode The reader's preference.
 * @param lang The active language, consulted only for `auto`.
 */
export function resolveCalendar(mode: CalendarMode, lang: Lang): CalendarSystem
{
    if (mode !== 'auto')
    {
        return mode;
    }
    return lang === 'fa' ? 'jalali' : 'gregorian';
}

/**
 * The BCP-47 tag for a language/calendar pair. The calendar is always stated explicitly,
 * never left to the locale's default: `fa-IR` already means Jalali, so a Persian reader who
 * asks for Gregorian needs `-ca-gregory` said out loud to get it.
 *
 * Numerals follow the LANGUAGE, not the calendar - Persian digits for `fa`, Latin everywhere
 * else, which is the same rule format.ts applies to every other number in the app.
 */
export function calendarTag(lang: Lang, system: CalendarSystem): string
{
    const calendar = system === 'jalali' ? 'ca-persian' : 'ca-gregory';
    return lang === 'fa' ? `fa-IR-u-${ calendar }` : `${ langRow(lang).intl }-u-${ calendar }-nu-latn`;
}

/** A cache of formatters: constructing one is the expensive part, and the grid builds many. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tag: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat
{
    const key = `${ tag }|${ JSON.stringify(options) }`;
    let found = formatters.get(key);
    if (found === undefined)
    {
        found = new Intl.DateTimeFormat(tag, options);
        formatters.set(key, found);
    }
    return found;
}

/** Parts are read in the Latin-numeral English locale so they parse back as numbers. */
const PARTS_OPTIONS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };

/**
 * A date's parts in the given calendar, in LOCAL time. Local, not UTC, because every date this
 * app collects is a wall-clock instant the admin typed - a market that locks at 15:00 locks at
 * 15:00 where the person setting it is standing.
 */
export function partsOf(date: Date, system: CalendarSystem): DateParts
{
    if (system === 'gregorian')
    {
        return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
    }
    const parts = formatter('en-u-ca-persian-nu-latn', PARTS_OPTIONS).formatToParts(date);
    const read = (type: string): number => Number(parts.find((part) => part.type === type)?.value ?? '0');
    return { year: read('year'), month: read('month'), day: read('day') };
}

/** Days in a Jalali month before it, used only to land the search near its target. */
function jalaliDayOfYear(month: number): number
{
    return month <= 7 ? (month - 1) * 31 : 186 + (month - 7) * 30;
}

/** A comparable key. Months never exceed 12 and days never 31, so this is strictly ordered. */
function ordinal(parts: DateParts): number
{
    return (parts.year * 12 + (parts.month - 1)) * 32 + parts.day;
}

/**
 * The local midnight of a calendar date - the inverse Intl does not provide.
 *
 * A Jalali year begins on 20 or 21 March of the Gregorian year 621 later, and the month
 * lengths are fixed apart from Esfand, so the estimate below is never more than a couple of
 * days out. The walk that follows compares against Intl itself, so the answer is Intl's
 * definition of the date rather than this function's.
 */
export function dateOf(parts: DateParts, system: CalendarSystem): Date
{
    if (system === 'gregorian')
    {
        return new Date(parts.year, parts.month - 1, parts.day);
    }
    const cursor = new Date(parts.year + 621, 2, 21);
    cursor.setDate(cursor.getDate() + jalaliDayOfYear(parts.month) + (parts.day - 1));

    const want = ordinal(parts);
    // Bounded so a locale whose Persian calendar disagrees wildly cannot spin: past this the
    // estimate was not an estimate, and returning the cursor beats hanging the picker.
    for (let guard = 0; guard < 40; guard++)
    {
        const step = want - ordinal(partsOf(cursor, 'jalali'));
        if (step === 0)
        {
            return cursor;
        }
        cursor.setDate(cursor.getDate() + (step > 0 ? 1 : -1));
    }
    return cursor;
}

/** Days in the calendar month containing `parts`, measured rather than tabulated. */
export function monthLength(parts: DateParts, system: CalendarSystem): number
{
    const start = dateOf({ ...parts, day: 1 }, system);
    const next = dateOf(
        parts.month === 12 ? { year: parts.year + 1, month: 1, day: 1 } : { ...parts, month: parts.month + 1, day: 1 },
        system
    );
    return Math.round((next.getTime() - start.getTime()) / 86_400_000);
}

/** The same day-of-month in a month `delta` away, clamped to that month's length. */
export function addMonths(parts: DateParts, delta: number, system: CalendarSystem): DateParts
{
    const raw = parts.year * 12 + (parts.month - 1) + delta;
    const moved = { year: Math.floor(raw / 12), month: (raw % 12) + 1, day: 1 };
    return { ...moved, day: Math.min(parts.day, monthLength(moved, system)) };
}

/**
 * The weekday the locale starts its week on, as `Date.getDay()` numbers it (0 = Sunday).
 * Persian weeks start on Saturday and most European ones on Monday; getting this wrong shifts
 * every date in the grid by a column, which reads as the calendar simply being wrong.
 */
export function weekStart(lang: Lang): number
{
    const locale = new Intl.Locale(langRow(lang).intl) as Intl.Locale & {
        getWeekInfo?: () => { firstDay: number };
    };
    // ISO numbers Monday 1 through Sunday 7; getDay() numbers Sunday 0 through Saturday 6.
    const iso = locale.getWeekInfo?.().firstDay ?? 1;
    return iso === 7 ? 0 : iso;
}

/** Short weekday headings, starting at the locale's own first day. */
export function weekdayLabels(lang: Lang): string[]
{
    const start = weekStart(lang);
    // Any week will do; 4 Jan 1970 was a Sunday, so the offsets line up with getDay().
    return Array.from({ length: 7 }, (_, column) =>
        formatter(calendarTag(lang, 'gregorian'), { weekday: 'narrow' }).format(
            new Date(1970, 0, 4 + ((start + column) % 7))
        )
    );
}

/** The picker's header: the month and year of the shown page, in the reader's calendar. */
export function monthLabel(parts: DateParts, lang: Lang, system: CalendarSystem): string
{
    return formatter(calendarTag(lang, system), { month: 'long', year: 'numeric' }).format(
        dateOf({ ...parts, day: 1 }, system)
    );
}

/**
 * The days of one month page, padded at the front with the blanks that put the 1st under its
 * own weekday column. Trailing blanks are left to the grid - a row that ends early is not a
 * layout problem, whereas a first row that starts in the wrong column is a wrong calendar.
 */
export function monthGrid(parts: DateParts, lang: Lang, system: CalendarSystem): Array<Date | null>
{
    const first = dateOf({ ...parts, day: 1 }, system);
    const lead = (first.getDay() - weekStart(lang) + 7) % 7;
    const length = monthLength(parts, system);
    return [
        ...Array.from({ length: lead }, () => null),
        ...Array.from({ length }, (_, index) =>
        {
            const day = new Date(first);
            day.setDate(first.getDate() + index);
            return day;
        })
    ];
}

/** True when two dates fall on the same local day, whatever calendar names it. */
export function sameDay(a: Date, b: Date): boolean
{
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
