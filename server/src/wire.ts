// THE wire vocabulary: every shape that crosses between the server and the browser, plus the
// on-chain metadata codec both halves share. CLIENT-SAFE BY CONSTRUCTION - this module imports
// nothing at all, so the application can import it without dragging a validator, a server
// dependency, or a byte of Node into the browser bundle.
//
// Runtime validation lives next door in schemas.ts (TypeBox, server-only). That file asserts at
// compile time that each schema's inferred type equals the interface declared here, so the two
// cannot drift - the property the framework's inferred client used to give for free.
//
// Every value is REAL: the server derives it from chain state, never from seeded fiction.

/**
 * The categories with first-class icons and i18n labels. A market may carry ANY category
 * string (admins mint categories freely); these are only the ones the UI decorates.
 */
export const KNOWN_CATEGORIES = [
    'politics',
    'crypto',
    'sports',
    'economy',
    'tech',
    'culture',
    'science',
    'world'
] as const;
export type KnownCategory = (typeof KNOWN_CATEGORIES)[number];

/** Lifecycle on the wire; the contract's MarketStatus enum in lowercase. */
export const MARKET_STATUSES = ['open', 'paused', 'closed', 'resolved', 'voided'] as const;
export type MarketStatusName = (typeof MARKET_STATUSES)[number];

export const MARKET_KINDS = ['amm', 'pool'] as const;
export type MarketKindName = (typeof MARKET_KINDS)[number];

export const MARKET_SORTS = ['volume', 'newest', 'ending'] as const;
export type MarketSort = (typeof MARKET_SORTS)[number];

export const RANGES = ['1d', '1w', '1m', 'all'] as const;
export type Range = (typeof RANGES)[number];

export const PERIODS = ['day', 'week', 'month', 'all'] as const;
export type Period = (typeof PERIODS)[number];

export const SIDES = ['yes', 'no'] as const;
export type Side = (typeof SIDES)[number];

export const TRADE_ACTIONS = ['buy', 'sell'] as const;
export type TradeAction = (typeof TRADE_ACTIONS)[number];

/** Every human-readable string crosses the wire in both languages; the client picks. */
export interface Localized {
    en: string;
    fa: string;
}

// ----------------------------------------------------------------------------------------
// Metadata envelope
//
// On-chain markets store one plain string per field. Bilingual text and the emoji ride a
// small JSON envelope INSIDE those strings: `{"v":1,"en":...,"fa":...,"emoji":...}` for
// titles, `{"v":1,"en":...,"fa":...}` for descriptions. A plain (non-envelope) string
// stays valid everywhere and reads as the same text in both languages.
// ----------------------------------------------------------------------------------------

/** A decoded market title: both languages plus the card emoji. */
export interface TitleMeta {
    en: string;
    fa: string;
    emoji: string;
}

/** Encodes a bilingual title + emoji into the on-chain string. */
export function encodeTitleMeta(meta: TitleMeta): string {
    return JSON.stringify({ v: 1, en: meta.en, fa: meta.fa, emoji: meta.emoji });
}

/** Encodes bilingual body text (description/rules, an outcome name) into the on-chain string. */
export function encodeTextMeta(meta: Localized & { icon?: string }): string {
    return JSON.stringify({
        v: 1,
        en: meta.en,
        fa: meta.fa,
        ...(meta.icon === undefined || meta.icon === '' ? {} : { icon: meta.icon })
    });
}

function parseEnvelope(raw: string): Record<string, unknown> | null {
    if (!raw.startsWith('{')) {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && (parsed as { v?: unknown }).v === 1
            ? (parsed as Record<string, unknown>)
            : null;
    } catch {
        return null;
    }
}

/** Decodes an on-chain title string; a plain string falls back to itself + `fallbackEmoji`. */
export function decodeTitleMeta(raw: string, fallbackEmoji: string): TitleMeta {
    const envelope = parseEnvelope(raw);
    const en = typeof envelope?.en === 'string' ? envelope.en : raw;
    const fa = typeof envelope?.fa === 'string' && envelope.fa !== '' ? envelope.fa : en;
    const emoji = typeof envelope?.emoji === 'string' && envelope.emoji !== '' ? envelope.emoji : fallbackEmoji;
    return { en, fa, emoji };
}

