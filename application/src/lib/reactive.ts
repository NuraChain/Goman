// The app's store primitive: singleton stores whose reads are plain function calls, backed by
// `useSyncExternalStore`.
//
// Why not Context: there are twelve of these and they are genuinely app-global (the active
// language, the theme, the wallet session). Twelve nested providers would buy nothing except a
// tree to thread them through, and every store read would re-render its whole subtree unless
// hand-memoised. A store here lives outside React, so a module can read `useLocale().t` in a
// component and `locale.setLang()` from an event handler, and the pre-paint script in
// index.html can stamp the same document attributes the store owns.
//
// Granularity is PER STORE, not per signal: any change inside a store re-renders every
// component that called its hook. That is the same granularity the app had before and it is
// the reason the stores are split by concern rather than pooled into one.
import { useSyncExternalStore } from 'react';

/** A reactive read. Calling it inside a component that used the store subscribes to it. */
export type Getter<T> = () => T;

/** Accepts the next value, or an updater that receives the current one. */
export type Setter<T> = (next: T | ((current: T) => T)) => void;

interface Owner {
    bump(): void;
}

/**
 * The store whose factory is running right now. Signals and resources capture it at creation
 * so they know which store to notify - the same ownership trick a reactive runtime uses,
 * except the collection window is only the factory call rather than every render.
 */
let owner: Owner | null = null;

/**
 * A value that notifies its owning store when it changes. Created inside a store factory;
 * a signal created outside one still works, it simply has nothing to notify.
 */
export function createSignal<T>(initial: T): [Getter<T>, Setter<T>] {
    const home = owner;
    let value = initial;

    const get = (): T => value;
    const set: Setter<T> = (next) => {
        const resolved = typeof next === 'function' ? (next as (current: T) => T)(value) : next;
        if (Object.is(resolved, value)) {
            return;
        }
        value = resolved;
        home?.bump();
    };

    return [get, set];
}

export interface Resource<T> {
    /** The loaded value, or undefined before the first load resolves. */
    data(): T | undefined;

    /** True while a fetch is in flight - including a refetch that still has stale data. */
    loading(): boolean;

    /** The last rejection, or null. Cleared by the next success. */
    error(): unknown;

    /** Forces a re-read, ignoring the key. */
    refetch(): void;
}

/**
 * Async data owned by a store.
 *
 * The two-argument form fetches once, on first read. The three-argument form is KEYED: the
 * source is re-read on every access, the fetcher runs again whenever the key changes, and the
 * resolved key is handed to the fetcher.
 *
 * A source that returns `false`, `null` or `undefined` means NOT READY, and nothing is
 * fetched - which is how the admin console avoids calling its endpoints before a session
 * exists. The last loaded value survives a gate closing; it is stale, not wrong.
 */
