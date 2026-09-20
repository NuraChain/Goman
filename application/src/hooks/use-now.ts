import { createSignal, onCleanup, type Getter } from 'azerothjs';

// A clock that drives the relative times on screen. Relative times are the only thing in this
// app whose value changes with no user action and no server push, so this is deliberately the
// ONE place a timer moves the UI - a component that sets its own interval has to remember to
// clear it, and a list of them would be a list of drifting timers.

/**
 * The current time in milliseconds, refreshed on an interval.
 *
 * Returns a GETTER, and the interval is cleared with the calling component's scope.
 *
 * @param everyMs How often to re-read the clock. One second suits a `m:ss` countdown.
 */
export function useNow(everyMs = 1000): Getter<number>
{
    const [now, setNow] = createSignal(Date.now());

    const timer = setInterval(() => setNow(Date.now()), everyMs);
    onCleanup(() => clearInterval(timer));

    return now;
}
