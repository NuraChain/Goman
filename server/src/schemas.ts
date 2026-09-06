// SERVER-ONLY: the runtime half of the wire vocabulary. TypeBox schemas are plain JSON Schema,
// which is what Fastify's Ajv validates and serialises with - so declaring a route's `query`,
// `body` and `response` here both checks the payload and types the handler.
//
// The shapes themselves live in wire.ts, which imports nothing and is what the browser reads.
// The `Assert<Equals<...>>` lines at the bottom of each section make a schema that drifts from
// its interface a COMPILE ERROR - the guarantee the framework's inferred client used to give.
import { Type, type Static, type TSchema, type TUnsafe } from 'typebox';

import {
    DISCOVER_TOPICS,
    MARKET_KINDS,
    MARKET_SORTS,
    MARKET_STATUSES,
    PERIODS,
    RANGES,
    SIDES,
    TRADE_ACTIONS,
    type ActivityItem,
    type ActivityPage,
    type ActivityQuery,
    type AddressQuery,
    type AdminMarketPage,
    type DiscoverPage,
    type DiscoverQuery,
    type AdminMarketRow,
    type AdminStats,
    type CategoryCount,
    type CategoryInput,
    type ChainConfig,
    type FeatureInput,
    type FeatureResult,
    type Holder,
    type HolderPage,
    type LeaderboardQuery,
    type LeaderboardRow,
    type Localized,
    type Market,
    type MarketPage,
    type MarketsQuery,
    type Outcome,
    type PortfolioSummary,
    type Position,
    type ProfitSeries,
    type ProfitSeriesQuery,
    type Series,
    type SeriesPoint,
    type SeriesQuery,
    type SessionInput,
    type UploadFields,
    type UploadResult,
    REFERRAL_TIERS,
    type CampaignInput,
    type JoinInput,
    type ReferralCampaign,
    type ReferralDashboard,
    type ReferralInvite,
    type ReferralOrigin,
    type ReferralQuery,
    type ReferralStats,
    type ReferredUser
} from './wire.ts';

// ----------------------------------------------------------------------------------------
// The drift guard
// ----------------------------------------------------------------------------------------

/** True only when A and B are the SAME type - optionality and nullability included. */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless its argument is `true`. Used once per schema, below each block. */
type Assert<T extends true> = T;

/**
 * A string union as a real JSON Schema `enum` rather than a 5-branch `anyOf`: Ajv reports
 * "must be one of" instead of five parallel failures, and the static type stays exact.
 */
function stringEnum<const T extends readonly string[]>(values: T): TUnsafe<T[number]> {
    return Type.Unsafe<T[number]>({ type: 'string', enum: [...values] });
}

/** A nullable field. `Type.Union([X, Type.Null()])` is the JSON Schema spelling of `X | null`. */
function nullable<T extends TSchema & { type: string }>(schema: T): TUnsafe<Static<T> | null> {
    // `{ type: ['string', 'null'] }` rather than an anyOf: Ajv and fast-json-stringify both
    // take the short spelling, and the serialiser picks a branch without probing.
    return Type.Unsafe<Static<T> | null>({ ...schema, type: [schema.type, 'null'] });
}

// ----------------------------------------------------------------------------------------
// Markets
// ----------------------------------------------------------------------------------------

// Written out rather than generated from CONTENT_LANGS: TypeBox infers `Static` from the
// literal, and a computed spread collapses it to an index signature, which defeats the
// `Assert<Equals<...>>` below - the one thing keeping this schema and `Localized` in step.
// `en` is the required floor; the rest are optional because a market carries only the
// translations someone actually wrote.
export const localized = Type.Object({
    en: Type.String(),
    fa: Type.Optional(Type.String()),
    ar: Type.Optional(Type.String()),
    es: Type.Optional(Type.String()),
    pt: Type.Optional(Type.String()),
    hi: Type.Optional(Type.String()),
    zh: Type.Optional(Type.String()),
    ru: Type.Optional(Type.String()),
    fr: Type.Optional(Type.String()),
    tr: Type.Optional(Type.String())
});

