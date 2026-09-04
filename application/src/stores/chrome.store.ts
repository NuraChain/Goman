// Which chrome overlay is open. One store, one owner: Sheet enforces one surface visually,
// this enforces it in state - opening any overlay closes the others by construction.

import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

type Overlay = 'none' | 'auth' | 'menu';

export interface ChromeApi {
    authOpen: Getter<boolean>;
    menuOpen: Getter<boolean>;
    openAuth(): void;
    openMenu(): void;
    close(): void;
}

export const useChrome = createStore((): ChromeApi => {
    const [overlay, setOverlay] = createSignal<Overlay>('none');

    return {
        authOpen: () => overlay() === 'auth',
        menuOpen: () => overlay() === 'menu',
        openAuth: () => setOverlay('auth'),
        openMenu: () => setOverlay('menu'),
        close: () => setOverlay('none')
    };
});
