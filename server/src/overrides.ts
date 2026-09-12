import type { Localized } from './schemas.ts';
import { isBinaryPair, parseLocalized, searchText } from './derive.ts';
import { localizedOf } from './wire.ts';

import type { IndexStore } from './chain/store.ts';

// Post-deploy corrections to a market's text.
//
// The contracts write `title`, `description`, `category`, `imageURI` and every `outcomeName`
// once inside `initialize` and expose no setter for any of them, so a market that shipped with
// a typo, a dead image or the wrong category carries it for its whole life. This module is the
// only answer available: the correction lives in the index, the chain keeps what the bettors
// committed to, and `market_overrides.origin_json` holds the displaced text so the console can
// show both and put the original back at any time.
//
// Everything here reaches the store through the narrow presentation setters, so an edit can
// never touch a status, a pool or a lock time however it is called.

/** One outcome's presentation - the wording, not which outcome it is. */
export interface OutcomeText {
    label: Localized;
    icon: string;
}

/** Everything about a market an admin can correct after it is deployed. */
export interface MarketText {
    title: Localized;
    emoji: string;
    rules: Localized;
    image: string;
    category: string;

    /** Index-ordered and always the market's full width; see {@link outcomeCountMismatch}. */
    outcomes: OutcomeText[];
}

/** The fields of a {@link MarketText} that differ from the chain's. Absent = not overridden. */
type MarketPatch = Partial<MarketText>;

/** What the index currently presents for a market, correction included. Null when unknown. */
export function textOf(store: IndexStore, marketId: number): MarketText | null {
    const row = store.marketById(marketId);
    if (row === null) {
        return null;
    }
    return {
        title: parseLocalized(row.title_json),
        emoji: row.emoji,
        rules: parseLocalized(row.rules_json),
        image: row.image,
        category: row.category,
        outcomes: store
            .outcomesOf(marketId)
            .map((outcome) => ({ label: parseLocalized(outcome.label_json), icon: outcome.icon }))
    };
}

/**
 * What the CHAIN still says. The snapshot an edit took, or - when nothing has ever displaced
 * it - what is stored, which is the chain's text by definition.
 */
export function chainTextOf(store: IndexStore, marketId: number): MarketText | null {
    const override = store.overrideOf(marketId);
    return override === null ? textOf(store, marketId) : parseText(override.origin_json);
}

/**
 * Records `next` as the market's presentation.
 *
 * Fields that match the chain drop out of the patch, so retyping the original text CLEARS the
 * correction rather than recording a no-op edit - which is what keeps the console's "edited"
 * badge meaning something. A patch that ends up empty removes the row entirely.
 *
 * The row is then rewritten from origin plus patch rather than from `next`, so every field the
 * admin did not change goes back to the chain's exactly, whatever the index happened to hold.
 */
export function saveText(
    store: IndexStore,
    marketId: number,
    next: MarketText,
    editor: string,
    at: number
): { edited: boolean } {
    const origin = chainTextOf(store, marketId);
    if (origin === null) {
        return { edited: false };
    }
    const patch = diff(origin, next);
    if (Object.keys(patch).length === 0) {
        revertText(store, marketId);
        return { edited: false };
    }
    store.putOverride({
        market_id: marketId,
        patch_json: JSON.stringify(patch),
        origin_json: JSON.stringify(origin),
        edited_by: editor.toLowerCase(),
        edited_at: at
    });
    write(store, marketId, { ...origin, ...patch });
    return { edited: true };
}

/** Puts the chain's own text back and forgets the correction. False when there was none. */
export function revertText(store: IndexStore, marketId: number): boolean {
    const override = store.overrideOf(marketId);
    if (override === null) {
        return false;
    }
    write(store, marketId, parseText(override.origin_json));
    store.deleteOverride(marketId);
    return true;
}

/**
 * Puts a stored correction back on top of a market the index has just replayed from the chain.
 *
 * Deliberately does NOT re-snapshot the origin: the chain's text cannot change, so the stored
 * snapshot is still right - and re-snapshotting here would record the correction itself as the
 * original the second time this ran, which is the one state nothing could recover from.
 */
export function reapply(store: IndexStore, marketId: number): void {
    const override = store.overrideOf(marketId);
    if (override === null) {
        return;
    }
    write(store, marketId, { ...parseText(override.origin_json), ...parsePatch(override.patch_json) });
}

