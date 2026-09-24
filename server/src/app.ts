import { resolve } from 'node:path';

import {
    App,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    TooManyRequestsError,
    UnauthorizedError,
    ValidationError,
    clientIp,
    json,
    logRequests,
    parseCookies,
    readMultipart,
    securityHeaders
} from '@azerothjs/http';
import { staticFiles } from '@azerothjs/http/node';
import { mountPages, type PageRoute } from '@azerothjs/kit';
import type { PageRenderer } from '@azerothjs/kit/ssr';
import { feature, guard, manifestOf, register } from '@azerothjs/http/api';
import { array, boolean, string } from '@azerothjs/schema';
import { verifyMessage, type Address } from 'viem';

import { type AdminSession, type SessionRequest } from './admin-session.ts';
import { readTelegramSettings, writeTelegramSettings } from './settings.ts';
import {
    CAMPAIGN_LIMIT,
    CHAIN_DEPTH,
    compose,
    pickCode,
    shareOf,
    type JoinRow,
    type TradeRollup
} from './referrals.ts';
import type { Logger } from '@azerothjs/logger';

import {
    activityItem,
    activityPage,
    activityQuery,
    addressQuery,
    CONTENT_LANGS,
    campaignInput,
    campaignMessage,
    joinInput,
    joinMessage,
    referralCampaign,
    referralDashboard,
    referralInvite,
    referralOrigin,
    referralQuery,
    adminMarketPage,
    adminStats,
    marketCreator,
    marketCreatorInput,
    marketCreatorRemoveInput,
    creatorAccess,
    proposal,
    proposalInput,
    proposalDecideInput,
    proposalResult,
    proposalsQuery,
    proposalMessage,
    proposalDecideMessage,
    proposalTitle,
    PROPOSAL_STATES,
    telegramSettings,
    telegramSettingsInput,
    telegramState,
    categoryCount,
    categoryDeleteInput,
    categoryDeleteMessage,
    localizedOf,
    categoryInput,
    categoryMessage,
    chainConfig,
    featureInput,
    featureMessage,
    featureResult,
    marketEditInput,
    marketEditMessage,
    marketEditResult,
    marketEditState,
    marketRevertInput,
    marketRevertMessage,
    holderPage,
    leaderboardQuery,
    leaderboardRow,
    market,
    marketPage,
    marketsQuery,
    portfolioSummary,
    position,
    profitSeries,
    profitSeriesQuery,
    sessionInput,
    sessionMessage,
    series,
    seriesQuery,
    normalizeTag,
    tagCount,
    tagsQuery,
    uploadMessage,
    creatorMessage,
    creatorRemoveMessage,
    telegramSettingsMessage,
    type AdminMarketRow,
    type Localized,
    type MarketCreator,
    type Proposal,
    type ProposalState,
    type TelegramState,
    type Market,
    type MarketsQuery,
    type MarketTag,
    marketPath,
    type Position
} from './wire.ts';
import {
    bucketSeries,
    isBinaryPair,
    leaderboard,
    parseLocalized,
    periodStart,
    presentHolder,
    presentMarket,
    presentSide,
    presentTrade,
    profitCurve,
    rangeStart,
    sampleTimes,
    statusFilter,
    statusName,
    vwap
} from './derive.ts';

import {
    chainTextOf,
    normalise,
    outcomeCountMismatch,
    reshapesBinary,
    revertText,
    saveText,
    textOf,
    type MarketText
} from './overrides.ts';

import { storeImage, MAX_IMAGE_BYTES, type Uploader } from './uploads.ts';

import type { ChainGateway } from './chain/client.ts';
import { CHAIN_STATUS, type IndexStore, type MarketRow, type ProposalRow } from './chain/store.ts';

// The whole API, declared once: routes, schemas, handlers, colocated. Each route's TypeBox
// schema both VALIDATES the request (Ajv) and SERIALISES the response (fast-json-stringify),
// so a handler that returns the wrong shape is caught at the boundary rather than shipped.
// Handlers read the sqlite index the chain watcher maintains - NOTHING here is seeded data.
//
// The browser's matching call surface is application/src/api.ts. Both halves are typed from
// server/src/wire.ts, and schemas.ts asserts each schema against its interface, so the two
// cannot drift without a compile error.

const DAY = 86_400;
const TRENDING_LIMIT = 9;
const DEFAULT_LIMIT = 12;

/** How long a signed admin action stays acceptable. */
const SIGNATURE_WINDOW_MS = 5 * 60_000;

/** How long a positive on-chain role check is trusted before re-reading. */
const ROLE_CACHE_MS = 60_000;

export interface ApiDeps {
    store: IndexStore;
    chain: ChainGateway;
    treasury: Address;

    /** Where uploaded image bytes land. Omit to refuse uploads rather than pretend. */
    uploader?: Uploader;

    /**
     * Guards every /admin route. Omit ONLY in tests that assert the open surface;
     * production wires it in main.ts, so a route added to the admin scope is protected
     * because of the scope it lands in, not because someone remembered.
     */
    adminSession?: AdminSession;
}

export interface AppOptions extends ApiDeps {
    dev: boolean;

    /** Request/response lines. Omit in tests - a silent app makes a readable failure. */
    log?: Logger;

    /** Where uploaded images live on disk, served read-only at /uploads. */
    uploadDir?: string;

    siteUrl?: string;

    /**
     * The App to register on. Omit it and one is built from `dev` and `log`, which is what
     * production and every test do; the dev session supplies its own, because vite's seam and
     * the pages have to share it.
     */
    app?: App;

    /**
     * The client, its route table and its server renderer. Omit in dev, where the session
     * renders from source, and in tests, where the api is the whole subject.
     */
    pages?: {
        clientDir: string;
        routes: PageRoute[];
        renderPage: PageRenderer;
    };

    /**
     * Security headers and a request ceiling. Both OFF by default so a test drives a bare
     * app - the old pipeline wrapped these around the app in main.ts for the same reason.
     */
    hardened?: boolean;

    /**
     * The running bot, when there is one. The console's Telegram tab reads and writes settings
     * through this, so a change takes effect on the live service rather than at the next
     * restart. Absent means no bot is configured: the settings still SAVE - an operator should
     * be able to prepare them before adding a token - they simply reach nothing yet.
     */
    telegram?: {
        configure(settings: { backupMinutes: number; events: boolean }): void;
        botName(): string;

        /** Tells one proposer what was decided. Best effort - a verdict is recorded whether or
         *  not the chat can be reached. */
        notify(chatId: string, text: string): Promise<boolean>;
    };
}

