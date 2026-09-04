// The component-level counterpart to `createResource`: async data owned by ONE component,
// re-fetched when its key changes. Stores use `createResource` from reactive.ts; a page or a
// panel uses this.
//
// The signature deliberately mirrors the store one - a source function that yields the key,
// and a fetcher that receives it - so there is one set of semantics to know rather than two.
// That includes the GATE: a source returning `false`, `null` or `undefined` means not ready,
// and nothing is fetched. The signed-out portfolio and the admin console both depend on it.
//
// It returns the same `Resource<T>` shape the stores expose, so `markets.data()`,
// `markets.loading()` and `config.data()` read identically wherever they came from.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Resource } from '../lib/reactive.ts';

interface State<T> {
    data?: T;
    loading: boolean;

    // `null`, never `undefined`: callers test `error() !== null`, and an undefined sentinel
    // would make every one of those checks read as "failed".
    error: unknown;
}

export function useResource<S, T>(
    source: () => S | false | null | undefined,
    fetcher: (key: S) => Promise<T>
): Resource<T> {
    const resolved = source();
    const ready = resolved !== false && resolved !== null && resolved !== undefined;

    const [state, setState] = useState<State<T>>({ loading: ready, error: null });
    const [nonce, setNonce] = useState(0);

    // The fetcher closes over fresh props every render; the effect must call the LATEST one
    // without listing it as a dependency, or every render would refetch.
    const latest = useRef(fetcher);
    latest.current = fetcher;

    // The key, by value. Everything the fetcher reads must appear in what `source` returns,
    // exactly as the framework's `with { source: ... }` required - or the request goes stale.
    const key = ready ? JSON.stringify(resolved) : null;

    useEffect(() => {
        if (key === null) {
            // Gate closed: keep whatever was loaded, but stop claiming to be in flight.
            setState((current) => ({ ...current, loading: false }));
            return;
        }

        let alive = true;
        setState((current) => ({ ...current, loading: true }));
        latest.current(JSON.parse(key) as S).then(
            (data) => {
                if (alive) {
                    setState({ data, loading: false, error: null });
                }
            },
            (error: unknown) => {
                if (alive) {
                    // The stale data is KEPT beside the error: a failed refresh should not
                    // blank a list that is still on screen and still true.
                    setState((current) => ({ data: current.data, loading: false, error }));
                }
            }
        );
        return () => {
            alive = false;
        };
    }, [key, nonce]);

    const refetch = useCallback(() => setNonce((current) => current + 1), []);

    return useMemo(
        () => ({
            data: () => state.data,
            loading: () => state.loading,
            error: () => state.error,
            refetch
        }),
        [state, refetch]
    );
}
