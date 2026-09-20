// The one file that crosses into the server half - and it crosses with TYPES only, plus the
// value helpers in wire.ts, which imports nothing at all. No handler, store, validator or
// server dependency can reach the browser bundle through here.
//
// The call surface is INFERRED from the server's route declarations again: `createClient`
// reads the feature record's type, so a route whose payload changes breaks the build here
// rather than at runtime, and a method naming a path the server does not serve cannot be
// written at all. The 370 lines this file used to spend spelling that out by hand are gone.
//
// '/api' matches both the dev proxy (vite.config.ts) and the production mount (server/app.ts).

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

import { ApiError, createClient, readManifest, type Manifest } from '@azerothjs/http/api/shared';

import type { Api } from '../../server/src/app.ts';

/** Whether this module is running in a browser, which is what decides the transport below. */
const browser = typeof document !== 'undefined';

/**
 * The route table the client dispatches through. A server-rendered page embeds it, so the
 * common case is a synchronous read; a `render: 'client'` shell has nothing to read and fetches
 * it once at module load. On the server the manifest stays empty on purpose - the in-process
 * bridge stamped on the render's own request carries the registered one.
 */
const manifest: Manifest = !browser
    ? {}
    : (readManifest() ??
      (await fetch('/api/_manifest')
          .then((response) => response.json() as Promise<Manifest>)
          .catch(() => ({}))));

export { ApiError };

export const client = createClient<Api>(manifest, {
    baseUrl: '/api',
    // In the browser, `credentials` is explicit for the reason it always was: the admin session
    // cookie only rides along if asked for, and without it every console read answers 401 while
    // the page simply looks logged out.
    //
    // On the server there is deliberately NO transport. An explicit fetch wins over the
    // in-process bridge, and the bridge is the whole point: a loader reaches this app's own api
    // without a socket, at the page's own origin, carrying the visitor's identity.
    fetch: browser
        ? (request) => fetch(new Request(request, { credentials: 'same-origin' }))
        : undefined
});
