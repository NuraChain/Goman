import { useEffect, useState } from 'react';

// A clock that re-renders its component. Relative times are the only thing in this app whose
// value changes with no user action and no server push, so this is deliberately the ONE place
// a timer drives a render - a component that sets its own interval has to remember to clear
// it, and a list of them would be a list of drifting timers.

/**
 * The current time in milliseconds, refreshed on an interval.
 * @param everyMs How often to re-read the clock. One second suits a `m:ss` countdown.
 */
export function useNow(everyMs = 1000): number
{
    const [now, setNow] = useState(() => Date.now());

    useEffect(() =>
    {
        const timer = setInterval(() => setNow(Date.now()), everyMs);
        return () => clearInterval(timer);
    }, [everyMs]);

    return now;
}
