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

/** One outcome as the external venue prices it; `price` is its probability, 0..1. */
export interface DiscoveredOutcome {
    label: string;
    price: number;
}

/** The registry market a discovered one was matched to, with the score that matched it. */
export interface DiscoveredMatch {
    id: string;
    title: string;
    score: number;
}

/**
 * A live market on an external venue, and how it lines up with this registry. `match` is null
 * when nothing here looks like it - which is the whole point of the screen.
 */
export interface DiscoveredMarket {
    source: string;
    sourceId: string;
    question: string;
    url: string;
    image: string;

    /** The venue's rules text, verbatim. It seeds a draft's description; the admin owns the rest. */
    description: string;

    /** Where the venue says the answer comes from, or '' when the description already says. */
    resolutionSource: string;

    /** The registry category the venue's tags map onto, or '' when none of them does. */
    category: string;
    endsAt: string;
    volume: number;
    liquidity: number;
    outcomes: DiscoveredOutcome[];
    match: DiscoveredMatch | null;
}

export interface DiscoverPage {
    rows: DiscoveredMarket[];

    /** Rows returned after filtering. */
    total: number;

    /** How many of the WHOLE crawl have no counterpart here - the headline number. */
    missing: number;

    /** Size of the whole crawl, before filtering. */
    crawled: number;

    /** When the underlying crawl ran, so a stale cache is visible rather than implied. */
    fetchedAt: string;
}

export interface DiscoverQuery {
    search?: string;
    missingOnly?: boolean;
    limit?: number;
    refresh?: boolean;
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

// ----------------------------------------------------------------------------------------
// Referrals
//
// A referrer earns a share of the protocol fee that the trades of the people they brought in
// pay. Two tiers, no cap, no expiry: 10% of what a DIRECT referral's trades pay the treasury,
// 5% of what the people THEY referred pay.
//
// "Protocol fee" is exact rather than rhetorical. A trade's fee splits on-chain between the
// market's liquidity providers and the protocol, and only the protocol's half reaches the
// treasury (`FeeCollected`). That receipt is what the index records against the trade and
// what these rates apply to - paying out a share of the gross fee would be paying out of
// money the platform never received.
// ----------------------------------------------------------------------------------------

/** A direct referral's share: 10% of the protocol fee their trades pay. */
export const REFERRAL_DIRECT_RATE = 0.1;

/** An indirect referral's share - the people your referrals referred. */
export const REFERRAL_INDIRECT_RATE = 0.05;

export const REFERRAL_TIERS = ['direct', 'indirect'] as const;
export type ReferralTier = (typeof REFERRAL_TIERS)[number];

/** One of a referrer's named links. Codes are unique across the whole program. */
export interface ReferralCampaign {
    code: string;
    name: string;

    /** ISO timestamp. Absolute - unlike the numbers below, which honour the window. */
    createdAt: string;

    /** Sign-ups through this code inside the selected period. */
    signups: number;

    /** Protocol fees those sign-ups paid inside the period, and the share of them earned. */
    fees: number;
    earnings: number;
}

/** One person a referrer brought in, directly or through one of their referrals. */
export interface ReferredUser {
    address: string;
    tier: ReferralTier;

    /** ISO timestamp of the join. Absolute; the trading numbers honour the window. */
    joinedAt: string;

    /** The campaign code they arrived through - empty for an indirect referral. */
    campaign: string;
    trades: number;
    volume: number;
    fees: number;
    earned: number;

    /** ISO timestamp of their most recent trade in the window, or null if they did not trade. */
    lastTradeAt: string | null;
}

/** The headline numbers, computed twice: once for all time and once inside the period. */
export interface ReferralStats {
    earnings: number;
    directEarnings: number;
    indirectEarnings: number;

    /** People who joined through one of this address's own codes. */
    signups: number;

    /** People THEY brought in - the second tier. */
    indirectSignups: number;

    /** Referred people who traded at least once in the window. */
    activeTraders: number;

    /** What the referred traded in the window, and the protocol fees it produced. */
    volume: number;
    fees: number;
}

/** Who referred the caller, if anybody. First touch wins and it is never reassigned. */
export interface ReferralOrigin {
    address: string;
    code: string;
    joinedAt: string;
}

export interface ReferralDashboard {
    address: string;
    period: Period;

    /** All time. `window` is the same shape inside the selected period. */
    total: ReferralStats;
    window: ReferralStats;
    campaigns: ReferralCampaign[];
    referred: ReferredUser[];
    referrer: ReferralOrigin | null;
}

export interface ReferralQuery {
    address: string;
    period?: Period;
}

/** A code looked up before joining, so an invitation names who sent it. */
export interface ReferralInvite {
    code: string;
    name: string;
    owner: string;
}

/**
 * Creating a campaign. Signed by its owner: a campaign is an earning account, so the server
 * has to know the address asking for one controls it.
 */
export interface CampaignInput {
    name: string;
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

export function campaignMessage(name: string, issuedAt: string): string {
    return `Goman referrals: create campaign ${name} at ${issuedAt}`;
}

/**
 * Accepting an invitation. Also signed, and by the person being referred - without that,
 * anyone could post someone else's address against their own code and collect a share of a
 * stranger's fees. It is a deliberate act, so it asks for a deliberate signature.
 */
export interface JoinInput {
    code: string;
    address: string;

    /** ISO timestamp inside the signed message; the server rejects stale ones. */
    issuedAt: string;
    signature: string;
}

export function joinMessage(code: string, issuedAt: string): string {
    return `Goman referrals: join with code ${code} at ${issuedAt}`;
}