export const outcome = Type.Object({
    id: Type.String(),
    index: Type.Integer({ minimum: 0 }),
    label: localized,
    icon: Type.String(),
    price: Type.Number({ minimum: 0, maximum: 1 }),
    change24h: Type.Number()
});

export const market = Type.Object({
    id: Type.String(),
    address: Type.String(),
    category: Type.String(),
    emoji: Type.String(),
    image: Type.String(),
    title: localized,
    rules: localized,
    status: stringEnum(MARKET_STATUSES),
    winningOutcomeId: nullable(Type.String()),
    kind: stringEnum(MARKET_KINDS),
    noIndex: nullable(Type.Integer({ minimum: 0 })),
    outcomes: Type.Array(outcome),
    volume: Type.Number({ minimum: 0 }),
    liquidity: Type.Number({ minimum: 0 }),
    endsAt: Type.String(),
    createdAt: Type.String(),
    featured: Type.Boolean(),
    trending: Type.Boolean()
});

export const marketsQuery = Type.Object({
    search: Type.Optional(Type.String()),
    category: Type.Optional(Type.String()),
    status: Type.Optional(stringEnum(MARKET_STATUSES)),
    sort: Type.Optional(stringEnum(MARKET_SORTS)),
    featured: Type.Optional(Type.Boolean()),
    trending: Type.Optional(Type.Boolean()),
    exclude: Type.Optional(Type.String()),
    ids: Type.Optional(Type.String()),
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
});

export const marketPage = Type.Object({
    rows: Type.Array(market),
    total: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 1 }),
    pages: Type.Integer({ minimum: 1 })
});

export const marketParams = Type.Object({ id: Type.String() });

type _Localized = Assert<Equals<Static<typeof localized>, Localized>>;
type _Outcome = Assert<Equals<Static<typeof outcome>, Outcome>>;
type _Market = Assert<Equals<Static<typeof market>, Market>>;
type _MarketsQuery = Assert<Equals<Static<typeof marketsQuery>, MarketsQuery>>;
type _MarketPage = Assert<Equals<Static<typeof marketPage>, MarketPage>>;

// ----------------------------------------------------------------------------------------
// Categories and uploads
// ----------------------------------------------------------------------------------------

export const categoryCount = Type.Object({
    id: Type.String(),
    count: Type.Integer({ minimum: 0 }),
    labelEn: Type.String(),
    labelFa: Type.String(),
    image: Type.String(),
    retired: Type.Boolean()
});

export const categoryInput = Type.Object({
    id: Type.String(),
    labelEn: Type.String(),
    labelFa: Type.String(),
    image: Type.String(),
    sortOrder: Type.Integer(),
    retired: Type.Boolean(),
    address: Type.String(),
    issuedAt: Type.String(),
    signature: Type.String()
});

export const uploadFields = Type.Object({
    address: Type.String(),
    issuedAt: Type.String(),
    signature: Type.String()
});

export const uploadResult = Type.Object({
    uri: Type.String(),
    type: Type.String(),
    bytes: Type.Integer({ minimum: 1 })
});

type _CategoryCount = Assert<Equals<Static<typeof categoryCount>, CategoryCount>>;
type _CategoryInput = Assert<Equals<Static<typeof categoryInput>, CategoryInput>>;
type _UploadFields = Assert<Equals<Static<typeof uploadFields>, UploadFields>>;
type _UploadResult = Assert<Equals<Static<typeof uploadResult>, UploadResult>>;

// ----------------------------------------------------------------------------------------
// Series, activity, holders
// ----------------------------------------------------------------------------------------

export const seriesQuery = Type.Object({ outcome: Type.String(), range: stringEnum(RANGES) });
export const seriesPoint = Type.Object({ t: Type.Number(), p: Type.Number({ minimum: 0, maximum: 1 }) });
export const series = Type.Object({ points: Type.Array(seriesPoint) });