// return type IS the contract `Api` is read from; annotating it would be the
// hand-written client this migration deletes, spelled a second time.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function buildApp(options: AppOptions)
{
    const { store, chain, treasury, uploader, adminSession } = options;

    // `dev` decides whether a 5xx message crosses to the caller; 4xx messages always do.
    //
    // An App may be supplied instead of made: the dev session owns one so that vite's seam and
    // the page mount sit on the same instance. Every other caller - production, and all 193
    // tests - takes the one built here.
    const app =
        options.app ??
        new App({
            dev: options.dev,
            observe: options.log === undefined ? undefined : logRequests(options.log)
        });

    // ------------------------------------------------------------------------------------
    // Domain helpers - the read models every route shares.
    // ------------------------------------------------------------------------------------

    const nowSeconds = (): number => Math.floor(Date.now() / 1000);

    let trendingCache: { ids: Set<number>; at: number } = { ids: new Set(), at: 0 };
    const trendingIds = (): Set<number> =>
    {
        if (Date.now() - trendingCache.at > 15_000)
        {
            trendingCache = { ids: new Set(store.trendingIds(nowSeconds() - DAY, TRENDING_LIMIT)), at: Date.now() };
        }
        return trendingCache.ids;
    };

    const change24hOf =
        (marketId: number, prices: Map<number, number>): ((idx: number) => number) =>
            (idx) =>
            {
                const current = prices.get(idx) ?? 0;
                const then = store.priceAt(marketId, idx, nowSeconds() - DAY);
                return then === null ? 0 : current - then;
            };

    /** `tags` is passed in by a LIST, which reads every row's tags in one query; a single
     *  market reads its own. Without that seam a page of twelve markets would be twelve
     *  extra round trips for a row of chips. */
    const present = (row: MarketRow, tags?: readonly MarketTag[]): Market =>
    {
        const outcomes = store.outcomesOf(row.id);
        const prices = new Map(outcomes.map((outcome) => [outcome.idx, outcome.price]));
        return presentMarket(row, outcomes, {
            trending: trendingIds().has(row.id),
            change24h: change24hOf(row.id, prices),
            tags: tags ?? store.tagsOf(row.id)
        });
    };

    /** A whole page of markets presented, with their tags fetched in ONE query. */
    const presentAll = (rows: readonly MarketRow[]): Market[] =>
    {
        const tags = store.tagsOfMarkets(rows.map((row) => row.id));
        return rows.map((row) => present(row, tags.get(row.id) ?? []));
    };

    /** The Telegram tab's whole read. Shared by the tab's GET and by its settings write,
     *  which returns the new state so the console does not re-fetch to see its own change. */
    const telegramStateOf = (): TelegramState => ({
        settings: readTelegramSettings(store),
        configured: options.telegram !== undefined,
        botName: options.telegram?.botName() ?? ''
    });

    /** The allowlist as the console reads it. */
    const creatorsOf = (): MarketCreator[] =>
        store.marketCreators().map((row) => ({
            address: row.address,
            label: row.label,
            addedBy: row.added_by,
            addedAt: new Date(row.added_at).toISOString()
        }));

    /** A stored proposal as either side reads it. The state column is TEXT, so a value the app
     *  does not know is read as pending rather than handed on - a hand-edited database must
     *  not be able to put an unrenderable row in the console's queue. */
    const presentProposal = (row: ProposalRow): Proposal => ({
        id: row.id,
        draft: row.draft,
        proposer: row.proposer,
        state: (PROPOSAL_STATES as readonly string[]).includes(row.state) ? (row.state as ProposalState) : 'pending',
        note: row.note,
        createdAt: new Date(row.created_at).toISOString(),
        decidedAt: row.decided_at === 0 ? '' : new Date(row.decided_at).toISOString(),
        decidedBy: row.decided_by
    });

    const requireMarket = (id: string): MarketRow =>
    {
        const row = store.marketById(Number(id));
        if (row === null)
        {
            throw new NotFoundError(`No market ${ id }`);
        }
        return row;
    };

    const pageOf = (
        query: MarketsQuery,
        options: { includeEnded?: boolean } = {}
    ): { rows: MarketRow[]; total: number; page: number; pages: number } =>
    {
        const limit = query.limit ?? DEFAULT_LIMIT;
        const page = query.page ?? 1;
        const listed = query.ids?.split(',').map(Number).filter(Number.isInteger);
        const ids = query.trending === true ? [...trendingIds()] : listed;

        // A market whose trading is over stops being a LISTING. It is still a page, still
        // searchable, still in a watchlist - it just no longer sits between the markets
        // somebody can actually trade, where its dead price and passed date read as live.
        //
        // Callers opt out when they asked for those rows by name: a search (the reader typed
        // the title), an explicit status filter, a query by id (the watchlist and the trending
        // set), and the admin console, whose whole job is the markets nobody else sees.
        const searching = (query.search ?? '').trim() !== '';
        // Slugs, not words: `?tags=Iran Football` and `?tags=iran-football` are the same
        // filter, because the normaliser is the only thing that ever names a tag.
        const tags = (query.tags ?? '')
            .split(',')
            .map(normalizeTag)
            .filter((slug) => slug !== '');
        const filter = {
            search: query.search,
            tags,
            tagMode: query.tagMode ?? 'any',
            category: query.category,
            ...(query.status === undefined ? {} : statusFilter(query.status)),
            featured: query.featured,
            exclude: query.exclude === undefined ? undefined : Number(query.exclude),
            ids,
            liveOnly:
                options.includeEnded !== true &&
                query.status === undefined &&
                !searching &&
                tags.length === 0 &&
                ids === undefined,
            sort: query.sort ?? 'volume',
            page,
            limit
        } as const;
        if (filter.ids !== undefined && filter.ids.length === 0)
        {
            return { rows: [], total: 0, page: 1, pages: 1 };
        }
        const { rows, total } = store.listMarkets(filter);
        return {
            rows,
            total,
            page: Math.min(page, Math.max(1, Math.ceil(total / limit))),
            pages: Math.max(1, Math.ceil(total / limit))
        };
    };

    /** Ids of the markets this account has redeemed, by whatever route it did so. */
    const claimedMarketsOf = (address: string): string[] =>
        [...new Set(store.claimsOfAccount(address, 0).map((claim) => String(claim.market_id)))];

    /** Positions for one account, embedding their markets - the portfolio's whole read. */
    const positionsOf = (address: string): Position[] =>
    {
        const basis = new Map(
            store.buyBasis(address).map((row) => [`${ row.market_id }/${ row.outcome_idx }`, vwap(row.amount, row.shares)])
        );
        // A cancelled market's redeem zeroes the deposit but keeps the shares, so status alone went on
        // offering a claim that could only revert. A resolved redeem burns the winning shares,
        // so any still held there are unclaimed by construction - even ones sent in after.
        const claimed = new Set(claimedMarketsOf(address));
        return store.positionsOf(address).flatMap((balance) =>
        {
            const row = store.marketById(balance.market_id);
            if (row === null)
            {
                return [];
            }
            const outcomes = store.outcomesOf(row.id);
            const idx = Number(balance.token_id);
            const binary = row.outcome_count === 2 && isBinaryPair(outcomes.map((o) => parseLocalized(o.label_json)));
            const { outcomeId, side } = presentSide(binary, outcomes, idx);
            const claimable =
                (row.status === CHAIN_STATUS.resolved && row.winning_outcome === idx) ||
                (row.status === CHAIN_STATUS.cancelled && !claimed.has(String(row.id)));
            return [
                {
                    id: `${ balance.account }-${ row.id }-${ idx }`,
                    marketId: String(row.id),
                    outcomeId,
                    side,
                    shares: balance.shares,
                    avgPrice: basis.get(`${ row.id }/${ idx }`) ?? outcomes[idx]?.price ?? 0,
                    openedAt: new Date(balance.first_at * 1000).toISOString(),
                    claimable,
                    market: present(row)
                }
            ];
        });
    };

    const roleCache = new Map<string, { ok: boolean; at: number }>();
    const requireAdmin = async (address: string): Promise<void> =>
    {
        const key = address.toLowerCase();
        const cached = roleCache.get(key);
        if (cached !== undefined && Date.now() - cached.at < ROLE_CACHE_MS && cached.ok)
        {
            return;
        }
        const ok = await chain.hasAdminRole(address as Address);
        roleCache.set(key, { ok, at: Date.now() });
        if (!ok)
        {
            throw new ForbiddenError('Not a factory admin');
        }
    };

    /**
     * Proves the caller controls the address, and nothing more. Split out from
     * {@link requireSigned} because the referral routes need exactly this half: a referral is
     * an ordinary visitor's action, so demanding the admin role would be demanding the wrong
     * credential, but taking the address on the caller's word would let anyone attach a
     * stranger's wallet to their own campaign.
     */
    const verifySigned = async (params: {
        address: string;
        issuedAt: string;
        signature: string;
        message: string;
    }): Promise<void> =>
    {
        const issued = Date.parse(params.issuedAt);
        if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > SIGNATURE_WINDOW_MS)
        {
            throw new BadRequestError('Stale signature');
        }
        // viem throws on a malformed address, which would surface as a 500 for what is
        // plainly a bad request.
        if (!/^0x[0-9a-fA-F]{40}$/.test(params.address))
        {
            throw new BadRequestError('Not an address');
        }
        const valid = await verifyMessage({
            address: params.address as Address,
            message: params.message,
            signature: params.signature as `0x${ string }`
        });
        if (!valid)
        {
            throw new ForbiddenError('Bad signature');
        }
    };

    const requireSigned = async (params: {
        address: string;
        issuedAt: string;
        signature: string;
        message: string;
    }): Promise<void> =>
    {
        await verifySigned(params);
        await requireAdmin(params.address);
    };

    /**
     * The admin gate. It reads nothing but the cookie and the peer address, which is exactly
     * what makes it expressible as a guard - the signed-message helpers above cannot be, since
     * a guard runs before input validation and never sees the parsed input it would check.
     *
     * `clientIp` is called WITHOUT trustProxy on purpose: a forwarding header is
     * attacker-controlled, and honouring one would let a single machine reset its own lockout
     * counter. The rate limiter in main.ts trusts the proxy; this deliberately does not.
     */
    const sessionRequestOf = (request: Request): SessionRequest => ({
        ip: clientIp(request) ?? 'unknown',
        cookies: parseCookies(request)
    });

    const requireAdminSession = guard((context) =>
    {
        if (adminSession === undefined)
        {
            throw new UnauthorizedError('Admin session required');
        }
        return { admin: adminSession.require(sessionRequestOf(context.request)) };
    });

    // ------------------------------------------------------------------------------------
    // Middleware
    //
    // The error vocabulary is the framework's now: an HttpError subclass answers at its own
    // status, a schema failure answers 422 carrying `details.fields`, and a 5xx keeps its
    // detail in the log unless `dev` says otherwise. The hand-written error handler that used
    // to sit here existed to make Ajv answer 422 instead of its default 400; that IS the
    // default here, so 400 goes back to meaning only what it always meant - the handler's own
    // BadRequestError.
    // ------------------------------------------------------------------------------------

    if (options.hardened === true)
    {
        // Defaults only, and the defaults are already this app's position: HSTS and CSP are
        // both OFF unless asked for. TLS terminates at nginx, the only hop that knows the
        // scheme the browser used, and a second Strict-Transport-Security would let header
        // ORDER decide the policy in force (RFC 6797). The CSP is off because this process
        // also serves the SPA, whose Vite-built inline module preload would need a nonce.
        app.use(securityHeaders());
    }

    app.get('/api/healthz', () => json({ ok: true, at: new Date().toISOString(), lastBlock: store.cursor() }));

    // ------------------------------------------------------------------------------------
    // /api/markets
    // ------------------------------------------------------------------------------------

    const markets = feature('/markets', (routes) => ({

        list: routes.get('/', { query: marketsQuery, output: marketPage }, ({ query }) =>
        {
            const result = pageOf(query);
            return { ...result, rows: presentAll(result.rows) };
        }),

        one: routes.get('/:id', { output: market }, ({ params }) =>
            present(requireMarket(params.id))
        ),

        series: routes.get(
            '/:id/series',
            { query: seriesQuery, output: series },
            ({ params, query }) =>
            {
                const row = requireMarket(params.id);
                const outcomes = store.outcomesOf(row.id);
                const target =
                    query.outcome === 'yes'
                        ? outcomes[0]
                        : (outcomes.find((outcome) => outcome.oid === query.outcome) ?? outcomes[0]);
                if (target === undefined)
                {
                    throw new NotFoundError('No such outcome');
                }
                const now = nowSeconds();
                const start = rangeStart(query.range, now);
                return {
                    points: bucketSeries(store.pricePoints(row.id, target.idx, start), start, now, target.price)
                };
            }
        ),

        // Both lists page on the SERVER. They used to return a fixed slice (40 trades, 8
        // holders) with no total, so a market's tail was unreachable and the holders list
        // could never fill even one client page - its pagination control was unreachable
        // markup. The window is the caller's, the count is the whole set's.
        activity: routes.get(
            '/:id/activity',
            { query: activityQuery, output: activityPage },
            ({ params, query }) =>
            {
                const row = requireMarket(params.id);
                const outcomes = store.outcomesOf(row.id);
                const limit = query.limit ?? 10;
                const page = query.page ?? 1;
                const total = store.tradesCountOfMarket(row.id);
                const rows = store
                    .tradesOfMarket(row.id, limit, (page - 1) * limit)
                    .map((trade) => presentTrade(trade, outcomes, row));
                return { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
            }
        ),

        holders: routes.get(
            '/:id/holders',
            { query: activityQuery, output: holderPage },
            ({ params, query }) =>
            {
                const row = requireMarket(params.id);
                const outcomes = store.outcomesOf(row.id);
                const limit = query.limit ?? 10;
                const page = query.page ?? 1;
                const total = store.holdersCountOf(row.id);
                const rows = store
                    .holdersOf(row.id, limit, (page - 1) * limit)
                    .map((balance) => presentHolder(balance, outcomes));
                return { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
            }
        )
    }));

    // ------------------------------------------------------------------------------------
    // /api/creators/:address - the ONE creator read that is not behind the admin session, and
    // it has to be: the wallet asking is by definition NOT an admin. It is a wallet the console
    // invited to fill the create form in, and it cannot be told so by a route only admins can
    // call. A yes/no about the address the caller already named is all that leaves here, so the
    // allowlist itself stays private.
    // ------------------------------------------------------------------------------------

    /**
     * A path parameter carries no schema in the typed contract - azeroth types params from the
     * pattern, and a pattern cannot say "40 hex nibbles". So the shape check that used to ride
     * on `creatorParams` is made here, and it answers 422 exactly as a body or query failure
     * would: the allowlist compares strings, and anything else shaped like an address would be
     * looked up and silently miss.
     */
    const requireWallet = (address: string): string =>
    {
        if (!/^0x[0-9a-fA-F]{40}$/.test(address))
        {
            throw new ValidationError({ address: 'Not a wallet address' });
        }
        return address;
    };

    const creators = feature('/creators', (routes) => ({
        check: routes.get('/:address', { output: creatorAccess }, ({ params }) => ({
            allowed: store.isMarketCreator(requireWallet(params.address))
        }))
    }));

    // ------------------------------------------------------------------------------------
    // /api/proposals - a market written by a wallet that cannot deploy one.
    //
    // Outside the admin scope by necessity, exactly like the creator check above: a proposer
    // is by definition NOT an admin and has no session to read the console with. The gate is
    // the signature plus the allowlist, and what a proposal can do at its very best is put a
    // row in a table for the owner to look at.
    // ------------------------------------------------------------------------------------

    /** Per wallet, still waiting. An invited contributor who stops being trusted is removed
     *  from the allowlist; this is what stops one filling the queue before anyone notices. */
    const PENDING_PER_PROPOSER = 20;

    // Keyed by the address the caller names, so a proposer sees their own queue without a
    // wallet prompt on every page load. What it discloses is the market questions someone
    // proposed and the reply they were given - drafts of things meant to be published, not
    // the allowlist, which is still private.
    const proposals = feature('/proposals', (routes) => ({
        mine: routes.get(
            '/',
            { query: proposalsQuery, output: array(proposal) },
            ({ query }) => store.proposalsBy(query.address, 50).map(presentProposal)
        ),

        submit: routes.post('/', { input: proposalInput, output: proposal }, async ({ input }) =>
        {
        // The TITLE is what was signed, and it is read back out of the draft rather than sent
        // beside it - so a signature cannot be collected for one question and spent on another.
            await verifySigned({ ...input, message: proposalMessage(proposalTitle(input.draft), input.issuedAt) });

            // Either credential opens this: a wallet the console invited, or an actual factory
            // admin. A second admin holds the role but not this console, and telling them to get
            // themselves invited before they can write a market down would be a silly errand.
            if (!store.isMarketCreator(input.address) && !(await chain.hasAdminRole(input.address as Address)))
            {
                throw new ForbiddenError('Not invited to prepare markets');
            }
            if (store.pendingProposalCount(input.address) >= PENDING_PER_PROPOSER)
            {
                throw new ConflictError(`You already have ${ PENDING_PER_PROPOSER } proposals waiting`);
            }

            const at = Date.now();
            const id = store.addProposal(input.draft, input.address, at);
            // Built rather than read back: every field of a proposal one millisecond old is
            // already here, and the number is what the proposer is told to quote.
            return {
                id,
                draft: input.draft,
                proposer: input.address.toLowerCase(),
                state: 'pending' as const,
                note: '',
                createdAt: new Date(at).toISOString(),
                decidedAt: '',
                decidedBy: ''
            };
        })
    }));

    // ------------------------------------------------------------------------------------
    // /api/tags - the autocomplete, and the vocabulary itself.
    //
    // Public and unauthenticated like the category list, and for the same reason: it says
    // only what the markets already say. Ordered by how many markets carry each tag, so the
    // first completion offered is the one an author most likely means - which is what stops
    // a vocabulary from splintering into near-duplicates one market wide.
    // ------------------------------------------------------------------------------------

    const tags = feature('/tags', (routes) => ({
        list: routes.get('/', { query: tagsQuery, output: array(tagCount) }, ({ query }) =>
        // Normalised, so a half-typed `Iran Foot` completes against `iran-foot...` rather
        // than against nothing - the box is a tag prefix, not a phrase.
            store.searchTags(normalizeTag(query.q ?? ''), query.limit ?? 10))
    }));

    // ------------------------------------------------------------------------------------
    // /api/categories
    // ------------------------------------------------------------------------------------

    const categories = feature('/categories', (routes) => ({

        // Two eras answer here at once. A category that is a NUMBER is an id into the
        // factory's registry, and the chain's own meanings are what it is called; a category
        // that is a name is what markets carried before the registry existed, and the
        // off-chain table is the only thing that ever named those. The chain wins whenever
        // it has an opinion, which is what makes a registry the source of truth.
        list: routes.get('/', { output: array(categoryCount) }, () =>
        {
            const meanings = new Map<string, Localized>();
            for (const row of store.chainCategoryNames())
            {
                // The registry can hold any language tag; this app serves ten and reads the
                // rest as absent rather than inventing a key no dictionary has.
                if (!(CONTENT_LANGS as readonly string[]).includes(row.lang))
                {
                    continue;
                }
                const id = String(row.id);
                meanings.set(id, { ...(meanings.get(id) ?? { en: '' }), [row.lang]: row.meaning });
            }
            const enabled = new Map(store.chainCategories().map((row) => [String(row.id), row.enabled]));

            /** The registry's names for an id, with the id itself standing in for a missing
                 *  English one - every reader falls back to English, so it can never be blank. */
            const named = (id: string): Localized | null =>
            {
                const entry = meanings.get(id);
                return entry === undefined ? null : entry.en === '' ? { ...entry, en: id } : entry;
            };

            const rows = store.categories().map((row) => ({
                id: row.id,
                count: row.count,
                label: named(row.id) ?? parseLocalized(row.labelJson === '' ? row.id : row.labelJson),
                retired: enabled.get(row.id) === undefined ? row.retired : enabled.get(row.id) !== true
            }));

            // A category registered on chain that nothing has been filed under yet: no
            // market derives it, so the listing would not show it at all - and a picker
            // that cannot offer it makes registering one ahead of time pointless.
            const listed = new Set(rows.map((row) => row.id));
            for (const [id, open] of enabled)
            {
                if (!listed.has(id))
                {
                    rows.push({ id, count: 0, label: named(id) ?? { en: id }, retired: !open });
                }
            }
            return rows;
        }),

        // A category's ID is the on-chain string and is never editable; this writes only
        // the presentation metadata that never lived on-chain in the first place.
        save: routes.post(
            '/',
            { input: categoryInput, output: categoryCount },
            async ({ input }) =>
            {
                const id = input.id.trim().toLowerCase();
                if (id === '')
                {
                    throw new BadRequestError('Category id is required');
                }
                await requireSigned({ ...input, message: categoryMessage(id, input.issuedAt) });
                store.upsertCategory({
                    id,
                    labelJson: JSON.stringify(localizedOf(input.label)),
                    sortOrder: input.sortOrder,
                    retired: input.retired
                });
                const saved = store.categories().find((entry) => entry.id === id);
                if (saved === undefined)
                {
                    throw new BadRequestError('Category did not persist');
                }
                return {
                    id: saved.id,
                    count: saved.count,
                    label: parseLocalized(saved.labelJson === '' ? saved.id : saved.labelJson),
                    retired: saved.retired
                };
            }
        ),

        // Forgets the PRESENTATION row only. A market's category is an on-chain string; it
        // keeps listing under the id and simply shows it raw again, so this is recoverable
        // by registering the same id a second time.
        // A POST, not a DELETE: the typed contract gives DELETE no request body, and this
        // one is a SIGNED delete - the address, timestamp and signature travel with it.
        // `categoryDeleteMessage` names neither method nor path, so the signature is
        // unchanged by the move.
        remove: routes.post(
            '/remove',
            { input: categoryDeleteInput, output: boolean() },
            async ({ input }) =>
            {
                const id = input.id.trim().toLowerCase();
                if (id === '')
                {
                    throw new BadRequestError('Category id is required');
                }
                await requireSigned({ ...input, message: categoryDeleteMessage(id, input.issuedAt) });
                return store.deleteCategory(id);
            }
        )
    }));

    // ------------------------------------------------------------------------------------
    // /api/uploads - multipart, not JSON: the browser posts FormData directly.
    // ------------------------------------------------------------------------------------

    // `raw`, not the typed `form` helper: the browser posts this with a bare fetch and
    // FormData (see image-field.tsx), so it never appears in the typed client anyway, and the
    // body readers are the documented surface.
    const uploads = feature('/uploads', (routes) => ({
        store: routes.raw('POST', '/', {}, async ({ request }) =>
        {
            if (uploader === undefined)
            {
                throw new BadRequestError('Image uploads are not configured on this deployment');
            }

            let parsed;
            try
            {
            // The same ceilings the Fastify limits declared: one 2 MiB image, eight parts.
                parsed = await readMultipart(request, {
                    limit: MAX_IMAGE_BYTES,
                    maxFileSize: MAX_IMAGE_BYTES,
                    maxParts: 8
                });
            }
            catch
            {
            // The limits reject on TRANSPORT (too big, too many parts); that is the caller's
            // mistake, so it must not read as a 500.
                throw new BadRequestError('The upload was rejected - check the file size and try again');
            }

            const bytes = parsed.files[0]?.data;
            const address = parsed.fields.get('address') ?? undefined;
            const issuedAt = parsed.fields.get('issuedAt') ?? undefined;
            const signature = parsed.fields.get('signature') ?? undefined;
            if (address === undefined || issuedAt === undefined || signature === undefined)
            {
                throw new BadRequestError('address, issuedAt and signature are required');
            }
            await requireSigned({ address, issuedAt, signature, message: uploadMessage(issuedAt) });

            if (bytes === undefined)
            {
                throw new BadRequestError('No file was posted');
            }
            try
            {
                return json(await storeImage(uploader, bytes));
            }
            catch (error)
            {
            // storeImage rejects on CONTENT, not on transport: the wrong format or an
            // oversized image is the caller's mistake, so it must not read as a 500.
                throw new BadRequestError(error instanceof Error ? error.message : 'Upload rejected');
            }
        })
    }));

    // ------------------------------------------------------------------------------------
    // /api/chain
    // ------------------------------------------------------------------------------------

    const chainInfo = feature('/chain', (routes) => ({
        config: routes.get('/', { output: chainConfig }, () => ({
            chainId: chain.env.chainId,
            factory: chain.env.factory,
            treasury,
            deployBlock: chain.env.deployBlock,
            lastBlock: Math.max(store.cursor(), 0)
        }))
    }));

    // ------------------------------------------------------------------------------------
    // /api/portfolio - all address-scoped: the wallet IS the account.
    // ------------------------------------------------------------------------------------

    const portfolio = feature('/portfolio', (routes) => ({

        summary: routes.get(
            '/',
            { query: addressQuery, output: portfolioSummary },
            async ({ query }) =>
            {
                const address = query.address.toLowerCase();
                const positions = positionsOf(address);
                const invested = positions.reduce((sum, entry) => sum + entry.shares * entry.avgPrice, 0);
                const current = positions.reduce((sum, entry) =>
                {
                    const outcome = entry.market.outcomes.find((candidate) => candidate.id === entry.outcomeId);
                    const price = outcome?.price ?? 0;
                    return sum + entry.shares * (entry.side === 'yes' ? price : 1 - price);
                }, 0);
                const now = nowSeconds();
                const curve = profitCurve(
                    store.tradesOfAccount(address, 0),
                    store.claimsOfAccount(address, 0),
                    [now - DAY, now],
                    (marketId, idx, at) => store.priceAt(marketId, idx, at)
                );
                const profit = curve[1]?.p ?? 0;
                return {
                    balance: await chain.nativeBalance(address as Address),
                    invested,
                    current,
                    profit,
                    profitToday: profit - (curve[0]?.p ?? 0)
                };
            }
        ),

        positions: routes.get(
            '/positions',
            { query: addressQuery, output: array(position) },
            ({ query }) => positionsOf(query.address.toLowerCase())
        ),

        // A redeemed winner's shares are burned, so no position is left to say it was paid.
        claimed: routes.get(
            '/claimed',
            { query: addressQuery, output: array(string()) },
            ({ query }) => claimedMarketsOf(query.address.toLowerCase())
        ),

        series: routes.get(
            '/series',
            { query: profitSeriesQuery, output: profitSeries },
            ({ query }) =>
            {
                const address = query.address.toLowerCase();
                const now = nowSeconds();
                return {
                    points: profitCurve(
                        store.tradesOfAccount(address, 0),
                        store.claimsOfAccount(address, 0),
                        sampleTimes(periodStart(query.period, now), now, 40),
                        (marketId, idx, at) => store.priceAt(marketId, idx, at)
                    )
                };
            }
        ),

        activity: routes.get(
            '/activity',
            { query: addressQuery, output: array(activityItem) },
            ({ query }) =>
            {
                const trades = store.tradesOfAccount(query.address.toLowerCase(), 0).reverse().slice(0, 100);
                const outcomesCache = new Map<number, ReturnType<IndexStore['outcomesOf']>>();
                const marketCache = new Map<number, MarketRow | null>();
                return trades.map((trade) =>
                {
                    const outcomes = outcomesCache.get(trade.market_id) ?? store.outcomesOf(trade.market_id);
                    outcomesCache.set(trade.market_id, outcomes);
                    const market = marketCache.get(trade.market_id) ?? store.marketById(trade.market_id);
                    marketCache.set(trade.market_id, market);
                    return presentTrade(trade, outcomes, market);
                });
            }
        )
    }));

    // ------------------------------------------------------------------------------------
    // /api/leaderboard
    // ------------------------------------------------------------------------------------

    const leaderboardApi = feature('/leaderboard', (routes) => ({
        list: routes.get(
            '/',
            { query: leaderboardQuery, output: array(leaderboardRow) },
            ({ query }) =>
            {
                const now = nowSeconds();
                const since = periodStart(query.period, now);
                // The SAME curve the portfolio page draws, sampled at the window's ends: a window's
                // profit is what the positions were worth then vs now, plus the cash that moved
                // between. Counting the window's cash flow alone reported every buyer as down
                // exactly what they had spent, which was the default tab.
                const profitOf = (account: string): number =>
                {
                    const curve = profitCurve(
                        store.tradesOfAccount(account, 0),
                        store.claimsOfAccount(account, 0),
                        [since, now],
                        (marketId, idx, at) => store.priceAt(marketId, idx, at)
                    );
                    return (curve[1]?.p ?? 0) - (query.period === 'all' ? 0 : (curve[0]?.p ?? 0));
                };
                return leaderboard(store.tradeRollup(since), profitOf, 25);
            }
        )
    }));

    // ------------------------------------------------------------------------------------
    // /api/referrals - the referral program.
    //
    // Reads are public and keyed by address, exactly like /api/portfolio: everything behind
    // them is derived from public trades on a public chain, and inventing a second auth model
    // to hide a sum of them would be theatre.
    //
    // The two WRITES are signed by the wallet they concern, and neither one needs the admin
    // role. Creating a campaign is signed because a campaign is an earning account; joining
    // one is signed because the alternative - trusting the address in the input - lets anyone
    // post a stranger's wallet against their own code and collect a cut of that stranger's
    // fees. Nothing here moves money: it records who is owed what, and settlement out of the
    // treasury stays a deliberate act elsewhere.
    // ------------------------------------------------------------------------------------

    /** One wallet's referred traders, rolled up since an instant. Hoisted out of the feature
     *  body: a feature declares routes, and a helper is not one. */
    const rollupOf = (address: string, since: number): Map<string, TradeRollup> =>
        new Map(
            store
                .referredRollup(address, since)
                .map((row) => [
                    row.account,
                    { trades: row.trades, volume: row.volume, fees: row.fees, lastAt: row.lastAt }
                ])
        );

    const referrals = feature('/referrals', (routes) => ({
        dashboard: routes.get(
            '/',
            { query: referralQuery, output: referralDashboard },
            ({ query }) =>
            {
                const address = query.address.toLowerCase();
                const period = query.period ?? 'all';
                const since = periodStart(period, nowSeconds());

                // The two tiers do not depend on the window - only the trading does - so
                // the joins are read once and folded twice.
                const direct: JoinRow[] = store.directReferrals(address);
                const indirect: JoinRow[] = store.indirectReferrals(address);

                const windowed = compose(direct, indirect, rollupOf(address, since), since);
                const total = period === 'all' ? windowed : compose(direct, indirect, rollupOf(address, 0), 0);

                const origin = store.referralOf(address);

                return {
                    address,
                    period,
                    total: total.stats,
                    window: windowed.stats,
                    campaigns: store.campaignRollup(address, since).map((row) => ({
                        code: row.code,
                        name: row.name,
                        createdAt: new Date(row.created_at * 1000).toISOString(),
                        signups: row.signups,
                        fees: row.fees,
                        earnings: shareOf(row.fees, 'direct')
                    })),
                    referred: windowed.referred,
                    referrer:
                            origin === null
                                ? null
                                : {
                                    address: origin.referrer,
                                    code: origin.code,
                                    joinedAt: new Date(origin.at * 1000).toISOString()
                                }
                };
            }
        ),

        // What a code IS, before anybody signs anything: an invitation should be able to
        // name who sent it while the visitor is deciding.
        invite: routes.get(
            '/invite/:code',
            { output: referralInvite },
            ({ params }) =>
            {
                const campaign = store.campaignByCode(params.code.trim().toLowerCase());
                if (campaign === null)
                {
                    throw new NotFoundError('Unknown referral code');
                }
                return { code: campaign.code, name: campaign.name, owner: campaign.owner };
            }
        ),

        createCampaign: routes.post(
            '/campaigns',
            { input: campaignInput, output: referralCampaign },
            async ({ input }) =>
            {
                const name = input.name.trim();
                if (name === '')
                {
                    throw new BadRequestError('A campaign needs a name');
                }
                await verifySigned({ ...input, message: campaignMessage(name, input.issuedAt) });

                const owner = input.address.toLowerCase();
                if (store.campaignCount(owner) >= CAMPAIGN_LIMIT)
                {
                    throw new BadRequestError(`A wallet may hold ${ CAMPAIGN_LIMIT } campaigns`);
                }

                const code = pickCode(name, (candidate) => store.campaignByCode(candidate) !== null);
                const createdAt = nowSeconds();
                store.insertCampaign({ code, owner, name, created_at: createdAt });

                return {
                    code,
                    name,
                    createdAt: new Date(createdAt * 1000).toISOString(),
                    signups: 0,
                    fees: 0,
                    earnings: 0
                };
            }
        ),

        join: routes.post(
            '/join',
            { input: joinInput, output: referralOrigin },
            async ({ input }) =>
            {
                const code = input.code.trim().toLowerCase();
                await verifySigned({ ...input, message: joinMessage(code, input.issuedAt) });

                const account = input.address.toLowerCase();
                const campaign = store.campaignByCode(code);
                if (campaign === null)
                {
                    throw new NotFoundError('Unknown referral code');
                }
                if (campaign.owner === account)
                {
                    throw new BadRequestError('A wallet cannot refer itself');
                }
                if (store.referralOf(account) !== null)
                {
                    throw new BadRequestError('This wallet already has a referrer');
                }

                // Walk up from the campaign's owner. If this account is anywhere above
                // them, joining would close the chain into a ring and the two sides would
                // earn off each other forever.
                let cursor = campaign.owner;
                for (let depth = 0; depth < CHAIN_DEPTH; depth += 1)
                {
                    const up = store.referralOf(cursor);
                    if (up === null)
                    {
                        break;
                    }
                    if (up.referrer === account)
                    {
                        throw new BadRequestError('That would make a referral loop');
                    }
                    cursor = up.referrer;
                }

                const at = nowSeconds();
                if (!store.insertReferral({ account, code, referrer: campaign.owner, at }))
                {
                    throw new BadRequestError('This wallet already has a referrer');
                }
                return { address: campaign.owner, code, joinedAt: new Date(at * 1000).toISOString() };
            }
        )
    }));

    // ------------------------------------------------------------------------------------
    // /api/admin/session - the two routes that CANNOT sit behind the session guard.
    //
    // Signing in IS how you get past it, and signing out clears a cookie: requiring the
    // session you are clearing would strand whoever needs it most. They are registered in
    // their own scope, so the guarded scope below has no exemption list to get wrong.
    // ------------------------------------------------------------------------------------

    // Both return a RAW Response rather than a value: each has to set a cookie, and the
    // lockout has to set `retry-after`. A validated output would have to be a body, and these
    // answer 204.
    const session = feature('/admin/session', (routes) => ({
        signIn: routes.post('/', { input: sessionInput }, async ({ request, input }) =>
        {
            if (adminSession === undefined)
            {
                throw new NotFoundError();
            }
            try
            {
                const cookie = await adminSession.signIn(
                    sessionRequestOf(request),
                    input.address,
                    sessionMessage(input.issuedAt),
                    input.signature
                );
                return new Response(null, { status: 204, headers: { 'set-cookie': cookie } });
            }
            catch (error)
            {
                // The per-IP lockout carries a retry hint, and only a raw Response can put it
                // on the wire beside the status.
                if (error instanceof TooManyRequestsError)
                {
                    throw error;
                }
                throw error;
            }
        }),

        signOut: routes.del('/', {}, ({ request }) =>
        {
            if (adminSession === undefined)
            {
                return new Response(null, { status: 204 });
            }
            return new Response(null, {
                status: 204,
                headers: { 'set-cookie': adminSession.signOut(sessionRequestOf(request)) }
            });
        })
    }));

    // ------------------------------------------------------------------------------------
    // /api/admin - everything here is behind the session BY DEFAULT. A route added to this
    // scope is guarded because of the scope it lands in, not because someone remembered.
    // ------------------------------------------------------------------------------------

    const admin = feature('/admin', [requireAdminSession], (routes) => ({

        activity: routes.get(
            '/activity',
            { query: activityQuery, output: activityPage },
            ({ query }) =>
            {
                const limit = query.limit ?? 10;
                const page = query.page ?? 1;
                const total = store.tradesCount();
                const outcomesCache = new Map<number, ReturnType<IndexStore['outcomesOf']>>();
                const marketCache = new Map<number, MarketRow | null>();
                const rows = store.recentTrades(limit, (page - 1) * limit).map((trade) =>
                {
                    const outcomes = outcomesCache.get(trade.market_id) ?? store.outcomesOf(trade.market_id);
                    outcomesCache.set(trade.market_id, outcomes);
                    const market = marketCache.get(trade.market_id) ?? store.marketById(trade.market_id);
                    marketCache.set(trade.market_id, market);
                    return presentTrade(trade, outcomes, market);
                });
                return { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
            }
        ),

        stats: routes.get('/stats', { output: adminStats }, () =>
        {
            const aggregate = store.aggregates(nowSeconds() - DAY);
            return {
                markets: aggregate.markets,
                ...store.statusCounts(),
                volume: aggregate.volume,
                volume24h: aggregate.volume24h,
                traders: aggregate.traders,
                feesCollected: aggregate.fees,
                tvl: aggregate.tvl
            };
        }),

        markets: routes.get(
            '/markets',
            { query: marketsQuery, output: adminMarketPage },
            ({ query }) =>
            {
                const result = pageOf(query, { includeEnded: true });
                // One query for the whole page rather than one per row: the flag decides a
                // badge, and a badge is not worth N round trips to sqlite.
                const corrected = store.overridesIn(result.rows.map((row) => row.id));
                const page = presentAll(result.rows);
                const rows: AdminMarketRow[] = result.rows.map((row, at) =>
                {
                    const presented = page[at];
                    return {
                        id: presented.id,
                        address: row.address,
                        title: presented.title,
                        emoji: row.emoji,
                        category: row.category,
                        status: statusName(row),
                        kind: row.kind === 1 ? 'pool' : 'amm',
                        winningOutcomeId: presented.winningOutcomeId,
                        outcomeCount: row.outcome_count,
                        createdAt: new Date(row.created_at * 1000).toISOString(),
                        locksAt: new Date(row.lock_time * 1000).toISOString(),
                        resolvesAt: new Date(row.resolve_time * 1000).toISOString(),
                        liquidity: row.liquidity,
                        volume: row.volume,
                        collected: row.collected,
                        featured: row.featured === 1,
                        edited: corrected.has(row.id)
                    };
                });
                return { ...result, rows };
            }
        ),

        // Everything a deployed market lets an admin correct, plus what the chain still
        // holds. Both halves in one read: the dialog opens on the current text and has to
        // be able to show what it is departing from without a second request.
        marketEdit: routes.get(
            '/markets/:id/edit',
            { output: marketEditState },
            ({ params }) =>
            {
                const row = requireMarket(params.id);
                const current = textOf(store, row.id);
                const origin = chainTextOf(store, row.id);
                if (current === null || origin === null)
                {
                    throw new NotFoundError(`No market ${ params.id }`);
                }
                const override = store.overrideOf(row.id);
                return {
                    marketId: String(row.id),
                    ...current,
                    locksAt: new Date(row.lock_time * 1000).toISOString(),
                    resolvesAt: new Date(row.resolve_time * 1000).toISOString(),
                    status: statusName(row),
                    origin,
                    editedAt: override === null ? null : new Date(override.edited_at * 1000).toISOString(),
                    editedBy: override?.edited_by ?? null
                };
            }
        ),

        // A correction to a market that is already running. This changes what the SITE
        // shows and nothing the chain knows - there is no setter to call, so the original
        // text stays on chain and stays readable, which is the honest shape for a
        // correction to something people have already staked money against.
        editMarket: routes.post(
            '/market',
            { input: marketEditInput, output: marketEditResult },
            async ({ input }) =>
            {
                await requireSigned({ ...input, message: marketEditMessage(input.marketId, input.issuedAt) });
                const row = requireMarket(input.marketId);

                const current = textOf(store, row.id);
                if (current === null)
                {
                    throw new NotFoundError(`No market ${ input.marketId }`);
                }
                const next = normalise({
                    title: input.title,
                    emoji: input.emoji,
                    rules: input.rules,
                    image: input.image,
                    category: input.category,
                    tags: input.tags,
                    outcomes: input.outcomes
                } satisfies MarketText);

                if (next.title.en.trim() === '')
                {
                    throw new BadRequestError('An English title is required');
                }
                if (next.outcomes.some((outcome) => outcome.label.en.trim() === ''))
                {
                    throw new BadRequestError('Every outcome needs an English label');
                }
                if (outcomeCountMismatch(current, next))
                {
                    throw new BadRequestError(`This market has ${ current.outcomes.length } outcomes on chain`);
                }
                if (reshapesBinary(current, next))
                {
                    throw new ConflictError('Renaming the legs of a Yes/No market would change how it trades');
                }

                const { edited } = saveText(store, row.id, next, input.address, nowSeconds());
                return { ok: true, edited };
            }
        ),

        // Drops a correction. Separate from posting an empty edit on purpose: the message
        // signed for one is not replayable as the other.
        revertMarket: routes.post(
            '/market/revert',
            { input: marketRevertInput, output: marketEditResult },
            async ({ input }) =>
            {
                await requireSigned({ ...input, message: marketRevertMessage(input.marketId, input.issuedAt) });
                const row = requireMarket(input.marketId);
                revertText(store, row.id);
                return { ok: true, edited: false };
            }
        ),

        // ------------------------------------------------------------------------------
        // The bot: its settings, who may command it, and what they proposed.

        telegram: routes.get('/telegram', { output: telegramState }, () => telegramStateOf()),

        saveTelegram: routes.post(
            '/telegram/settings',
            { input: telegramSettingsInput, output: telegramSettings },
            async ({ input }) =>
            {
                await requireSigned({
                    ...input,
                    message: telegramSettingsMessage(input.backupMinutes, input.events, input.issuedAt)
                });
                const next = { backupMinutes: input.backupMinutes, events: input.events };
                writeTelegramSettings(store, next);
                // Saved FIRST, then applied. A running service that took the change but a
                // database that did not would revert at the next restart, which is the
                // confusing way round to fail.
                options.telegram?.configure(next);
                return next;
            }
        ),

        creators: routes.get('/creators', { output: array(marketCreator) }, () => creatorsOf()),

        // Inviting a wallet writes a row and NOTHING else. There is no transaction here and
        // no role granted: the factory still refuses a deploy from it, which is the whole
        // reason this list can be handed out freely.
        addCreator: routes.post(
            '/creators',
            { input: marketCreatorInput, output: array(marketCreator) },
            async ({ input }) =>
            {
                await requireSigned({ ...input, message: creatorMessage(input.wallet, input.issuedAt) });
                store.putMarketCreator(
                    input.wallet,
                    input.label.trim().slice(0, 64),
                    input.address.toLowerCase(),
                    Date.now()
                );
                return creatorsOf();
            }
        ),

        removeCreator: routes.post(
            '/creators/remove',
            { input: marketCreatorRemoveInput, output: array(marketCreator) },
            async ({ input }) =>
            {
                await requireSigned({ ...input, message: creatorRemoveMessage(input.wallet, input.issuedAt) });
                store.removeMarketCreator(input.wallet);
                return creatorsOf();
            }
        ),

        // ------------------------------------------------------------------------------
        // The proposal queue, from the owner's side.

        proposals: routes.get('/proposals', { output: array(proposal) }, () =>
            store.proposals(50).map(presentProposal)
        ),

        // Accepting DEPLOYS nothing. It records the verdict; the console then seeds the
        // create form from the draft and the owner signs the deploy with their own wallet,
        // which is the only way a market has ever been created here.
        decideProposal: routes.post(
            '/proposals/decide',
            { input: proposalDecideInput, output: proposalResult },
            async ({ input }) =>
            {
                await requireSigned({
                    ...input,
                    message: proposalDecideMessage(input.id, input.accept, input.issuedAt)
                });
                const state: ProposalState = input.accept ? 'accepted' : 'declined';
                const note = input.note.trim().slice(0, 300);
                // One conditional UPDATE rather than a read then a write: two clicks on the
                // same row must not tell the proposer two different things.
                if (!store.decideProposal(input.id, state, input.address, note, Date.now()))
                {
                    throw new ConflictError(`No proposal ${ input.id } is waiting`);
                }
                return { ok: true, state };
            }
        ),

        feature: routes.post(
            '/feature',
            { input: featureInput, output: featureResult },
            async ({ input }) =>
            {
                const issued = Date.parse(input.issuedAt);
                if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > SIGNATURE_WINDOW_MS)
                {
                    throw new BadRequestError('Stale signature');
                }
                const valid = await verifyMessage({
                    address: input.address as Address,
                    message: featureMessage(input.marketId, input.featured, input.issuedAt),
                    signature: input.signature as `0x${ string }`
                });
                if (!valid)
                {
                    throw new ForbiddenError('Bad signature');
                }
                await requireAdmin(input.address);
                requireMarket(input.marketId);
                store.setFeatured(Number(input.marketId), input.featured);
                return { ok: true, featured: input.featured };
            }
        )
    }));

    // ------------------------------------------------------------------------------------
    // The typed contract. ONE register per App, and it is what `createClient` on the browser
    // side is typed from - the inference this app used to hand-write in application/src/api.ts.
    // ------------------------------------------------------------------------------------

    const api = {
        markets,
        creators,
        proposals,
        tags,
        categories,
        uploads,
        chain: chainInfo,
        portfolio,
        leaderboard: leaderboardApi,
        referrals,
        session,
        admin
    };

    register(app, api);

    // The manifest a browser with no server-rendered page has to fetch. Phase 3's page
    // renderer embeds it instead and this route goes cold on its own.
    app.get('/api/_manifest', () => json(manifestOf(api)));

    // ------------------------------------------------------------------------------------
    // Static halves, mounted last so nothing shadows /api.
    // ------------------------------------------------------------------------------------

    // Content-addressed bytes: the name IS the hash, so a cached copy can never go stale.
    if (options.uploadDir !== undefined)
    {
        app.get(
            '/uploads/*path',
            staticFiles(resolve(options.uploadDir), { cacheControl: 'public, max-age=31536000, immutable' })
        );
    }

    const originOf = (request: Request): string =>
    {
        const configured = (options.siteUrl ?? '').replace(/\/$/, '');
        return configured === '' ? new URL(request.url).origin : configured;
    };

    app.get('/robots.txt', (context) =>
    {
        const lines = [
            'User-agent: *',
            'Allow: /',
            ...['portfolio', 'referrals', 'settings', 'admin'].flatMap((page) => [
                `Disallow: /${ page }`,
                `Disallow: /*/${ page }`
            ]),
            `Sitemap: ${ originOf(context.request) }/sitemap.xml`,
            ''
        ];

        return new Response(lines.join('\n'), {
            headers: {
                'content-type': 'text/plain; charset=utf-8',
                'cache-control': 'public, max-age=3600'
            }
        });
    });

    app.get('/sitemap.xml', (context) =>
    {
        const origin = originOf(context.request);
        const escape = (text: string): string =>
            text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        const entry = (path: string, langs: readonly string[]): string =>
        {
            const alternates = langs
                .map((lang) =>
                    `    <xhtml:link rel="alternate" hreflang="${ lang }" `
                    + `href="${ escape(`${ origin }/${ lang }${ path }`) }"/>`)
                .join('\n');

            return langs
                .map((lang) => [
                    '  <url>',
                    `    <loc>${ escape(`${ origin }/${ lang }${ path }`) }</loc>`,
                    alternates,
                    `    <xhtml:link rel="alternate" hreflang="x-default" href="${ escape(`${ origin }${ path === '' ? '/' : path }`) }"/>`,
                    '  </url>'
                ].join('\n'))
                .join('\n');
        };

        const langs = [...CONTENT_LANGS];

        const statics = ['', '/browse', '/leaderboard', '/docs']
            .map((path) => entry(path, langs));

        const { rows } = store.listMarkets({ sort: 'newest', page: 1, limit: 400 });
        const markets = rows.map((row) =>
        {
            const title = parseLocalized(row.title_json);
            const rules = parseLocalized(row.rules_json);
            const wrote = title as unknown as Record<string, string | undefined>;
            const written = langs.filter((lang) => wrote[lang] !== undefined && wrote[lang] !== '');
            return entry(
                marketPath({ id: String(row.id), title, rules }),
                written.length === 0 ? ['en'] : written
            );
        });

        const body = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
            + 'xmlns:xhtml="http://www.w3.org/1999/xhtml">',
            ...statics,
            ...markets,
            '</urlset>',
            ''
        ].join('\n');

        return new Response(body, {
            headers: {
                'content-type': 'application/xml; charset=utf-8',
                'cache-control': 'public, max-age=3600'
            }
        });
    });

    // The pages. Registered LAST, per the kit's own rule: its asset fallback owns `/*path`,
    // and anything it could shadow has to be in place before it.
    //
    // This is what replaces the SPA shell fallback. A deep link like /market/<slug> no longer
    // reloads into a blank index.html and fetches its way back to the market - the server
    // renders the page, title and all, and the browser adopts what it is handed.
    if (options.pages !== undefined)
    {
        mountPages(app, {
            routes: options.pages.routes,
            renderer: options.pages.renderPage,
            clientDir: resolve(options.pages.clientDir),
            // Embedded into every page, so the typed client boots without a round trip for
            // the route manifest it dispatches through.
            manifest: manifestOf(api),
            images: true,
            locales: { supported: [...CONTENT_LANGS], default: 'en', routing: 'prefix' },
            onError: (error) => options.log?.error(`page render failed: ${ String(error) }`)
        });
    }

    return { app, api };
}

/** The contract the browser's typed client is built from. Inferred, never annotated: an
 *  explicit type here would be the hand-written client this deletes, spelled twice. */
export type Api = ReturnType<typeof buildApp>['api'];