/**
 * True when `next` would change whether the market reads as a plain Yes/No pair.
 *
 * The whole trading UI branches on that: a binary market shows ONE tradeable side with a
 * probability ring, a multi-outcome market shows a list. Renaming "Yes" to "Definitely" would
 * silently reshape a market people already hold positions in, so it is refused rather than
 * applied - the wording of a binary market's two legs is the one thing this cannot correct.
 */
export function reshapesBinary(current: MarketText, next: MarketText): boolean {
    return isBinaryPair(current.outcomes.map(labelOf)) !== isBinaryPair(next.outcomes.map(labelOf));
}

/** True when `next` does not carry exactly one entry per on-chain outcome. */
export function outcomeCountMismatch(current: MarketText, next: MarketText): boolean {
    return current.outcomes.length !== next.outcomes.length;
}

/** Normalises submitted text: empty translations dropped, surrounding whitespace gone. */
export function normalise(text: MarketText): MarketText {
    return {
        title: localizedOf(text.title),
        emoji: text.emoji.trim(),
        rules: localizedOf(text.rules),
        image: text.image.trim(),
        category: text.category.trim().toLowerCase(),
        outcomes: text.outcomes.map((outcome) => ({ label: localizedOf(outcome.label), icon: outcome.icon.trim() }))
    };
}

// ----------------------------------------------------------------------------------------
// Internals
// ----------------------------------------------------------------------------------------

function labelOf(outcome: OutcomeText): Localized {
    return outcome.label;
}

/** Writes a presentation into the index, search blob included. */
function write(store: IndexStore, marketId: number, text: MarketText): void {
    store.setMarketText(marketId, {
        title_json: JSON.stringify(text.title),
        emoji: text.emoji,
        rules_json: JSON.stringify(text.rules),
        image: text.image,
        category: text.category,
        // Recomputed rather than left alone: the haystack is what search runs against, so a
        // corrected title that is not folded back in is a market findable only by its typo.
        search_text: searchText(text.title, text.rules, text.category, text.outcomes.map(labelOf))
    });
    text.outcomes.forEach((outcome, idx) => {
        store.setOutcomeText(marketId, idx, JSON.stringify(outcome.label), outcome.icon);
    });
}

/** The fields of `next` that differ from `origin`, compared by value rather than identity. */
function diff(origin: MarketText, next: MarketText): MarketPatch {
    const patch: MarketPatch = {};
    if (!same(origin.title, next.title)) {
        patch.title = next.title;
    }
    if (origin.emoji !== next.emoji) {
        patch.emoji = next.emoji;
    }
    if (!same(origin.rules, next.rules)) {
        patch.rules = next.rules;
    }
    if (origin.image !== next.image) {
        patch.image = next.image;
    }
    if (origin.category !== next.category) {
        patch.category = next.category;
    }
    const outcomesDiffer = next.outcomes.some(
        (outcome, idx) =>
            outcome.icon !== origin.outcomes[idx]?.icon || !same(outcome.label, origin.outcomes[idx]?.label ?? {})
    );
    if (outcomesDiffer) {
        // All or nothing: outcomes are index-positional, and a sparse list would be one
        // renumbering away from putting a label on the wrong leg.
        patch.outcomes = next.outcomes;
    }
    return patch;
}

/** Two Localized values carrying the same translations, key order aside. */
function same(a: Partial<Localized>, b: Partial<Localized>): boolean {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
        if (a[key as 'en'] !== b[key as 'en']) {
            return false;
        }
    }
    return true;
}

/** A stored blob back into text. A corrupt one degrades to blanks rather than throwing a
 *  page, exactly as {@link parseLocalized} does for a single column. */
function parseText(raw: string): MarketText {
    const parsed = parsePatch(raw);
    return {
        title: parsed.title ?? { en: '' },
        emoji: parsed.emoji ?? '',
        rules: parsed.rules ?? { en: '' },
        image: parsed.image ?? '',
        category: parsed.category ?? '',
        outcomes: parsed.outcomes ?? []
    };
}

function parsePatch(raw: string): MarketPatch {
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null ? (parsed as MarketPatch) : {};
    } catch {
        return {};
    }
}
