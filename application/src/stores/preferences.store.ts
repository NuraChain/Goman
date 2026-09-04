// Reader preferences that change how numbers READ, not what they are. Today that is one
// setting: whether a probability is spelled as a price in cents (`34¢`) or as a percentage
// (`34%`).
//
// It exists because the setting already shipped in Settings and was written to storage by a
// dropdown that NOTHING read - so the app went on rendering the same probability both ways,
// sometimes on the same screen. A stored preference with no store behind it is a promise the
// UI cannot keep.

import { createStore, createSignal, type Getter } from '../lib/reactive.ts';

import { readSetting, writeSetting } from '../lib/storage.ts';

import type { OddsMode } from '../i18n/format.ts';

const STORAGE_KEY = 'goman.odds';
const LEGACY_STORAGE_KEY = 'auctionhouse.odds';

// Percentage is the default because that is what a probability IS; cents is the trader's
// spelling of the same number and stays one setting away.
function initialMode(): OddsMode {
    return (readSetting(STORAGE_KEY) ?? readSetting(LEGACY_STORAGE_KEY)) === 'price' ? 'price' : 'percent';
}

export interface PreferencesApi {
    /** How probabilities are spelled across the whole UI, reactively. */
    oddsMode: Getter<OddsMode>;

    setOddsMode(next: OddsMode): void;
}

export const usePreferences = createStore((): PreferencesApi => {
    const [oddsMode, setSignal] = createSignal<OddsMode>(initialMode());

    return {
        oddsMode,
        setOddsMode: (next) => {
            setSignal(next);
            writeSetting(STORAGE_KEY, next);
        }
    };
});
