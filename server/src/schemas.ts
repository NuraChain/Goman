// CLIENT-SAFE: the application imports this file, so it may import only the schema package.
// These shapes are the whole wire vocabulary - markets, prices, positions, the leaderboard -
// declared once for the server boundary, the manifest client, and the browser's types.
// Every value is REAL: the server derives it from chain state, never from seeded fiction.
import { array, boolean, enumOf, number, object, string, type Infer } from '@azerothjs/schema';

/**
 * The categories with first-class icons and i18n labels. A market may carry ANY category
 * string (admins mint categories freely); these are only the ones the UI decorates.
 */
export const KNOWN_CATEGORIES = ['politics', 'crypto', 'sports', 'economy', 'tech', 'culture', 'science', 'world'] as const;
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

/** Every human-readable string crosses the wire in both languages; the client picks. */
const localized = object({ en: string(), fa: string() });
export type Localized = Infer<typeof localized>;

// ----------------------------------------------------------------------------------------
// Metadata envelope
//
// On-chain markets store one plain string per field. Bilingual text and the emoji ride a
// small JSON envelope INSIDE those strings: `{"v":1,"en":...,"fa":...,"emoji":...}` for
// titles, `{"v":1,"en":...,"fa":...}` for descriptions. A plain (non-envelope) string
// stays valid everywhere and reads as the same text in both languages.
// ----------------------------------------------------------------------------------------

/** A decoded market title: both languages plus the card emoji. */
export interface TitleMeta
{
    en: string;
    fa: string;
    emoji: string;
}

/** Encodes a bilingual title + emoji into the on-chain string. */
export function encodeTitleMeta(meta: TitleMeta): string
{
    return JSON.stringify({ v: 1, en: meta.en, fa: meta.fa, emoji: meta.emoji });
}

/** Encodes bilingual body text (description/rules, an outcome name) into the on-chain string. */
export function encodeTextMeta(meta: Localized & { icon?: string }): string
{
    return JSON.stringify({ v: 1, en: meta.en, fa: meta.fa, ...(meta.icon === undefined || meta.icon === '' ? {} : { icon: meta.icon }) });
}

function parseEnvelope(raw: string): Record<string, unknown> | null
{
    if (!raw.startsWith('{'))
    {
        return null;
    }
    try
    {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null && (parsed as { v?: unknown }).v === 1
            ? parsed as Record<string, unknown>
            : null;
    }
    catch
    {
        return null;
    }
}

