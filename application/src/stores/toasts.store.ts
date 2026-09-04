// The app's one notification channel. Components push; the <Toasts /> host renders and
// times out. Kept as a store so a toast can be fired from anywhere - a card, a sheet, a
// settings row - without threading callbacks.

import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

import type { IconName } from '../icons/registry.ts';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastEntry {
    id: number;
    tone: ToastTone;
    message: string;
    icon?: IconName;
}

export interface ToastsApi {
    items: Getter<ToastEntry[]>;
    push(tone: ToastTone, message: string, icon?: IconName): number;
    dismiss(id: number): void;
}

export const useToasts = createStore((): ToastsApi => {
    const [items, setItems] = createSignal<ToastEntry[]>([]);
    let nextToastId = 1;

    return {
        items,
        push: (tone, message, icon) => {
            const id = nextToastId++;
            setItems((current) => [...current.slice(-2), { id, tone, message, icon }]);
            return id;
        },
        dismiss: (id) => setItems((current) => current.filter((entry) => entry.id !== id))
    };
});
