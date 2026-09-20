// The Jalali calendar. Intl converts one way only - an instant to calendar parts - so the
// inverse is arithmetic written here, and arithmetic written here is what a test is for.
//
// The round-trip cases below are real dates, not invented ones: 1403 is a Jalali leap year and
// has a 30th of Esfand, 1404 does not, and Farvardin 1 lands on 20 or 21 March depending on the
// year. Any conversion that fudges the leap rule passes the easy cases and fails these.
import { describe, it, expect } from 'vitest';

import {
    addMonths,
    calendarTag,
    dateOf,
    monthGrid,
    monthLength,
    partsOf,
    resolveCalendar,
    sameDay,
    weekStart,
    type DateParts
} from '../src/i18n/calendar.ts';

describe('which calendar is in force', () =>
{
    it('follows the language under auto, and nothing else', () =>
    {
        expect(resolveCalendar('auto', 'fa')).toBe('jalali');
        expect(resolveCalendar('auto', 'en')).toBe('gregorian');
        expect(resolveCalendar('auto', 'ar')).toBe('gregorian');
    });

    it('lets an explicit choice override the language in both directions', () =>
    {
        // The whole point of the setting: an Iranian reading the app in English still counts
        // in Jalali, and a Persian reader working with a foreign counterparty may not want to.
        expect(resolveCalendar('jalali', 'en')).toBe('jalali');
        expect(resolveCalendar('gregorian', 'fa')).toBe('gregorian');
    });

    it('states the calendar in the tag rather than leaning on the locale default', () =>
    {
        // `fa-IR` already MEANS Jalali, so Gregorian has to be said out loud or the preference
        // silently does nothing for the one language most likely to set it.
        expect(calendarTag('fa', 'gregorian')).toContain('ca-gregory');
        expect(calendarTag('fa', 'jalali')).toContain('ca-persian');
        // Numerals follow the language, not the calendar.
        expect(calendarTag('en', 'jalali')).toContain('nu-latn');
        expect(calendarTag('fa', 'jalali')).not.toContain('nu-latn');
    });
});

describe('Jalali conversion', () =>
{
    const cases: Array<[DateParts, string]> = [
        [{ year: 1405, month: 6, day: 19 }, '2026-09-10'],
        [{ year: 1405, month: 1, day: 1 }, '2026-03-21'],
        [{ year: 1403, month: 12, day: 30 }, '2025-03-20'],
        [{ year: 1404, month: 12, day: 29 }, '2026-03-20'],
        [{ year: 1400, month: 7, day: 1 }, '2021-09-23']
    ];

    for (const [parts, gregorian] of cases)
    {
        it(`maps ${ parts.year }/${ parts.month }/${ parts.day } to ${ gregorian } and back`, () =>
        {
            const date = dateOf(parts, 'jalali');
            const [year, month, day] = gregorian.split('-').map(Number);
            expect(date.getFullYear()).toBe(year);
            expect(date.getMonth() + 1).toBe(month);
            expect(date.getDate()).toBe(day);
            expect(partsOf(date, 'jalali')).toEqual(parts);
        });
    }

    it('gives Esfand 30 days in a leap year and 29 otherwise', () =>
    {
        expect(monthLength({ year: 1403, month: 12, day: 1 }, 'jalali')).toBe(30);
        expect(monthLength({ year: 1404, month: 12, day: 1 }, 'jalali')).toBe(29);
    });

    it('keeps the first six months at 31 days and the next five at 30', () =>
    {
        expect(monthLength({ year: 1405, month: 1, day: 1 }, 'jalali')).toBe(31);
        expect(monthLength({ year: 1405, month: 6, day: 1 }, 'jalali')).toBe(31);
        expect(monthLength({ year: 1405, month: 7, day: 1 }, 'jalali')).toBe(30);
        expect(monthLength({ year: 1405, month: 11, day: 1 }, 'jalali')).toBe(30);
    });

    it('measures Gregorian months too, February included', () =>
    {
        expect(monthLength({ year: 2024, month: 2, day: 1 }, 'gregorian')).toBe(29);
        expect(monthLength({ year: 2026, month: 2, day: 1 }, 'gregorian')).toBe(28);
    });
});

describe('paging between months', () =>
{
    it('rolls the year over in both directions', () =>
    {
        expect(addMonths({ year: 1405, month: 12, day: 1 }, 1, 'jalali')).toMatchObject({ year: 1406, month: 1 });
        expect(addMonths({ year: 1405, month: 1, day: 1 }, -1, 'jalali')).toMatchObject({ year: 1404, month: 12 });
    });

    it('clamps a day the destination month does not have', () =>
    {
        // Paging from Farvardin 31 into Mehr, which has 30 days, must not produce Mehr 31.
        expect(addMonths({ year: 1405, month: 1, day: 31 }, 6, 'jalali')).toEqual({
            year: 1405,
            month: 7,
            day: 30
        });
    });
});

describe('the month grid', () =>
{
    it('pads the first row so the 1st sits under its own weekday column', () =>
    {
        const grid = monthGrid({ year: 1405, month: 6, day: 1 }, 'fa', 'jalali');
        const lead = grid.findIndex((cell) => cell !== null);
        const first = grid[lead] as Date;
        // Persian weeks start on Saturday, so the lead is the distance from Saturday.
        expect(weekStart('fa')).toBe(6);
        expect((first.getDay() - 6 + 7) % 7).toBe(lead);
        expect(grid.length - lead).toBe(monthLength({ year: 1405, month: 6, day: 1 }, 'jalali'));
    });

    it('starts an English week on Sunday and a French one on Monday', () =>
    {
        expect(weekStart('en')).toBe(0);
        expect(weekStart('fr')).toBe(1);
    });

    it('runs consecutive days with no gaps or repeats', () =>
    {
        const grid = monthGrid({ year: 1403, month: 12, day: 1 }, 'fa', 'jalali').filter(
            (cell): cell is Date => cell !== null
        );
        expect(grid).toHaveLength(30);
        for (let index = 1; index < grid.length; index++)
        {
            const previous = grid[index - 1] as Date;
            const current = grid[index] as Date;
            expect(partsOf(current, 'jalali').day).toBe(partsOf(previous, 'jalali').day + 1);
        }
    });
});

describe('sameDay', () =>
{
    it('ignores the clock but not the day', () =>
    {
        expect(sameDay(new Date(2026, 8, 10, 1), new Date(2026, 8, 10, 23))).toBe(true);
        expect(sameDay(new Date(2026, 8, 10, 23), new Date(2026, 8, 11, 0))).toBe(false);
    });
});