/**
 * An outcome's decoded name. `icon` rides the SAME envelope the labels do, so outcome art
 * needed no contract change: an older market simply carries no icon key.
 */
export function decodeOutcomeMeta(raw: string): Localized & { icon: string } {
    const envelope = parseEnvelope(raw);
    const label = decodeTextMeta(raw);
    return { ...label, icon: typeof envelope?.icon === 'string' ? envelope.icon : '' };
}

/** Decodes an on-chain body string (description/rules); plain strings mirror into both languages. */
export function decodeTextMeta(raw: string): Localized {
    const envelope = parseEnvelope(raw);
    const en = typeof envelope?.en === 'string' ? envelope.en : raw;
    const fa = typeof envelope?.fa === 'string' && envelope.fa !== '' ? envelope.fa : en;
    return { en, fa };
}

// ----------------------------------------------------------------------------------------
// Markets
// ----------------------------------------------------------------------------------------

/**
 * One tradable outcome. A binary market has a single outcome ('yes' at `price`); a
 * multi-outcome market lists one row per candidate. `price` IS the probability (0..1);
 * `change24h` is the day's move in probability points, signed. `index` is the outcome's
 * on-chain index - what `buy()` takes.
 */
export interface Outcome {
    id: string;
    index: number;
    label: Localized;

    /** Outcome art (a team badge, a candidate photo). Empty when the market carries none. */
    icon: string;
    price: number;
    change24h: number;
}

export interface Market {
    id: string;
    address: string;
    category: string;
    emoji: string;

    /** The market's own image URI, on-chain since deploy. Empty falls back to the emoji. */
    image: string;
    title: Localized;
    rules: Localized;
    status: MarketStatusName;
    winningOutcomeId: string | null;

    /** Engine: `amm` (CPMM shares, `buy`/`sell`) vs `pool` (parimutuel, `bet`/`claim`). */
    kind: MarketKindName;

    /** The NO leg's on-chain outcome index for binary markets; null for multi-outcome. */
    noIndex: number | null;
    outcomes: Outcome[];
    volume: number;
    liquidity: number;
    endsAt: string;
    createdAt: string;
    featured: boolean;
    trending: boolean;
}

export interface MarketsQuery {
    search?: string;
    category?: string;
    status?: MarketStatusName;
    sort?: MarketSort;
    featured?: boolean;
    trending?: boolean;

    /** A market id to leave out (the related-markets rail excludes the page's own market). */
    exclude?: string;

    /** Comma-separated market ids to restrict to (the client-side watchlist's server query). */
    ids?: string;
    page?: number;
    limit?: number;
}

export interface MarketPage {
    rows: Market[];
    total: number;
    page: number;
    pages: number;
}

/**
 * A category as the UI sees it. `id` is the immutable string markets carry on-chain; the label
 * and image are indexer-side PRESENTATION and are the only parts an admin can ever change.
 * `count` is 0 for a category registered before its first market exists.
 */
export interface CategoryCount {
    id: string;
    count: number;
    labelEn: string;
    labelFa: string;
    image: string;
    retired: boolean;
}

/** Category presentation edits, authenticated the same way the featured toggle is. */
export interface CategoryInput {
    id: string;
    labelEn: string;
    labelFa: string;
    image: string;
    sortOrder: number;
    retired: boolean;
    address: string;
    issuedAt: string;
    signature: string;
}

export function categoryMessage(id: string, issuedAt: string): string {
    return `Goman admin: update category ${id} at ${issuedAt}`;
}

/** An image upload's text fields; the bytes ride beside them as file parts. */
export interface UploadFields {
    address: string;
    issuedAt: string;
    signature: string;
}

export interface UploadResult {
    uri: string;
    type: string;
    bytes: number;
}

export function uploadMessage(issuedAt: string): string {
    return `Goman admin: upload image at ${issuedAt}`;
}

export interface SeriesQuery {
    outcome: string;
    range: Range;
}

export interface SeriesPoint {
    t: number;
    p: number;
}

export interface Series {
    points: SeriesPoint[];
}

export interface ActivityItem {
    id: string;
    marketId: string;

    /** The trader's address; the client shortens and avatars it. */
    user: string;
    action: TradeAction;
    outcomeId: string;
    side: Side;
    shares: number;

