// The one file that crosses into the server half - and it crosses with TYPES only, plus the
// value helpers in wire.ts, which imports nothing at all. No handler, store, validator or
// server dependency can reach the browser bundle through here.
//
// The framework used to INFER this surface from the server's route declarations. It is now
// written out, one method per route, and the drift guard moved to where the shapes are
// defined: server/src/schemas.ts asserts every TypeBox schema against its wire.ts interface at
// compile time, so a route whose payload changes still breaks the build rather than the app.
// A method here that names a path the server does not serve is caught by the API tests.
//
// '/api' matches both the dev proxy (vite.config.ts) and the production mount (server/app.ts).
import type {
    ActivityItem,
    ActivityPage,
    ActivityQuery,
    AdminMarketPage,
    AdminStats,
    CampaignInput,
    CategoryCount,
    CategoryInput,
    ChainConfig,
    DiscoverPage,
    DiscoverQuery,
    FeatureInput,
    FeatureResult,
    HolderPage,
    JoinInput,
    LeaderboardQuery,
    LeaderboardRow,
    Market,
    MarketPage,
    MarketsQuery,
    PortfolioSummary,
    Position,
    ProfitSeries,
    ProfitSeriesQuery,
    ReferralCampaign,
    ReferralDashboard,
    ReferralInvite,
    ReferralOrigin,
    ReferralQuery,
    Series,
    SeriesQuery,
    SessionInput
} from '../../server/src/wire.ts';

export {
    DISCOVER_TOPICS,
    KNOWN_CATEGORIES,
    MARKET_STATUSES,
    RANGES,
    PERIODS,
    SIDES,
    encodeTitleMeta,
    encodeTextMeta,
    decodeTitleMeta,
    decodeOutcomeMeta,
    decodeTextMeta,
    featureMessage,
    sessionMessage,
    categoryMessage,
    uploadMessage,
    campaignMessage,
    joinMessage,
    REFERRAL_DIRECT_RATE,
    REFERRAL_INDIRECT_RATE
} from '../../server/src/wire.ts';

export type {
    ActivityItem,
    ActivityPage,
    AdminMarketPage,
    AdminMarketRow,
    AdminStats,
    CategoryCount,
    ChainConfig,
    DiscoveredMarket,
    DiscoveredMatch,
    DiscoveredOutcome,
    DiscoverPage,
    DiscoverTopic,
    Holder,
    KnownCategory,
    LeaderboardRow,
    Localized,
    Market,
    MarketPage,
    MarketSort,
    MarketStatusName,
    Outcome,
    Period,
    PortfolioSummary,
    Position,
    ProfitSeries,
    Range,
    ReferralCampaign,
    ReferralDashboard,
    ReferralInvite,
    ReferralOrigin,
    ReferralStats,
    ReferredUser,
    Series,
    SeriesPoint,
    Side,
    TitleMeta
} from '../../server/src/wire.ts';

const BASE = '/api';

/** A non-2xx answer. `status` is what the server said; `message` is its `error` field. */
export class ApiError extends Error {
    public readonly status: number;

    constructor(status: number, message: string) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

type QueryValue = string | number | boolean | undefined;

/** Drops undefined rather than sending `?limit=undefined`; the server's defaults then apply. */
function queryString(query: Record<string, QueryValue> | undefined): string {
    if (query === undefined) {
        return '';
    }
    const parts = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
            parts.append(key, String(value));
        }
    }
    const encoded = parts.toString();
    return encoded === '' ? '' : `?${encoded}`;
}

async function request<T>(
    method: string,
    path: string,
    options: { query?: Record<string, QueryValue>; input?: unknown } = {}
): Promise<T> {
    const response = await fetch(`${BASE}${path}${queryString(options.query)}`, {
        method,
        // Same origin in production, and the dev proxy keeps it same-origin too - but the
        // admin session cookie only rides along if credentials are asked for explicitly.
        credentials: 'same-origin',
        ...(options.input === undefined
            ? {}
            : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.input) })
    });

    if (!response.ok) {
        // The server's error shape is `{ error: string }`; anything else (a proxy's HTML
        // error page, say) must still produce a readable message rather than a parse crash.
        const detail = await response.json().then(
            (body: unknown) =>
                typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
                    ? (body as { error: string }).error
                    : response.statusText,
            () => response.statusText
        );
        throw new ApiError(response.status, detail);
    }

    if (response.status === 204) {
        return undefined as T;
    }
    return (await response.json()) as T;
}

