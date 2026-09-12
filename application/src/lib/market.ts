// Pure market predicates and lookups. DOM-free and store-free, so a card can ask
// `isBinary(market)` without pulling the markets resource (or api.ts's module graph) in.

import { CONTENT_LANGS, KNOWN_CATEGORIES, type KnownCategory, type Localized, type Market } from '../api.ts';

import type { IconName } from '../icons/registry.ts';

export const CATEGORY_ICON: Record<KnownCategory, IconName> = {
    politics: 'cat-politics',
    crypto: 'cat-crypto',
    sports: 'cat-sports',
    economy: 'cat-economy',
    tech: 'cat-tech',
    culture: 'cat-culture',
    science: 'cat-science',
    world: 'cat-world'
};

/** The icon for any category: curated ones keep theirs, admin-minted ones get the compass. */
export function categoryIcon(category: string): IconName {
    return (CATEGORY_ICON as Record<string, IconName>)[category] ?? 'compass';
}

/**
 * True when a string is an image reference this app can actually render. TWO shapes qualify:
 * an absolute `https://` URL, and a root-relative path from our OWN uploader, which is what
 * `POST /api/uploads` hands back (`/uploads/<sha>.<ext>`, served from the same origin).
 *
 * Admitting only the first is what made the create form's Next button go dead the instant an
 * admin uploaded a picture: the upload succeeded, the field filled in, and the step then
 * reported an invalid image for a file the server had just stored.
 */
export function isImageURI(value: string): boolean {
    const uri = value.trim();
    return /^https:\/\/\S+$/.test(uri) || /^\/uploads\/[\w.-]+$/.test(uri);
}

/** True when a category has a first-class i18n label (otherwise the raw name is shown). */
export function isKnownCategory(category: string): category is KnownCategory {
    return (KNOWN_CATEGORIES as readonly string[]).includes(category);
}

/**
 * A category ID as the registry accepts one: a lower-case slug.
 *
 * The ID is the identity - it rides on chain inside every market that carries it and can never
 * be renamed - and its NAME is a separate, per-language thing the registry holds. Minting
 * "ورزش" as an ID would make one language's word the identifier for all ten, and no reader of
 * the other nine would ever see anything else.
 */
export function isCategoryId(id: string): boolean {
    return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}

/**
 * True when a query matches ANY language a market's text was written in. Searching only the
 * English and Persian variants hid a market from the very reader it was translated for.
 */
export function matchesText(text: Localized, query: string): boolean {
    const needle = query.trim().toLowerCase();
    if (needle === '') {
        return true;
    }
    return CONTENT_LANGS.some((code) => (text[code] ?? '').toLowerCase().includes(needle));
}

/** The card's headline probability: a binary market's yes price, a race's leader price. */
export function leadPrice(market: Market): number {
    return market.outcomes.reduce((best, outcome) => Math.max(best, outcome.price), 0);
}

export function isBinary(market: Market): boolean {
    return market.outcomes.length === 1;
}

/**
 * True once a market can no longer be traded - closed and waiting for its answer, resolved,
 * or voided. The listing endpoint drops these from its default page, so a card that shows one
 * is a search result, a watchlist entry, or a market that ended while the page was open; all
 * three want the tag that says so.
 */
export function hasEnded(market: Market): boolean {
    return market.status === 'closed' || market.status === 'resolved' || market.status === 'voided';
}

/**
 * True while a market is deployed but waiting for its start time. Both halves are required: the
 * pause is what actually stops a bet, and the date is what lets the UI say why. A market paused
 * by an admin for some other reason carries no `startsAt` and is NOT this.
 *
 * @param now Milliseconds; injectable so a card can be rendered at a fixed instant in a test.
 */
export function isPending(market: Market, now: number = Date.now()): boolean {
    return market.status === 'paused' && market.startsAt !== null && Date.parse(market.startsAt) > now;
}
