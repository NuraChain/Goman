// Reader preferences that change how a value READS, not what it is: whether a probability is
// spelled as a price in cents (`34¢`) or a percentage (`34%`), and which calendar a date is
// counted in.
//
// It exists because the setting already shipped in Settings and was written to storage by a
// dropdown that NOTHING read - so the app went on rendering the same probability both ways,
// sometimes on the same screen. A stored preference with no store behind it is a promise the
// UI cannot keep.

import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

import { readSetting, writeSetting } from '../lib/storage.ts';

import type { OddsMode } from '../i18n/format.ts';
import { CALENDARS, resolveCalendar, type CalendarMode, type CalendarSystem } from '../i18n/calendar.ts';

import { useLocale } from './locale.store.ts';

const STORAGE_KEY = 'goman.odds';
const LEGACY_STORAGE_KEY = 'auctionhouse.odds';
const CALENDAR_KEY = 'goman.calendar';

// Percentage is the default because that is what a probability IS; cents is the trader's
// spelling of the same number and stays one setting away.
function initialMode(): OddsMode
{
    return (readSetting(STORAGE_KEY) ?? readSetting(LEGACY_STORAGE_KEY)) === 'price' ? 'price' : 'percent';
}

/**
 * `auto` is the default and means "follow the language", which is what the app did before this
 * setting existed - Jalali under Persian, Gregorian everywhere else. The setting is here for
 * the readers that rule gets wrong: an Iranian using the app in English still counts in Jalali,
 * and a market deadline is the same instant in either calendar.
 */
function initialCalendar(): CalendarMode
{
    const saved = readSetting(CALENDAR_KEY);
    return (CALENDARS as readonly string[]).includes(saved ?? '') ? (saved as CalendarMode) : 'auto';
}

export interface PreferencesApi {
    /** How probabilities are spelled across the whole UI, reactively. */
    oddsMode: Getter<OddsMode>;

    setOddsMode(next: OddsMode): void;

    /** The stored setting, including `auto`. The Settings control binds to this one. */
    calendar: Getter<CalendarMode>;

    setCalendar(next: CalendarMode): void;

    /**
     * The calendar actually in force, `auto` already resolved against the language. Date call
     * sites read THIS: resolving it in each of them would be the same two-line conditional
     * copied seven times, and the seventh copy is where the languages drift apart.
     */
    calendarSystem: Getter<CalendarSystem>;
}

export const usePreferences = createStore((): PreferencesApi =>
{
    // Reading the locale store LINKS the two: `auto` follows the language, so a date has to
    // re-render when the language changes even though no preference here did.
    const { lang } = useLocale();
    const [oddsMode, setSignal] = createSignal<OddsMode>(initialMode());
    const [calendar, setCalendarSignal] = createSignal<CalendarMode>(initialCalendar());

    return {
        oddsMode,
        setOddsMode: (next) =>
        {
            setSignal(next);
            writeSetting(STORAGE_KEY, next);
        },
        calendar,
        setCalendar: (next) =>
        {
            setCalendarSignal(next);
            writeSetting(CALENDAR_KEY, next);
        },
        calendarSystem: () => resolveCalendar(calendar(), lang())
    };
});