    /**
     * The REALIZED fill price: collateral per share (`amount / shares`), not a probability.
     * It is deliberately unbounded above - the taker pays the trading fee on top, so a buy
     * settles slightly over 1 whenever the outcome was already near-certain. Bounding this at
     * 1 (as an outcome's probability correctly is) made the whole endpoint fail its own
     * contract the moment such a trade landed in the window.
     */
    price: number;
    at: string;
}

/** The page window every paged list route accepts (activity, holders, the admin feed). */
export interface ActivityQuery {
    page?: number;
    limit?: number;
}

export interface ActivityPage {
    rows: ActivityItem[];
    total: number;
    page: number;
    pages: number;
}

export interface Holder {
    user: string;
    outcomeId: string;
    side: Side;
    shares: number;
}

export interface HolderPage {
    rows: Holder[];
    total: number;
    page: number;
    pages: number;
}

// ----------------------------------------------------------------------------------------
// Portfolio (all address-scoped: the wallet IS the account)
// ----------------------------------------------------------------------------------------

export interface AddressQuery {
    address: string;
}

export interface Position {
    id: string;
    marketId: string;
    outcomeId: string;
    side: Side;
    shares: number;

    /** Fee-inclusive VWAP cost per share - a fill price, so unbounded above like one. */
    avgPrice: number;
    openedAt: string;

    /** True when the market resolved this way (or voided) and redeem() pays out. */
    claimable: boolean;

    /** The market embedded, so the client never joins against a global list. */
    market: Market;
}

export interface PortfolioSummary {
    /** The wallet's native balance. */
    balance: number;
    invested: number;
    current: number;
    profit: number;
    profitToday: number;
}

/** A P/L curve point: `p` is native-token value (signed), unlike the probability series. */
export interface ProfitPoint {
    t: number;
    p: number;
}

export interface ProfitSeries {
    points: ProfitPoint[];
}

export interface ProfitSeriesQuery {
    period: Period;
    address: string;
}

// ----------------------------------------------------------------------------------------
// Leaderboard
// ----------------------------------------------------------------------------------------

export interface LeaderboardQuery {
    period: Period;
}

export interface LeaderboardRow {
    rank: number;
    address: string;
    profit: number;
    volume: number;
}

// ----------------------------------------------------------------------------------------
// Chain config + admin
// ----------------------------------------------------------------------------------------

/** What the frontend needs to talk to the chain; replaces every hardcoded address map. */
export interface ChainConfig {
    chainId: number;
    factory: string;
    treasury: string;
    deployBlock: number;

    /** The last block the indexer has ingested; clients wait on it after a write. */
    lastBlock: number;
}

export interface AdminStats {
    markets: number;
    open: number;
    paused: number;
    closed: number;
    resolved: number;
    voided: number;
    volume: number;
    volume24h: number;
    traders: number;
    feesCollected: number;
    tvl: number;
}

export interface AdminMarketRow {
    id: string;
    address: string;
    title: Localized;
    emoji: string;
    category: string;
    status: MarketStatusName;
    winningOutcomeId: string | null;
    outcomeCount: number;
    createdAt: string;
    locksAt: string;
    resolvesAt: string;
    liquidity: number;
    volume: number;
    collected: number;
    featured: boolean;
}

export interface AdminMarketPage {
    rows: AdminMarketRow[];
    total: number;
    page: number;
    pages: number;
}

/** The message a console signs to open an admin session; the timestamp makes it single-use. */
export function sessionMessage(issuedAt: string): string {
    return `Goman admin: sign in at ${issuedAt}`;
}

/**
 * Opening an admin session: the wallet signs `sessionMessage(issuedAt)` and the server
 * checks both the signature and the on-chain role before issuing the cookie. Reading the
 * console is a session-level act; the mutations below still demand a fresh signature.
 */
export interface SessionInput {
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

/**
 * The featured-flag toggle, authenticated by wallet signature: the admin signs
 * `featureMessage(...)` and the server verifies both the signature and the on-chain role.
 */
export interface FeatureInput {
    marketId: string;
    featured: boolean;
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

export interface FeatureResult {
    ok: boolean;
    featured: boolean;
}

/** The canonical message an admin signs to toggle a market's featured flag. */
export function featureMessage(marketId: string, featured: boolean, issuedAt: string): string {
    return `Goman admin: set featured=${featured ? 'true' : 'false'} for market ${marketId} at ${issuedAt}`;
}