export const activityItem = Type.Object({
    id: Type.String(),
    marketId: Type.String(),
    user: Type.String(),
    action: stringEnum(TRADE_ACTIONS),
    outcomeId: Type.String(),
    side: stringEnum(SIDES),
    shares: Type.Number({ minimum: 0 }),
    price: Type.Number({ minimum: 0 }),
    at: Type.String()
});

export const activityQuery = Type.Object({
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 }))
});

export const activityPage = Type.Object({
    rows: Type.Array(activityItem),
    total: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 1 }),
    pages: Type.Integer({ minimum: 1 })
});

export const holder = Type.Object({
    user: Type.String(),
    outcomeId: Type.String(),
    side: stringEnum(SIDES),
    shares: Type.Number({ minimum: 0 })
});

export const holderPage = Type.Object({
    rows: Type.Array(holder),
    total: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 1 }),
    pages: Type.Integer({ minimum: 1 })
});

type _SeriesQuery = Assert<Equals<Static<typeof seriesQuery>, SeriesQuery>>;
type _SeriesPoint = Assert<Equals<Static<typeof seriesPoint>, SeriesPoint>>;
type _Series = Assert<Equals<Static<typeof series>, Series>>;
type _ActivityItem = Assert<Equals<Static<typeof activityItem>, ActivityItem>>;
type _ActivityQuery = Assert<Equals<Static<typeof activityQuery>, ActivityQuery>>;
type _ActivityPage = Assert<Equals<Static<typeof activityPage>, ActivityPage>>;
type _Holder = Assert<Equals<Static<typeof holder>, Holder>>;
type _HolderPage = Assert<Equals<Static<typeof holderPage>, HolderPage>>;

// ----------------------------------------------------------------------------------------
// Portfolio and leaderboard
// ----------------------------------------------------------------------------------------

export const addressQuery = Type.Object({ address: Type.String() });

export const position = Type.Object({
    id: Type.String(),
    marketId: Type.String(),
    outcomeId: Type.String(),
    side: stringEnum(SIDES),
    shares: Type.Number({ minimum: 0 }),
    avgPrice: Type.Number({ minimum: 0 }),
    openedAt: Type.String(),
    claimable: Type.Boolean(),
    market
});

export const portfolioSummary = Type.Object({
    balance: Type.Number({ minimum: 0 }),
    invested: Type.Number({ minimum: 0 }),
    current: Type.Number({ minimum: 0 }),
    profit: Type.Number(),
    profitToday: Type.Number()
});

export const profitSeries = Type.Object({ points: Type.Array(Type.Object({ t: Type.Number(), p: Type.Number() })) });
export const profitSeriesQuery = Type.Object({ period: stringEnum(PERIODS), address: Type.String() });

export const leaderboardQuery = Type.Object({ period: stringEnum(PERIODS) });
export const leaderboardRow = Type.Object({
    rank: Type.Integer({ minimum: 1 }),
    address: Type.String(),
    profit: Type.Number(),
    volume: Type.Number({ minimum: 0 })
});

type _AddressQuery = Assert<Equals<Static<typeof addressQuery>, AddressQuery>>;
type _Position = Assert<Equals<Static<typeof position>, Position>>;
type _PortfolioSummary = Assert<Equals<Static<typeof portfolioSummary>, PortfolioSummary>>;
type _ProfitSeries = Assert<Equals<Static<typeof profitSeries>, ProfitSeries>>;
type _ProfitSeriesQuery = Assert<Equals<Static<typeof profitSeriesQuery>, ProfitSeriesQuery>>;
type _LeaderboardQuery = Assert<Equals<Static<typeof leaderboardQuery>, LeaderboardQuery>>;
type _LeaderboardRow = Assert<Equals<Static<typeof leaderboardRow>, LeaderboardRow>>;

// ----------------------------------------------------------------------------------------
// Chain config and admin
// ----------------------------------------------------------------------------------------

