import { useEffect, useState } from 'react';

// A clock that re-renders its component. Countdowns are the only thing in this app whose value
// changes with no user action and no server push, so this is deliberately the ONE place a
// timer drives a render - a component that sets its own interval has to remember to clear it,
// and a page full of round cards would then be a page full of drifting timers.
//
// One interval per component, not per value: every countdown on the /live page reads the same
// `now`, so they tick together instead of a second apart.

/**
 * The current time in milliseconds, refreshed on an interval.
 * @param everyMs How often to re-read the clock. One second suits a `m:ss` countdown.
 */
export function useNow(everyMs = 1000): number {
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), everyMs);
        return () => clearInterval(timer);
    }, [everyMs]);

    return now;
}

/**
 * Seconds remaining until an ISO deadline, floored at zero. A passed deadline reads as 0
 * rather than a negative number, because every caller renders it as a countdown.
 * @param iso The deadline.
 * @param now Milliseconds, from {@link useNow}.
 */
export function secondsUntil(iso: string, now: number): number {
    return Math.max(0, Math.floor((Date.parse(iso) - now) / 1000));
}
