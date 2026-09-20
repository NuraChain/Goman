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
    CategoryDeleteInput,
    CategoryInput,
    ChainConfig,
    FeatureInput,
    TelegramSettings,
    TelegramSettingsInput,
    MarketCreator,
    MarketCreatorInput,
    MarketCreatorRemoveInput,
    CreatorAccess,
    TelegramState,
    FeatureResult,
    HolderPage,
    JoinInput,
    LeaderboardQuery,
    LeaderboardRow,
    Market,
    MarketEditInput,
    MarketEditResult,
    MarketEditState,
    MarketPage,
    MarketRevertInput,
    MarketsQuery,
    PortfolioSummary,
    Position,
    ProfitSeries,
    ProfitSeriesQuery,
    Proposal,
    ProposalDecideInput,
    ProposalInput,
    ProposalResult,
    ReferralCampaign,
    ReferralDashboard,
    ReferralInvite,
    ReferralOrigin,
    ReferralQuery,
    ScheduleInput,
    Series,
    SeriesQuery,
    SessionInput,
    TagCount,
    TagsQuery
} from '../../server/src/wire.ts';

export {
    CONTENT_LANGS,
    KNOWN_CATEGORIES,
    MARKET_KINDS,
    MARKET_STATUSES,
    RANGES,
    PERIODS,
    SIDES,
    TAG_MODES,
    TAGS_PER_MARKET,
    TAG_MAX_LENGTH,
    normalizeTag,
    tagNameOf,
    slugify,
    marketSlug,
    marketPath,
    marketIdFromSlug,
    dedupeTags,
    tagSlugs,
    isRegistryCategory,
    encodeTitleMeta,
    encodeTextMeta,
    decodeTitleMeta,
    decodeOutcomeMeta,
    decodeTextMeta,
    localizedOf,
    featureMessage,
    marketEditMessage,
    marketRevertMessage,
    sessionMessage,
    categoryMessage,
    categoryDeleteMessage,
    uploadMessage,
    scheduleMessage,
    telegramSettingsMessage,
    creatorMessage,
    creatorRemoveMessage,
    proposalMessage,
    proposalDecideMessage,
    proposalTitle,
    PROPOSAL_STATES,
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
    Holder,
    TelegramSettings,
    MarketCreator,
    MarketCreatorInput,
    MarketCreatorRemoveInput,
    CreatorAccess,
    TelegramState,
    KnownCategory,
    LeaderboardRow,
    ContentLang,
    Localized,
    Market,
    MarketEditOutcome,
    MarketEditState,
    MarketKindName,
    MarketPage,
    MarketSort,
    MarketStatusName,
    Outcome,
    Period,
    PortfolioSummary,
    Position,
    ProfitSeries,
    Proposal,
    ProposalState,
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
    TagCount,
    TagMode,
    TagsQuery,
    MarketTag,
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

    creators: {
        /** Whether one wallet may open the create form. Public by necessity - the wallet
         *  asking is not an admin, and it is the only thing it is allowed to ask. */
        check: (options: { params: { address: string } }): Promise<CreatorAccess> =>
            request('GET', `/creators/${encodeURIComponent(options.params.address)}`)
    },

    proposals: {
        /** One wallet's own proposals and what became of them. Public by address, like the
         *  creator check above: a proposer holds no admin session to read them with. */
        mine: (options: { query: { address: string } }): Promise<Proposal[]> =>
            request('GET', '/proposals', { query: options.query }),

        submit: (options: { input: ProposalInput }): Promise<Proposal> =>
            request('POST', '/proposals', { input: options.input })
    },

    tags: {
        /** Tags completing a prefix, most-used first. No prefix lists the most-used ones,
         *  which is what an empty tag field offers before anyone types. */
        list: (options: { query?: TagsQuery } = {}): Promise<TagCount[]> =>
            request('GET', '/tags', { query: options.query as Record<string, QueryValue> })
    },

    categories: {
        list: (): Promise<CategoryCount[]> => request('GET', '/categories'),

        save: (options: { input: CategoryInput }): Promise<CategoryCount> =>
            request('POST', '/categories', { input: options.input }),

        remove: (options: { input: CategoryDeleteInput }): Promise<boolean> =>
            request('DELETE', '/categories', { input: options.input })
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

        feature: (options: { input: FeatureInput }): Promise<FeatureResult> =>
            request('POST', '/admin/feature', { input: options.input }),

        creators: (): Promise<MarketCreator[]> => request('GET', '/admin/creators'),

        addCreator: (options: { input: MarketCreatorInput }): Promise<MarketCreator[]> =>
            request('POST', '/admin/creators', { input: options.input }),

        removeCreator: (options: { input: MarketCreatorRemoveInput }): Promise<MarketCreator[]> =>
            request('POST', '/admin/creators/remove', { input: options.input }),

        /** The whole queue: waiting first, then what has been decided. */
        proposals: (): Promise<Proposal[]> => request('GET', '/admin/proposals'),

        decideProposal: (options: { input: ProposalDecideInput }): Promise<ProposalResult> =>
            request('POST', '/admin/proposals/decide', { input: options.input }),

        telegram: (): Promise<TelegramState> => request('GET', '/admin/telegram'),

        saveTelegram: (options: { input: TelegramSettingsInput }): Promise<TelegramSettings> =>
            request('POST', '/admin/telegram/settings', { input: options.input }),

        schedule: (options: { input: ScheduleInput }): Promise<{ ok: boolean }> =>
            request('POST', '/admin/schedule', { input: options.input }),

        /** A deployed market's editable text, alongside what the chain still holds. */
        marketEdit: (options: { params: { id: string } }): Promise<MarketEditState> =>
            request('GET', `/admin/markets/${options.params.id}/edit`),

        editMarket: (options: { input: MarketEditInput }): Promise<MarketEditResult> =>
            request('POST', '/admin/market', { input: options.input }),

        revertMarket: (options: { input: MarketRevertInput }): Promise<MarketEditResult> =>
            request('POST', '/admin/market/revert', { input: options.input })
    }
};
