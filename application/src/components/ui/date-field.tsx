import { useCallback, useRef, useState } from 'react';

import { useLocale } from '../../stores/locale.store.ts';
import { usePreferences } from '../../stores/preferences.store.ts';
import { useDismiss } from '../../hooks/use-dismiss.ts';

import { formatDateTime, faDigits } from '../../i18n/format.ts';
import {
    addMonths,
    monthGrid,
    monthLabel,
    partsOf,
    sameDay,
    weekdayLabels,
    type DateParts
} from '../../i18n/calendar.ts';

import Icon from '../../icons/icon.tsx';
import { iconButtonClass, inputClass, MENU_PANEL } from './variants.ts';

// A date-and-time field that renders the reader's own calendar.
//
// It replaces `<input type="datetime-local">`, which cannot do this job: browsers render that
// control in the GREGORIAN calendar whatever the page's language says, so a Persian admin was
// picking a Gregorian date and then being shown it back in Jalali everywhere else in the app.
// One of the two had to be wrong, and it was the one you type into.
//
// The VALUE keeps `datetime-local`'s exact spelling - `YYYY-MM-DDTHH:mm`, local wall clock, no
// zone - so it stays a drop-in wherever that string is already the contract. What changes is
// only how the value is shown and picked.

/** `YYYY-MM-DDTHH:mm`, the spelling `datetime-local` uses. Always Gregorian: it is a machine
 *  value, and every consumer already reads it with `new Date(...)`. */