export const client = {
    markets: {
        list: (options: { query?: MarketsQuery }): Promise<MarketPage> =>
            request('GET', '/markets', { query: options.query as Record<string, QueryValue> }),

        one: (options: { params: { id: string } }): Promise<Market> =>
            request('GET', `/markets/${encodeURIComponent(options.params.id)}`),

        series: (options: { params: { id: string }; query: SeriesQuery }): Promise<Series> =>
            request('GET', `/markets/${encodeURIComponent(options.params.id)}/series`, {
                query: options.query as unknown as Record<string, QueryValue>
            }),

        activity: (options: { params: { id: string }; query?: ActivityQuery }): Promise<ActivityPage> =>
            request('GET', `/markets/${encodeURIComponent(options.params.id)}/activity`, {
                query: options.query as Record<string, QueryValue>
            }),

        holders: (options: { params: { id: string }; query?: ActivityQuery }): Promise<HolderPage> =>
            request('GET', `/markets/${encodeURIComponent(options.params.id)}/holders`, {
                query: options.query as Record<string, QueryValue>
            })
    },

    categories: {
        list: (): Promise<CategoryCount[]> => request('GET', '/categories'),

        save: (options: { input: CategoryInput }): Promise<CategoryCount> =>
            request('POST', '/categories', { input: options.input })
    },

    chain: {
        config: (): Promise<ChainConfig> => request('GET', '/chain')
    },

    portfolio: {
        summary: (options: { query: { address: string } }): Promise<PortfolioSummary> =>
            request('GET', '/portfolio', { query: options.query }),

        positions: (options: { query: { address: string } }): Promise<Position[]> =>
            request('GET', '/portfolio/positions', { query: options.query }),

        series: (options: { query: ProfitSeriesQuery }): Promise<ProfitSeries> =>
            request('GET', '/portfolio/series', { query: options.query as unknown as Record<string, QueryValue> }),

        activity: (options: { query: { address: string } }): Promise<ActivityItem[]> =>
            request('GET', '/portfolio/activity', { query: options.query })
    },

    leaderboard: {
        list: (options: { query: LeaderboardQuery }): Promise<LeaderboardRow[]> =>
            request('GET', '/leaderboard', { query: options.query as unknown as Record<string, QueryValue> })
    },

    referrals: {
        dashboard: (options: { query: ReferralQuery }): Promise<ReferralDashboard> =>
            request('GET', '/referrals', { query: options.query as unknown as Record<string, QueryValue> }),

        invite: (options: { params: { code: string } }): Promise<ReferralInvite> =>
            request('GET', `/referrals/invite/${encodeURIComponent(options.params.code)}`),

        createCampaign: (options: { input: CampaignInput }): Promise<ReferralCampaign> =>
            request('POST', '/referrals/campaigns', { input: options.input }),

        join: (options: { input: JoinInput }): Promise<ReferralOrigin> =>
            request('POST', '/referrals/join', { input: options.input })
    },

    admin: {
        signIn: (options: { input: SessionInput }): Promise<void> =>
            request('POST', '/admin/session', { input: options.input }),

        signOut: (): Promise<void> => request('DELETE', '/admin/session'),

        stats: (): Promise<AdminStats> => request('GET', '/admin/stats'),

        activity: (options: { query?: ActivityQuery }): Promise<ActivityPage> =>
            request('GET', '/admin/activity', { query: options.query as Record<string, QueryValue> }),

        markets: (options: { query?: MarketsQuery }): Promise<AdminMarketPage> =>
            request('GET', '/admin/markets', { query: options.query as Record<string, QueryValue> }),

        discover: (options: { query?: DiscoverQuery }): Promise<DiscoverPage> =>
            request('GET', '/admin/discover', { query: options.query as Record<string, QueryValue> }),

        feature: (options: { input: FeatureInput }): Promise<FeatureResult> =>
            request('POST', '/admin/feature', { input: options.input })
    }
};