/** Decodes an on-chain title string; a plain string falls back to itself + `fallbackEmoji`. */
export function decodeTitleMeta(raw: string, fallbackEmoji: string): TitleMeta
{
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
export function decodeOutcomeMeta(raw: string): Localized & { icon: string }
{
    const envelope = parseEnvelope(raw);
    const label = decodeTextMeta(raw);
    return { ...label, icon: typeof envelope?.icon === 'string' ? envelope.icon : '' };
}

/** Decodes an on-chain body string (description/rules); plain strings mirror into both languages. */
export function decodeTextMeta(raw: string): Localized
{
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
export const outcome = object({
    id: string(),
    index: number({ int: true, min: 0 }),
    label: localized,

    /** Outcome art (a team badge, a candidate photo). Empty when the market carries none. */
    icon: string(),
    price: number({ min: 0, max: 1 }),
    change24h: number()
});
export type Outcome = Infer<typeof outcome>;

export const market = object({
    id: string(),
    address: string(),
    category: string(),
    emoji: string(),

    /** The market's own image URI, on-chain since deploy. Empty falls back to the emoji. */
    image: string(),
    title: localized,
    rules: localized,
    status: enumOf(MARKET_STATUSES),
    winningOutcomeId: string().nullable(),

    /** Engine: `amm` (CPMM shares, `buy`/`sell`) vs `pool` (parimutuel, `bet`/`claim`). */
    kind: enumOf(MARKET_KINDS),
    /** The NO leg's on-chain outcome index for binary markets; null for multi-outcome. */
    noIndex: number({ int: true, min: 0 }).nullable(),
    outcomes: array(outcome),
    volume: number({ min: 0 }),
    liquidity: number({ min: 0 }),
    endsAt: string(),
    createdAt: string(),
    featured: boolean(),
    trending: boolean()
});
export type Market = Infer<typeof market>;

export const marketsQuery = object({
    search: string().optional(),
    category: string().optional(),
    status: enumOf(MARKET_STATUSES).optional(),
    sort: enumOf(MARKET_SORTS).optional(),
    featured: boolean({ coerce: true }).optional(),
    trending: boolean({ coerce: true }).optional(),

    /** A market id to leave out (the related-markets rail excludes the page's own market). */
    exclude: string().optional(),

    /** Comma-separated market ids to restrict to (the client-side watchlist's server query). */
    ids: string().optional(),
    page: number({ coerce: true, int: true, min: 1 }).optional(),
    limit: number({ coerce: true, int: true, min: 1, max: 50 }).optional()
});
export type MarketsQuery = Infer<typeof marketsQuery>;

export const marketPage = object({
    rows: array(market),
    total: number({ int: true, min: 0 }),
    page: number({ int: true, min: 1 }),
    pages: number({ int: true, min: 1 })
});
export type MarketPage = Infer<typeof marketPage>;

/**
 * A category as the UI sees it. `id` is the immutable string markets carry on-chain; the label
 * and image are indexer-side PRESENTATION and are the only parts an admin can ever change.
 * `count` is 0 for a category registered before its first market exists.
 */
export const categoryCount = object({
    id: string(),
    count: number({ int: true, min: 0 }),
    labelEn: string(),
    labelFa: string(),
    image: string(),
    retired: boolean()
});
export type CategoryCount = Infer<typeof categoryCount>;

/** Category presentation edits, authenticated the same way the featured toggle is. */
export const categoryInput = object({
    id: string(),
    labelEn: string(),
    labelFa: string(),
    image: string(),
    sortOrder: number({ int: true }),
    retired: boolean(),
    address: string(),
    issuedAt: string(),
    signature: string()
});
export type CategoryInput = Infer<typeof categoryInput>;

export function categoryMessage(id: string, issuedAt: string): string
{
    return `AuctionHouse admin: update category ${ id } at ${ issuedAt }`;
}

/** An image upload's text fields; the bytes ride beside them as file parts. */
export const uploadFields = object({
    address: string(),
    issuedAt: string(),
    signature: string()
});

export const uploadResult = object({
    uri: string(),
    type: string(),
    bytes: number({ int: true, min: 1 })
});
export type UploadResult = Infer<typeof uploadResult>;

export function uploadMessage(issuedAt: string): string
{
    return `AuctionHouse admin: upload image at ${ issuedAt }`;
}

export const seriesQuery = object({ outcome: string(), range: enumOf(RANGES) });
export const seriesPoint = object({ t: number(), p: number({ min: 0, max: 1 }) });
export const series = object({ points: array(seriesPoint) });
export type SeriesPoint = Infer<typeof seriesPoint>;
export type Series = Infer<typeof series>;

export const activityItem = object({
    id: string(),
    marketId: string(),

    /** The trader's address; the client shortens and avatars it. */
    user: string(),
    action: enumOf(['buy', 'sell']),
    outcomeId: string(),
    side: enumOf(SIDES),
    shares: number({ min: 0 }),

    /**
     * The REALIZED fill price: collateral per share (`amount / shares`), not a probability.
     * It is deliberately unbounded above - the taker pays the trading fee on top, so a buy
     * settles slightly over 1 whenever the outcome was already near-certain. Bounding this at
     * 1 (as an outcome's probability correctly is) made the whole endpoint fail its own
     * contract the moment such a trade landed in the window.
     */
    price: number({ min: 0 }),
    at: string()
});
export type ActivityItem = Infer<typeof activityItem>;

/** The page window every paged list route accepts (activity, holders, the admin feed). */
export const activityQuery = object({
    page: number({ coerce: true, int: true, min: 1 }).optional(),
    limit: number({ coerce: true, int: true, min: 1, max: 50 }).optional()
});

export const activityPage = object({
    rows: array(activityItem),
    total: number({ int: true, min: 0 }),
    page: number({ int: true, min: 1 }),
    pages: number({ int: true, min: 1 })
});
export type ActivityPage = Infer<typeof activityPage>;

export const holder = object({
    user: string(),
    outcomeId: string(),
    side: enumOf(SIDES),
    shares: number({ min: 0 })
});
export type Holder = Infer<typeof holder>;

export const holderPage = object({
    rows: array(holder),
    total: number({ int: true, min: 0 }),
    page: number({ int: true, min: 1 }),
    pages: number({ int: true, min: 1 })
});
export type HolderPage = Infer<typeof holderPage>;

// ----------------------------------------------------------------------------------------
// Portfolio (all address-scoped: the wallet IS the account)
// ----------------------------------------------------------------------------------------

export const addressQuery = object({ address: string() });

export const position = object({
    id: string(),
    marketId: string(),
    outcomeId: string(),
    side: enumOf(SIDES),
    shares: number({ min: 0 }),
    /** Fee-inclusive VWAP cost per share - a fill price, so unbounded above like one. */
    avgPrice: number({ min: 0 }),
    openedAt: string(),

    /** True when the market resolved this way (or voided) and redeem() pays out. */
    claimable: boolean(),

    /** The market embedded, so the client never joins against a global list. */
    market
});
export type Position = Infer<typeof position>;

export const portfolioSummary = object({
    /** The wallet's native balance. */
    balance: number({ min: 0 }),
    invested: number({ min: 0 }),
    current: number({ min: 0 }),
    profit: number(),
    profitToday: number()
});
export type PortfolioSummary = Infer<typeof portfolioSummary>;

/** A P/L curve point: `p` is native-token value (signed), unlike the probability series. */
export const profitSeries = object({ points: array(object({ t: number(), p: number() })) });
export const profitSeriesQuery = object({ period: enumOf(PERIODS), address: string() });
export type ProfitSeries = Infer<typeof profitSeries>;

// ----------------------------------------------------------------------------------------
// Leaderboard
// ----------------------------------------------------------------------------------------

export const leaderboardQuery = object({ period: enumOf(PERIODS) });
export const leaderboardRow = object({
    rank: number({ int: true, min: 1 }),
    address: string(),
    profit: number(),
    volume: number({ min: 0 })
});
export type LeaderboardRow = Infer<typeof leaderboardRow>;

// ----------------------------------------------------------------------------------------
// Chain config + admin
// ----------------------------------------------------------------------------------------

/** What the frontend needs to talk to the chain; replaces every hardcoded address map. */
export const chainConfig = object({
    chainId: number({ int: true }),
    factory: string(),
    treasury: string(),
    deployBlock: number({ int: true, min: 0 }),

    /** The last block the indexer has ingested; clients wait on it after a write. */
    lastBlock: number({ int: true, min: 0 })
});
export type ChainConfig = Infer<typeof chainConfig>;

export const adminStats = object({
    markets: number({ int: true, min: 0 }),
    open: number({ int: true, min: 0 }),
    paused: number({ int: true, min: 0 }),
    closed: number({ int: true, min: 0 }),
    resolved: number({ int: true, min: 0 }),
    voided: number({ int: true, min: 0 }),
    volume: number({ min: 0 }),
    volume24h: number({ min: 0 }),
    traders: number({ int: true, min: 0 }),
    feesCollected: number({ min: 0 }),
    tvl: number({ min: 0 })
});
export type AdminStats = Infer<typeof adminStats>;

export const adminMarketRow = object({
    id: string(),
    address: string(),
    title: localized,
    emoji: string(),
    category: string(),
    status: enumOf(MARKET_STATUSES),
    winningOutcomeId: string().nullable(),
    outcomeCount: number({ int: true, min: 2 }),
    createdAt: string(),
    locksAt: string(),
    resolvesAt: string(),
    liquidity: number({ min: 0 }),
    volume: number({ min: 0 }),
    collected: number({ min: 0 }),
    featured: boolean()
});
export type AdminMarketRow = Infer<typeof adminMarketRow>;

export const adminMarketPage = object({
    rows: array(adminMarketRow),
    total: number({ int: true, min: 0 }),
    page: number({ int: true, min: 1 }),
    pages: number({ int: true, min: 1 })
});
export type AdminMarketPage = Infer<typeof adminMarketPage>;

/** The message a console signs to open an admin session; the timestamp makes it single-use. */
export function sessionMessage(issuedAt: string): string
{
    return `AuctionHouse admin: sign in at ${ issuedAt }`;
}

/**
 * Opening an admin session: the wallet signs `sessionMessage(issuedAt)` and the server
 * checks both the signature and the on-chain role before issuing the cookie. Reading the
 * console is a session-level act; the mutations below still demand a fresh signature.
 */
export const sessionInput = object({
    address: string(),

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string(),
    signature: string()
});
export type SessionInput = Infer<typeof sessionInput>;

/**
 * The featured-flag toggle, authenticated by wallet signature: the admin signs
 * `featureMessage(...)` and the server verifies both the signature and the on-chain role.
 */
export const featureInput = object({
    marketId: string(),
    featured: boolean(),
    address: string(),

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string(),
    signature: string()
});
export type FeatureInput = Infer<typeof featureInput>;

export const featureResult = object({ ok: boolean(), featured: boolean() });

/** The canonical message an admin signs to toggle a market's featured flag. */
export function featureMessage(marketId: string, featured: boolean, issuedAt: string): string
{
    return `AuctionHouse admin: set featured=${ featured ? 'true' : 'false' } for market ${ marketId } at ${ issuedAt }`;
}