export function createResource<T>(fetcher: () => Promise<T>, options?: { name?: string }): Resource<T>;
export function createResource<S, T>(
    source: () => S | false | null | undefined,
    fetcher: (key: S) => Promise<T>,
    options?: { name?: string }
): Resource<T>;
export function createResource<T>(
    first: (() => Promise<T>) | (() => unknown),
    second?: ((key: never) => Promise<T>) | { name?: string },
    _third?: { name?: string }
): Resource<T> {
    const hasSource = typeof second === 'function';
    const source = hasSource ? (first as () => unknown) : null;
    const fetcher = (hasSource ? second : first) as (key?: unknown) => Promise<T>;
    const home = owner;

    let data: T | undefined;
    let loading = false;
    // `null`, never `undefined`: callers test `error() !== null`, and an undefined sentinel
    // would make every one of those checks read as "failed".
    let error: unknown = null;
    let lastKey: string | undefined;
    let started = false;
    let generation = 0;

    const run = (key: unknown): void => {
        const mine = ++generation;
        fetcher(key).then(
            (value) => {
                // A superseded fetch must not overwrite a newer one's result: the key can
                // change twice before the first response lands.
                if (mine !== generation) {
                    return;
                }
                data = value;
                error = null;
                loading = false;
                home?.bump();
            },
            (reason: unknown) => {
                if (mine !== generation) {
                    return;
                }
                error = reason;
                loading = false;
                home?.bump();
            }
        );
    };

    /**
     * Starts (or restarts) the fetch when the key moved. Called from the reads, so a resource
     * nobody looks at never fetches. The flag flip is a plain assignment - safe during a
     * render - while the fetch itself is deferred to a microtask, so no store is ever
     * notified while React is rendering.
     */
    const ensure = (): void => {
        const resolved = source === null ? null : source();

        // Not ready. Keep whatever was loaded before and make sure nothing is left claiming
        // to be in flight - a gate that closes mid-fetch would otherwise spin forever.
        if (source !== null && (resolved === false || resolved === null || resolved === undefined)) {
            if (loading) {
                generation += 1;
                loading = false;
            }
            started = false;
            lastKey = undefined;
            return;
        }

        const key = source === null ? '' : JSON.stringify(resolved);
        if (started && key === lastKey) {
            return;
        }
        started = true;
        lastKey = key;
        loading = true;
        queueMicrotask(() => run(resolved));
    };

    return {
        data: () => {
            ensure();
            return data;
        },
        loading: () => {
            ensure();
            return loading;
        },
        error: () => {
            ensure();
            return error;
        },
        refetch: () => {
            const resolved = source === null ? null : source();
            if (source !== null && (resolved === false || resolved === null || resolved === undefined)) {
                return;
            }
            loading = true;
            queueMicrotask(() => run(resolved));
            home?.bump();
        }
    };
}

export interface StoreHook<T> {
    /** The hook form: subscribes the calling component to this store. */
    (): T;

    /**
     * The same API WITHOUT subscribing - for module scope, effects and anywhere outside a
     * render, where there is no component to re-render and the hook form would break the
     * rules of hooks.
     */
    peek(): T;
}

/**
 * Declares a store. The factory runs ONCE, lazily, on first use - which is what lets a store
 * read another store (`useCategories` reads `useLocale`) without an initialisation order.
 */
export function createStore<T>(factory: () => T): StoreHook<T> {
    let api: T | undefined;
    let version = 0;
    const listeners = new Set<() => void>();

    const home: Owner = {
        bump() {
            version += 1;
            for (const listener of [...listeners]) {
                listener();
            }
        }
    };

    const instance = (): T => {
        if (api === undefined) {
            const previous = owner;
            owner = home;
            try {
                api = factory();
            } finally {
                owner = previous;
            }
        }
        return api;
    };

    const subscribe = (listener: () => void): (() => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    };

    // A version counter, not the API object: the API is stable by design, so it can never tell
    // React that anything changed.
    const snapshot = (): number => version;

    /** Stores that read this one from inside their own factory; each links exactly once. */
    const readers = new Set<Owner>();

    const useStore = (): T => {
        const value = instance();

        // Called from inside ANOTHER store's factory - `useCategories` reads `useLocale`, and
        // `useAdmin` reads `useSession`. There is no component here to subscribe, and calling a
        // hook would register one conditionally, so the two stores are LINKED instead: a change
        // in this store also bumps the reader, which is what keeps a component that took only
        // the outer store re-rendering when the inner one moves.
        const reader = owner;
        if (reader !== null) {
            if (!readers.has(reader)) {
                readers.add(reader);
                listeners.add(() => reader.bump());
            }
            return value;
        }

        // The early return above is the whole point of this primitive: a store read from inside
        // another store's factory links the two instead of subscribing, and there is no component
        // in that path to subscribe for.
        // oxlint-disable-next-line react-hooks/rules-of-hooks
        useSyncExternalStore(subscribe, snapshot, snapshot);
        return value;
    };

    return Object.assign(useStore, { peek: instance });
}