export const chainConfig = Type.Object({
    chainId: Type.Integer(),
    factory: Type.String(),
    treasury: Type.String(),
    deployBlock: Type.Integer({ minimum: 0 }),
    lastBlock: Type.Integer({ minimum: 0 })
});

export const adminStats = Type.Object({
    markets: Type.Integer({ minimum: 0 }),
    open: Type.Integer({ minimum: 0 }),
    paused: Type.Integer({ minimum: 0 }),
    closed: Type.Integer({ minimum: 0 }),
    resolved: Type.Integer({ minimum: 0 }),
    voided: Type.Integer({ minimum: 0 }),
    volume: Type.Number({ minimum: 0 }),
    volume24h: Type.Number({ minimum: 0 }),
    traders: Type.Integer({ minimum: 0 }),
    feesCollected: Type.Number({ minimum: 0 }),
    tvl: Type.Number({ minimum: 0 })
});

export const adminMarketRow = Type.Object({
    id: Type.String(),
    address: Type.String(),
    title: localized,
    emoji: Type.String(),
    category: Type.String(),
    status: stringEnum(MARKET_STATUSES),
    winningOutcomeId: nullable(Type.String()),
    outcomeCount: Type.Integer({ minimum: 2 }),
    createdAt: Type.String(),
    locksAt: Type.String(),
    resolvesAt: Type.String(),
    liquidity: Type.Number({ minimum: 0 }),
    volume: Type.Number({ minimum: 0 }),
    collected: Type.Number({ minimum: 0 }),
    featured: Type.Boolean()
});

export const adminMarketPage = Type.Object({
    rows: Type.Array(adminMarketRow),
    total: Type.Integer({ minimum: 0 }),
    page: Type.Integer({ minimum: 1 }),
    pages: Type.Integer({ minimum: 1 })
});

export const discoverQuery = Type.Object({
    search: Type.Optional(Type.String({ maxLength: 120 })),
    missingOnly: Type.Optional(Type.Boolean()),
    topic: Type.Optional(stringEnum(DISCOVER_TOPICS)),
    page: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
    refresh: Type.Optional(Type.Boolean())
});

export const discoveredOutcome = Type.Object({ label: Type.String(), price: Type.Number() });

export const discoveredMatch = Type.Object({
    id: Type.String(),
    title: Type.String(),
    score: Type.Number()
});

export const discoveredMarket = Type.Object({
    source: Type.String(),
    sourceId: Type.String(),
    question: Type.String(),
    url: Type.String(),
    image: Type.String(),
    description: Type.String(),
    resolutionSource: Type.String(),
    category: Type.String(),
    endsAt: Type.String(),
    volume: Type.Number(),
    liquidity: Type.Number(),
    outcomes: Type.Array(discoveredOutcome),
    match: Type.Union([discoveredMatch, Type.Null()])
});

export const discoverPage = Type.Object({
    rows: Type.Array(discoveredMarket),
    total: Type.Integer(),
    page: Type.Integer(),
    pages: Type.Integer(),
    missing: Type.Integer(),
    crawled: Type.Integer(),
    fetchedAt: Type.String()
});

export const sessionInput = Type.Object({
    address: Type.String(),
    issuedAt: Type.String(),
    signature: Type.String()
});

export const featureInput = Type.Object({
    marketId: Type.String(),
    featured: Type.Boolean(),
    address: Type.String(),
    issuedAt: Type.String(),
    signature: Type.String()
});

export const featureResult = Type.Object({ ok: Type.Boolean(), featured: Type.Boolean() });