function toValue(date: Date): string {
    const pad = (part: number): string => String(part).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Null for an empty or unparseable value - the field then shows its placeholder. */
function fromValue(value: string): Date | null {
    if (value === '') {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default function DateField(props: {
    value: string;
    onChange: (value: string) => void;

    /** The accessible name; the visible caption above the field is separate. */
    label: string;
    placeholder?: string;

    /** Days before this are unselectable - a lock time in the past cannot be deployed. */
    min?: Date;
}) {
    const { t, lang } = useLocale();
    const { calendarSystem } = usePreferences();

    const [open, setOpen] = useState(false);
    const selected = fromValue(props.value);

    // The month being browsed, which is NOT the selection: paging to next month must not move
    // the chosen day, and opening on an empty field has to land somewhere sensible.
    const [page, setPage] = useState<DateParts | null>(null);

    const root = useRef<HTMLDivElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const close = useCallback(() => setOpen(false), []);
    useDismiss({ open, onClose: close, root, trigger });

    const system = calendarSystem();
    const shown = page ?? partsOf(selected ?? props.min ?? new Date(), system);
    const days = monthGrid(shown, lang(), system);
    const today = new Date();

    /** Keeps the clock when the day changes, so picking a date does not reset 15:00 to midnight. */
    const pickDay = (day: Date): void => {
        const next = new Date(day);
        next.setHours(selected?.getHours() ?? 0, selected?.getMinutes() ?? 0, 0, 0);
        props.onChange(toValue(next));
        setOpen(false);
        trigger.current?.focus();
    };

    const setClock = (hours: number, minutes: number): void => {
        const next = new Date(selected ?? new Date());
        next.setHours(hours, minutes, 0, 0);
        props.onChange(toValue(next));
    };

    const blocked = (day: Date): boolean =>
        props.min !== undefined && day.getTime() < new Date(props.min).setHours(0, 0, 0, 0);

    // Latin digits would sit beside Persian ones everywhere else in the same panel.
    const digits = (value: number): string => (lang() === 'fa' ? faDigits(String(value)) : String(value));

    const dayClass = (day: Date): string => {
        const base =
            'flex h-9 w-full cursor-pointer items-center justify-center rounded-control text-[13px] transition-colors duration-[var(--motion-fast)]';
        if (selected !== null && sameDay(day, selected)) {
            return `${base} bg-brand font-bold text-on-brand`;
        }
        if (blocked(day)) {
            return `${base} cursor-not-allowed text-faint opacity-40`;
        }
        if (sameDay(day, today)) {
            return `${base} border border-brand font-semibold text-brand hover:bg-overlay`;
        }
        return `${base} text-text hover:bg-overlay`;
    };

    return (
        <div className="relative" ref={root}>
            <button
                ref={trigger}
                type="button"
                className={`${inputClass('md', false)} flex cursor-pointer items-center justify-between gap-2 text-start${
                    selected === null ? '' : ' pe-11'
                }`}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={props.label}
                onClick={() => setOpen(!open)}
            >
                <span className={selected === null ? 'truncate text-faint' : 'nums truncate'}>
                    {selected === null
                        ? (props.placeholder ?? props.label)
                        : formatDateTime(selected.toISOString(), lang(), system)}
                </span>
                {selected === null && <Icon name="calendar" size={16} />}
            </button>

            {/* Emptying the field, in the slot the calendar glyph vacates. A SIBLING of the
                trigger, never a child: a button inside a button is invalid, and the browser
                would open the picker on the way to clearing it.

                Only once there is something to clear - on an empty field it would be a control
                that does nothing, sitting where the affordance to open the picker belongs. */}
            {selected !== null && (
                <button
                    type="button"
                    className={`${iconButtonClass('sm')} absolute end-1.5 top-1/2 -translate-y-1/2`}
                    aria-label={t('common.clear')}
                    onClick={() => {
                        props.onChange('');
                        // Reopening should land on the month the field would have started on,
                        // not the one the cleared value was browsed to.
                        setPage(null);
                        // This button is about to unmount; without this the focus ring falls
                        // to the document and a keyboard user loses their place in the form.
                        trigger.current?.focus();
                    }}
                >
                    <Icon name="x" size={15} />
                </button>
            )}

            {open && (
                <div
                    className={`${MENU_PANEL} absolute top-full start-0 mt-1 w-[19rem] p-3`}
                    role="dialog"
                    aria-modal="false"
                    aria-label={props.label}
                >
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <button
                            type="button"
                            className={iconButtonClass('sm')}
                            aria-label={t('common.previous')}
                            onClick={() => setPage(addMonths(shown, -1, system))}
                        >
                            <Icon name="chevron-left" size={16} />
                        </button>
                        <span className="text-[14px] font-bold">{monthLabel(shown, lang(), system)}</span>
                        <button
                            type="button"
                            className={iconButtonClass('sm')}
                            aria-label={t('common.next')}
                            onClick={() => setPage(addMonths(shown, 1, system))}
                        >
                            <Icon name="chevron-right" size={16} />
                        </button>
                    </div>

                    <div className="grid grid-cols-7 gap-1">
                        {weekdayLabels(lang()).map((heading, column) => (
                            <span
                                key={`${heading}-${column}`}
                                className="flex h-7 items-center justify-center text-[11px] font-semibold text-faint"
                            >
                                {heading}
                            </span>
                        ))}
                        {days.map((day, index) =>
                            day === null ? (
                                <span key={`pad-${index}`} />
                            ) : (
                                <button
                                    key={day.getTime()}
                                    type="button"
                                    className={dayClass(day)}
                                    disabled={blocked(day)}
                                    onClick={() => pickDay(day)}
                                >
                                    <span className="nums">{digits(partsOf(day, system).day)}</span>
                                </button>
                            )
                        )}
                    </div>

                    <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                        <Icon name="clock" size={14} />
                        {/* Two number fields rather than `type="time"`: that control brings its
                            own locale-shaped AM/PM UI, which would sit beside a Jalali grid. */}
                        <input
                            type="number"
                            min={0}
                            max={23}
                            placeholder="00"
                            dir="ltr"
                            className={`${inputClass('sm', false)} nums w-16 text-center`}
                            aria-label={t('settings.calendarHour')}
                            value={selected === null ? '' : String(selected.getHours()).padStart(2, '0')}
                            onChange={(event) =>
                                setClock(
                                    Math.min(23, Math.max(0, Number(event.target.value))),
                                    selected?.getMinutes() ?? 0
                                )
                            }
                        />
                        <span className="text-muted">:</span>
                        <input
                            type="number"
                            min={0}
                            max={59}
                            placeholder="00"
                            dir="ltr"
                            className={`${inputClass('sm', false)} nums w-16 text-center`}
                            aria-label={t('settings.calendarMinute')}
                            value={selected === null ? '' : String(selected.getMinutes()).padStart(2, '0')}
                            onChange={(event) =>
                                setClock(
                                    selected?.getHours() ?? 0,
                                    Math.min(59, Math.max(0, Number(event.target.value)))
                                )
                            }
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