type _ChainConfig = Assert<Equals<Static<typeof chainConfig>, ChainConfig>>;
type _AdminStats = Assert<Equals<Static<typeof adminStats>, AdminStats>>;
type _AdminMarketRow = Assert<Equals<Static<typeof adminMarketRow>, AdminMarketRow>>;
type _AdminMarketPage = Assert<Equals<Static<typeof adminMarketPage>, AdminMarketPage>>;
type _DiscoverPage = Assert<Equals<Static<typeof discoverPage>, DiscoverPage>>;
type _DiscoverQuery = Assert<Equals<Static<typeof discoverQuery>, DiscoverQuery>>;
type _SessionInput = Assert<Equals<Static<typeof sessionInput>, SessionInput>>;
type _FeatureInput = Assert<Equals<Static<typeof featureInput>, FeatureInput>>;
type _FeatureResult = Assert<Equals<Static<typeof featureResult>, FeatureResult>>;

// ----------------------------------------------------------------------------------------
// Referrals
// ----------------------------------------------------------------------------------------

export const referralQuery = Type.Object({
    address: Type.String(),
    period: Type.Optional(stringEnum(PERIODS))
});

export const referralStats = Type.Object({
    earnings: Type.Number(),
    directEarnings: Type.Number(),
    indirectEarnings: Type.Number(),
    signups: Type.Integer({ minimum: 0 }),
    indirectSignups: Type.Integer({ minimum: 0 }),
    activeTraders: Type.Integer({ minimum: 0 }),
    volume: Type.Number({ minimum: 0 }),
    fees: Type.Number({ minimum: 0 })
});

export const referralCampaign = Type.Object({
    code: Type.String(),
    name: Type.String(),
    createdAt: Type.String(),
    signups: Type.Integer({ minimum: 0 }),
    fees: Type.Number({ minimum: 0 }),
    earnings: Type.Number({ minimum: 0 })
});

export const referredUser = Type.Object({
    address: Type.String(),
    tier: stringEnum(REFERRAL_TIERS),
    joinedAt: Type.String(),
    campaign: Type.String(),
    trades: Type.Integer({ minimum: 0 }),
    volume: Type.Number({ minimum: 0 }),
    fees: Type.Number({ minimum: 0 }),
    earned: Type.Number({ minimum: 0 }),
    lastTradeAt: nullable(Type.String())
});

export const referralOrigin = Type.Object({
    address: Type.String(),
    code: Type.String(),
    joinedAt: Type.String()
});

export const referralDashboard = Type.Object({
    address: Type.String(),
    period: stringEnum(PERIODS),
    total: referralStats,
    window: referralStats,
    campaigns: Type.Array(referralCampaign),
    referred: Type.Array(referredUser),
    referrer: Type.Union([referralOrigin, Type.Null()])
});

export const referralInvite = Type.Object({
    code: Type.String(),
    name: Type.String(),
    owner: Type.String()
});

export const campaignInput = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 40 }),
    address: Type.String(),
    issuedAt: Type.String(),
    signature: Type.String()
});

export const joinInput = Type.Object({
    code: Type.String({ minLength: 1, maxLength: 32 }),
    address: Type.String(),
    issuedAt: Type.String(),
    signature: Type.String()
});

type _ReferralQuery = Assert<Equals<Static<typeof referralQuery>, ReferralQuery>>;
type _ReferralStats = Assert<Equals<Static<typeof referralStats>, ReferralStats>>;
type _ReferralCampaign = Assert<Equals<Static<typeof referralCampaign>, ReferralCampaign>>;
type _ReferredUser = Assert<Equals<Static<typeof referredUser>, ReferredUser>>;
type _ReferralOrigin = Assert<Equals<Static<typeof referralOrigin>, ReferralOrigin>>;
type _ReferralDashboard = Assert<Equals<Static<typeof referralDashboard>, ReferralDashboard>>;
type _ReferralInvite = Assert<Equals<Static<typeof referralInvite>, ReferralInvite>>;
type _CampaignInput = Assert<Equals<Static<typeof campaignInput>, CampaignInput>>;
type _JoinInput = Assert<Equals<Static<typeof joinInput>, JoinInput>>;

// Re-exported so the rest of the server imports one module, as it did before the split.
export * from './wire.ts';
