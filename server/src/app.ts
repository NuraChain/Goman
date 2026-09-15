import { resolve } from 'node:path';

import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { Type } from 'typebox';
import { verifyMessage, type Address } from 'viem';

import {
    BadRequestError,
    ConflictError,
    ForbiddenError,
    HttpError,
    NotFoundError,
    UnauthorizedError
} from './http-errors.ts';
import { type AdminSession } from './admin-session.ts';
import { readTelegramSettings, writeTelegramSettings } from './settings.ts';
import type { ProposalRow } from './chain/store.ts';
import {
    CAMPAIGN_LIMIT,
    CHAIN_DEPTH,
    compose,
    pickCode,
    shareOf,
    type JoinRow,
    type TradeRollup
} from './referrals.ts';
import type { Logger } from './logger.ts';

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
    scheduleInput,
    scheduleMessage,
    adminMarketPage,
    adminStats,
    proposalDecideInput,
    proposalPage,
    proposalQuery,
    proposalResult,
    telegramAdminInput,
    telegramAdminRemoveInput,
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
    marketParams,
    marketsQuery,
    portfolioSummary,
    position,
    profitSeries,
    profitSeriesQuery,
    sessionInput,
    sessionMessage,
    series,
    seriesQuery,
    uploadMessage,
    uploadResult,
    PROPOSAL_STATES,
    proposalDecideMessage,
    telegramAdminMessage,
    telegramAdminRemoveMessage,
    telegramSettingsMessage,
    type AdminMarketRow,
    type Localized,
    type Proposal,
    type ProposalState,
    type TelegramState,
    type Market,
    type MarketsQuery,
    type Position
} from './schemas.ts';
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
    statusName,
    statusNumber,
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
import type { IndexStore, MarketRow } from './chain/store.ts';

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

    /** The built client (production). Omit in dev - vite serves it and proxies /api here. */
    clientDir?: string;

    /**
     * Security headers and a request ceiling. Both OFF by default so a test drives a bare
     * app - the old pipeline wrapped these around the app in main.ts for the same reason.
     */
    hardened?: boolean;

    rateLimit?: { limit: number; windowMs: number };

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

export function buildApp(options: AppOptions): FastifyInstance {
    const { store, chain, treasury, uploader, adminSession } = options;

    const app = Fastify({ logger: false }).withTypeProvider<TypeBoxTypeProvider>();

    // ------------------------------------------------------------------------------------
    // Domain helpers - the read models every route shares.
    // ------------------------------------------------------------------------------------

    const nowSeconds = (): number => Math.floor(Date.now() / 1000);

    let trendingCache: { ids: Set<number>; at: number } = { ids: new Set(), at: 0 };
    const trendingIds = (): Set<number> => {
        if (Date.now() - trendingCache.at > 15_000) {
            trendingCache = { ids: new Set(store.trendingIds(nowSeconds() - DAY, TRENDING_LIMIT)), at: Date.now() };
        }
        return trendingCache.ids;
    };

    const change24hOf =
        (marketId: number, prices: Map<number, number>): ((idx: number) => number) =>
        (idx) => {
            const current = prices.get(idx) ?? 0;
            const then = store.priceAt(marketId, idx, nowSeconds() - DAY);
            return then === null ? 0 : current - then;
        };

    const present = (row: MarketRow): Market => {
        const outcomes = store.outcomesOf(row.id);
        const prices = new Map(outcomes.map((outcome) => [outcome.idx, outcome.price]));
        return presentMarket(row, outcomes, {
            trending: trendingIds().has(row.id),
            change24h: change24hOf(row.id, prices),
            startsAt: store.opening(row.id)?.start_at ?? null
        });
    };

    /** Telegram renders a subset of HTML, so anything interpolated into a message is escaped -
     *  a rejection note is free text, and an unbalanced tag makes Telegram refuse the message. */
    const escapeHtml = (text: string): string =>
        text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    /** A stored proposal as the console reads it. `outcomes_json` is written by this server,
     *  but it is still parsed defensively - a hand-edited database must not take the tab down. */
    const presentProposal = (row: ProposalRow): Proposal => {
        let outcomes: string[] = [];
        try {
            const parsed: unknown = JSON.parse(row.outcomes_json);
            if (Array.isArray(parsed)) {
                outcomes = parsed.filter((entry): entry is string => typeof entry === 'string');
            }
        } catch {
            outcomes = [];
        }
        return {
            id: row.id,
            from: row.tg_id,
            username: row.username,
            question: row.question,
            description: row.description,
            outcomes,
            closesAt: row.closes_at,
            category: row.category,
            state: (PROPOSAL_STATES as readonly string[]).includes(row.state)
                ? (row.state as ProposalState)
                : 'pending',
            note: row.note,
            createdAt: new Date(row.created_at).toISOString(),
            decidedAt: row.decided_at === 0 ? '' : new Date(row.decided_at).toISOString(),
            decidedBy: row.decided_by
        };
    };

    /** The Telegram tab's whole read. Shared by the tab's GET and by the two writes, which
     *  return the new state so the console does not have to re-fetch to see its own change. */
    const telegramStateOf = (): TelegramState => ({
        settings: readTelegramSettings(store),
        admins: store.telegramAdmins().map((row) => ({
            id: row.tg_id,
            username: row.username,
            addedBy: row.added_by,
            addedAt: new Date(row.added_at).toISOString()
        })),
        configured: options.telegram !== undefined,
        botName: options.telegram?.botName() ?? ''
    });

    const requireMarket = (id: string): MarketRow => {
        const row = store.marketById(Number(id));
        if (row === null) {
            throw new NotFoundError(`No market ${id}`);
        }
        return row;
    };

    const pageOf = (
        query: MarketsQuery,
        options: { includeEnded?: boolean } = {}
    ): { rows: MarketRow[]; total: number; page: number; pages: number } => {
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
        const filter = {
            search: query.search,
            category: query.category,
            status: query.status === undefined ? undefined : statusNumber(query.status),
            featured: query.featured,
            exclude: query.exclude === undefined ? undefined : Number(query.exclude),
            ids,
            liveOnly: options.includeEnded !== true && query.status === undefined && !searching && ids === undefined,
            sort: query.sort ?? 'volume',
            page,
            limit
        } as const;
        if (filter.ids !== undefined && filter.ids.length === 0) {
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

    /** Positions for one account, embedding their markets - the portfolio's whole read. */
    const positionsOf = (address: string): Position[] => {
        const basis = new Map(
            store.buyBasis(address).map((row) => [`${row.market_id}/${row.outcome_idx}`, vwap(row.amount, row.shares)])
        );
        return store.positionsOf(address).flatMap((balance) => {
            const row = store.marketById(balance.market_id);
            if (row === null) {
                return [];
            }
            const outcomes = store.outcomesOf(row.id);
            const idx = Number(balance.token_id);
            const binary = row.outcome_count === 2 && isBinaryPair(outcomes.map((o) => parseLocalized(o.label_json)));
            const { outcomeId, side } = presentSide(binary, outcomes, idx);
            const claimable = (row.status === 3 && row.winning_outcome === idx) || row.status === 4;
            return [
                {
                    id: `${balance.account}-${row.id}-${idx}`,
                    marketId: String(row.id),
                    outcomeId,
                    side,
                    shares: balance.shares,
                    avgPrice: basis.get(`${row.id}/${idx}`) ?? outcomes[idx]?.price ?? 0,
                    openedAt: new Date(balance.first_at * 1000).toISOString(),
                    claimable,
                    market: present(row)
                }
            ];
        });
    };

    const roleCache = new Map<string, { ok: boolean; at: number }>();
    const requireAdmin = async (address: string): Promise<void> => {
        const key = address.toLowerCase();
        const cached = roleCache.get(key);
        if (cached !== undefined && Date.now() - cached.at < ROLE_CACHE_MS && cached.ok) {
            return;
        }
        const ok = await chain.hasAdminRole(address as Address);
        roleCache.set(key, { ok, at: Date.now() });
        if (!ok) {
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
    }): Promise<void> => {
        const issued = Date.parse(params.issuedAt);
        if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > SIGNATURE_WINDOW_MS) {
            throw new BadRequestError('Stale signature');
        }
        // viem throws on a malformed address, which would surface as a 500 for what is
        // plainly a bad request.
        if (!/^0x[0-9a-fA-F]{40}$/.test(params.address)) {
            throw new BadRequestError('Not an address');
        }
        const valid = await verifyMessage({
            address: params.address as Address,
            message: params.message,
            signature: params.signature as `0x${string}`
        });
        if (!valid) {
            throw new ForbiddenError('Bad signature');
        }
    };

    const requireSigned = async (params: {
        address: string;
        issuedAt: string;
        signature: string;
        message: string;
    }): Promise<void> => {
        await verifySigned(params);
        await requireAdmin(params.address);
    };

    // ------------------------------------------------------------------------------------
    // Plugins
    // ------------------------------------------------------------------------------------

    // Registered BEFORE the routes: a hook added at the root scope reaches the child scopes
    // that are encapsulated after it, and only those. Ordering is the guard here.
    if (options.hardened === true) {
        // The CSP is off: this server also serves the SPA, whose Vite-built inline module
        // preload would need a nonce pipeline to survive one. Everything else - frameguard,
        // nosniff, referrer policy - applies.
        //
        // HSTS is off because it is NOT this process's to declare. TLS terminates at nginx,
        // which is the only hop that knows the scheme the browser actually used; this app
        // only ever sees plain HTTP from the proxy. Sending it from here puts a second
        // Strict-Transport-Security on a response that nginx already stamps, and RFC 6797
        // has the browser honour whichever arrives first - so the policy in force would be
        // decided by header order rather than by the edge that owns it. Nginx sets it:
        //   add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        app.register(fastifyHelmet, { contentSecurityPolicy: false, hsts: false });
    }
    if (options.rateLimit !== undefined) {
        app.register(fastifyRateLimit, {
            max: options.rateLimit.limit,
            timeWindow: options.rateLimit.windowMs
        });
    }

    app.register(fastifyCookie);
    app.register(fastifyMultipart, {
        limits: { fileSize: MAX_IMAGE_BYTES, files: 1, parts: 8, fieldSize: 64 * 1024 }
    });

    // One error vocabulary. An HttpError carries its own status; a schema failure is the
    // caller's 400; anything else is a 500 whose detail stays in the log, not in the body.
    app.setErrorHandler((error: FastifyError, request, reply) => {
        if (error instanceof HttpError) {
            if (error.statusCode === 429 && 'retryAfter' in error) {
                reply.header('retry-after', String((error as { retryAfter: number }).retryAfter));
            }
            reply.status(error.statusCode).send({ error: error.message });
            return;
        }
        // 422, not Fastify's default 400: a schema failure is a well-formed request whose
        // CONTENT is unprocessable, and that is the status this API has always answered with.
        // A 400 here is reserved for the handler's own BadRequestError.
        if (error.validation !== undefined) {
            reply.status(422).send({ error: error.message });
            return;
        }
        options.log?.error('request failed', { method: request.method, url: request.url, error: String(error) });
        reply.status(error.statusCode ?? 500).send({ error: 'Internal Server Error' });
    });

    if (options.log !== undefined) {
        const log = options.log;
        app.addHook('onResponse', async (request, reply) => {
            log.info('request', {
                method: request.method,
                url: request.url,
                status: reply.statusCode,
                ms: Math.round(reply.elapsedTime)
            });
        });
    }

    app.get('/api/healthz', () => ({ ok: true, at: new Date().toISOString(), lastBlock: store.cursor() }));

    // ------------------------------------------------------------------------------------
    // /api/markets
    // ------------------------------------------------------------------------------------

    app.register(
        async (scope) => {
            // A child scope does not inherit the parent's type provider, so it is
            // re-applied here - without it every `query`, `body` and `params` is `unknown`.
            const markets = scope.withTypeProvider<TypeBoxTypeProvider>();

            markets.get('/', { schema: { querystring: marketsQuery, response: { 200: marketPage } } }, ({ query }) => {
                const result = pageOf(query);
                return { ...result, rows: result.rows.map(present) };
            });

            markets.get('/:id', { schema: { params: marketParams, response: { 200: market } } }, ({ params }) =>
                present(requireMarket(params.id))
            );

            markets.get(
                '/:id/series',
                { schema: { params: marketParams, querystring: seriesQuery, response: { 200: series } } },
                ({ params, query }) => {
                    const row = requireMarket(params.id);
                    const outcomes = store.outcomesOf(row.id);
                    const target =
                        query.outcome === 'yes'
                            ? outcomes[0]
                            : (outcomes.find((outcome) => outcome.oid === query.outcome) ?? outcomes[0]);
                    if (target === undefined) {
                        throw new NotFoundError('No such outcome');
                    }
                    const now = nowSeconds();
                    const start = rangeStart(query.range, now);
                    return {
                        points: bucketSeries(store.pricePoints(row.id, target.idx, start), start, now, target.price)
                    };
                }
            );

            // Both lists page on the SERVER. They used to return a fixed slice (40 trades, 8
            // holders) with no total, so a market's tail was unreachable and the holders list
            // could never fill even one client page - its pagination control was unreachable
            // markup. The window is the caller's, the count is the whole set's.
            markets.get(
                '/:id/activity',
                { schema: { params: marketParams, querystring: activityQuery, response: { 200: activityPage } } },
                ({ params, query }) => {
                    const row = requireMarket(params.id);
                    const outcomes = store.outcomesOf(row.id);
                    const limit = query.limit ?? 10;
                    const page = query.page ?? 1;
                    const total = store.tradesCountOfMarket(row.id);
                    const rows = store
                        .tradesOfMarket(row.id, limit, (page - 1) * limit)
                        .map((trade) => presentTrade(trade, outcomes));
                    return { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
                }
            );

            markets.get(
                '/:id/holders',
                { schema: { params: marketParams, querystring: activityQuery, response: { 200: holderPage } } },
                ({ params, query }) => {
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
            );
        },
        { prefix: '/api/markets' }
    );

    // ------------------------------------------------------------------------------------
    // /api/categories
    // ------------------------------------------------------------------------------------

    app.register(
        async (scope) => {
            // A child scope does not inherit the parent's type provider, so it is
            // re-applied here - without it every `query`, `body` and `params` is `unknown`.
            const categories = scope.withTypeProvider<TypeBoxTypeProvider>();

            // Two eras answer here at once. A category that is a NUMBER is an id into the
            // factory's registry, and the chain's own meanings are what it is called; a category
            // that is a name is what markets carried before the registry existed, and the
            // off-chain table is the only thing that ever named those. The chain wins whenever
            // it has an opinion, which is what makes a registry the source of truth.
            categories.get('/', { schema: { response: { 200: Type.Array(categoryCount) } } }, () => {
                const meanings = new Map<string, Localized>();
                for (const row of store.chainCategoryNames()) {
                    // The registry can hold any language tag; this app serves ten and reads the
                    // rest as absent rather than inventing a key no dictionary has.
                    if (!(CONTENT_LANGS as readonly string[]).includes(row.lang)) {
                        continue;
                    }
                    const id = String(row.id);
                    meanings.set(id, { ...(meanings.get(id) ?? { en: '' }), [row.lang]: row.meaning });
                }
                const enabled = new Map(store.chainCategories().map((row) => [String(row.id), row.enabled]));

                /** The registry's names for an id, with the id itself standing in for a missing
                 *  English one - every reader falls back to English, so it can never be blank. */
                const named = (id: string): Localized | null => {
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
                for (const [id, open] of enabled) {
                    if (!listed.has(id)) {
                        rows.push({ id, count: 0, label: named(id) ?? { en: id }, retired: !open });
                    }
                }
                return rows;
            });

            // A category's ID is the on-chain string and is never editable; this writes only
            // the presentation metadata that never lived on-chain in the first place.
            categories.post(
                '/',
                { schema: { body: categoryInput, response: { 200: categoryCount } } },
                async ({ body }) => {
                    const id = body.id.trim().toLowerCase();
                    if (id === '') {
                        throw new BadRequestError('Category id is required');
                    }
                    await requireSigned({ ...body, message: categoryMessage(id, body.issuedAt) });
                    store.upsertCategory({
                        id,
                        labelJson: JSON.stringify(localizedOf(body.label)),
                        sortOrder: body.sortOrder,
                        retired: body.retired
                    });
                    const saved = store.categories().find((entry) => entry.id === id);
                    if (saved === undefined) {
                        throw new BadRequestError('Category did not persist');
                    }
                    return {
                        id: saved.id,
                        count: saved.count,
                        label: parseLocalized(saved.labelJson === '' ? saved.id : saved.labelJson),
                        retired: saved.retired
                    };
                }
            );

            // Forgets the PRESENTATION row only. A market's category is an on-chain string; it
            // keeps listing under the id and simply shows it raw again, so this is recoverable
            // by registering the same id a second time.
            categories.delete(
                '/',
                { schema: { body: categoryDeleteInput, response: { 200: Type.Boolean() } } },
                async ({ body }) => {
                    const id = body.id.trim().toLowerCase();
                    if (id === '') {
                        throw new BadRequestError('Category id is required');
                    }
                    await requireSigned({ ...body, message: categoryDeleteMessage(id, body.issuedAt) });
                    return store.deleteCategory(id);
                }
            );
        },
        { prefix: '/api/categories' }
    );

    // ------------------------------------------------------------------------------------
    // /api/uploads - multipart, not JSON: the browser posts FormData directly.
    // ------------------------------------------------------------------------------------

    app.post('/api/uploads', { schema: { response: { 200: uploadResult } } }, async (request) => {
        if (uploader === undefined) {
            throw new BadRequestError('Image uploads are not configured on this deployment');
        }

        const fields: Record<string, string> = {};
        let bytes: Buffer | undefined;
        try {
            for await (const part of request.parts()) {
                if (part.type === 'file') {
                    bytes = await part.toBuffer();
                } else if (typeof part.value === 'string') {
                    fields[part.fieldname] = part.value;
                }
            }
        } catch {
            // The multipart limits above reject on TRANSPORT (too big, too many parts);
            // that is the caller's mistake, so it must not read as a 500.
            throw new BadRequestError('The upload was rejected - check the file size and try again');
        }

        const { address, issuedAt, signature } = fields;
        if (address === undefined || issuedAt === undefined || signature === undefined) {
            throw new BadRequestError('address, issuedAt and signature are required');
        }
        await requireSigned({ address, issuedAt, signature, message: uploadMessage(issuedAt) });

        if (bytes === undefined) {
            throw new BadRequestError('No file was posted');
        }
        try {
            return await storeImage(uploader, new Uint8Array(bytes));
        } catch (error) {
            // storeImage rejects on CONTENT, not on transport: the wrong format or an
            // oversized image is the caller's mistake, so it must not read as a 500.
            throw new BadRequestError(error instanceof Error ? error.message : 'Upload rejected');
        }
    });

    // ------------------------------------------------------------------------------------
    // /api/chain
    // ------------------------------------------------------------------------------------

    app.get('/api/chain', { schema: { response: { 200: chainConfig } } }, () => ({
        chainId: chain.env.chainId,
        factory: chain.env.factory,
        treasury,
        deployBlock: chain.env.deployBlock,
        lastBlock: Math.max(store.cursor(), 0)
    }));

    // ------------------------------------------------------------------------------------
    // /api/portfolio - all address-scoped: the wallet IS the account.
    // ------------------------------------------------------------------------------------

    app.register(
        async (scope) => {
            // A child scope does not inherit the parent's type provider, so it is
            // re-applied here - without it every `query`, `body` and `params` is `unknown`.
            const portfolio = scope.withTypeProvider<TypeBoxTypeProvider>();

            portfolio.get(
                '/',
                { schema: { querystring: addressQuery, response: { 200: portfolioSummary } } },
                async ({ query }) => {
                    const address = query.address.toLowerCase();
                    const positions = positionsOf(address);
                    const invested = positions.reduce((sum, entry) => sum + entry.shares * entry.avgPrice, 0);
                    const current = positions.reduce((sum, entry) => {
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
            );

            portfolio.get(
                '/positions',
                { schema: { querystring: addressQuery, response: { 200: Type.Array(position) } } },
                ({ query }) => positionsOf(query.address.toLowerCase())
            );

            portfolio.get(
                '/series',
                { schema: { querystring: profitSeriesQuery, response: { 200: profitSeries } } },
                ({ query }) => {
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
            );

            portfolio.get(
                '/activity',
                { schema: { querystring: addressQuery, response: { 200: Type.Array(activityItem) } } },
                ({ query }) => {
                    const trades = store.tradesOfAccount(query.address.toLowerCase(), 0).reverse().slice(0, 100);
                    const outcomesCache = new Map<number, ReturnType<IndexStore['outcomesOf']>>();
                    return trades.map((trade) => {
                        const outcomes = outcomesCache.get(trade.market_id) ?? store.outcomesOf(trade.market_id);
                        outcomesCache.set(trade.market_id, outcomes);
                        return presentTrade(trade, outcomes);
                    });
                }
            );
        },
        { prefix: '/api/portfolio' }
    );

    // ------------------------------------------------------------------------------------
    // /api/leaderboard
    // ------------------------------------------------------------------------------------

    app.get(
        '/api/leaderboard',
        { schema: { querystring: leaderboardQuery, response: { 200: Type.Array(leaderboardRow) } } },
        ({ query }) => {
            const now = nowSeconds();
            const since = periodStart(query.period, now);
            // The SAME curve the portfolio page draws, sampled at the window's ends: a window's
            // profit is what the positions were worth then vs now, plus the cash that moved
            // between. Counting the window's cash flow alone reported every buyer as down
            // exactly what they had spent, which was the default tab.
            const profitOf = (account: string): number => {
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
    );

    // ------------------------------------------------------------------------------------
    // /api/referrals - the referral program.
    //
    // Reads are public and keyed by address, exactly like /api/portfolio: everything behind
    // them is derived from public trades on a public chain, and inventing a second auth model
    // to hide a sum of them would be theatre.
    //
    // The two WRITES are signed by the wallet they concern, and neither one needs the admin
    // role. Creating a campaign is signed because a campaign is an earning account; joining
    // one is signed because the alternative - trusting the address in the body - lets anyone
    // post a stranger's wallet against their own code and collect a cut of that stranger's
    // fees. Nothing here moves money: it records who is owed what, and settlement out of the
    // treasury stays a deliberate act elsewhere.
    // ------------------------------------------------------------------------------------

    app.register(
        async (scope) => {
            // A child scope does not inherit the parent's type provider, so it is
            // re-applied here - without it every `query`, `body` and `params` is `unknown`.
            const referrals = scope.withTypeProvider<TypeBoxTypeProvider>();

            const rollupOf = (address: string, since: number): Map<string, TradeRollup> =>
                new Map(
                    store
                        .referredRollup(address, since)
                        .map((row) => [
                            row.account,
                            { trades: row.trades, volume: row.volume, fees: row.fees, lastAt: row.lastAt }
                        ])
                );

            referrals.get(
                '/',
                { schema: { querystring: referralQuery, response: { 200: referralDashboard } } },
                ({ query }) => {
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
            );

            // What a code IS, before anybody signs anything: an invitation should be able to
            // name who sent it while the visitor is deciding.
            referrals.get(
                '/invite/:code',
                {
                    schema: {
                        params: Type.Object({ code: Type.String({ maxLength: 32 }) }),
                        response: { 200: referralInvite }
                    }
                },
                ({ params }) => {
                    const campaign = store.campaignByCode(params.code.trim().toLowerCase());
                    if (campaign === null) {
                        throw new NotFoundError('Unknown referral code');
                    }
                    return { code: campaign.code, name: campaign.name, owner: campaign.owner };
                }
            );

            referrals.post(
                '/campaigns',
                { schema: { body: campaignInput, response: { 200: referralCampaign } } },
                async ({ body }) => {
                    const name = body.name.trim();
                    if (name === '') {
                        throw new BadRequestError('A campaign needs a name');
                    }
                    await verifySigned({ ...body, message: campaignMessage(name, body.issuedAt) });

                    const owner = body.address.toLowerCase();
                    if (store.campaignCount(owner) >= CAMPAIGN_LIMIT) {
                        throw new BadRequestError(`A wallet may hold ${CAMPAIGN_LIMIT} campaigns`);
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
            );

            referrals.post(
                '/join',
                { schema: { body: joinInput, response: { 200: referralOrigin } } },
                async ({ body }) => {
                    const code = body.code.trim().toLowerCase();
                    await verifySigned({ ...body, message: joinMessage(code, body.issuedAt) });

                    const account = body.address.toLowerCase();
                    const campaign = store.campaignByCode(code);
                    if (campaign === null) {
                        throw new NotFoundError('Unknown referral code');
                    }
                    if (campaign.owner === account) {
                        throw new BadRequestError('A wallet cannot refer itself');
                    }
                    if (store.referralOf(account) !== null) {
                        throw new BadRequestError('This wallet already has a referrer');
                    }

                    // Walk up from the campaign's owner. If this account is anywhere above
                    // them, joining would close the chain into a ring and the two sides would
                    // earn off each other forever.
                    let cursor = campaign.owner;
                    for (let depth = 0; depth < CHAIN_DEPTH; depth += 1) {
                        const up = store.referralOf(cursor);
                        if (up === null) {
                            break;
                        }
                        if (up.referrer === account) {
                            throw new BadRequestError('That would make a referral loop');
                        }
                        cursor = up.referrer;
                    }

                    const at = nowSeconds();
                    if (!store.insertReferral({ account, code, referrer: campaign.owner, at })) {
                        throw new BadRequestError('This wallet already has a referrer');
                    }
                    return { address: campaign.owner, code, joinedAt: new Date(at * 1000).toISOString() };
                }
            );
        },
        { prefix: '/api/referrals' }
    );

    // ------------------------------------------------------------------------------------
    // /api/admin/session - the two routes that CANNOT sit behind the session guard.
    //
    // Signing in IS how you get past it, and signing out clears a cookie: requiring the
    // session you are clearing would strand whoever needs it most. They are registered in
    // their own scope, so the guarded scope below has no exemption list to get wrong.
    // ------------------------------------------------------------------------------------

    app.post('/api/admin/session', { schema: { body: sessionInput } }, async (request, reply) => {
        if (adminSession === undefined) {
            throw new NotFoundError();
        }
        const cookie = await adminSession.signIn(
            request,
            request.body.address,
            sessionMessage(request.body.issuedAt),
            request.body.signature
        );
        return reply.status(204).header('set-cookie', cookie).send();
    });

    app.delete('/api/admin/session', (request, reply) => {
        if (adminSession !== undefined) {
            reply.header('set-cookie', adminSession.signOut(request));
        }
        return reply.status(204).send();
    });

    // ------------------------------------------------------------------------------------
    // /api/admin - everything here is behind the session BY DEFAULT. A route added to this
    // scope is guarded because of the scope it lands in, not because someone remembered.
    // ------------------------------------------------------------------------------------

    app.register(
        async (scope) => {
            // A child scope does not inherit the parent's type provider, so it is
            // re-applied here - without it every `query`, `body` and `params` is `unknown`.
            const admin = scope.withTypeProvider<TypeBoxTypeProvider>();

            admin.addHook('preHandler', async (request: FastifyRequest) => {
                if (adminSession === undefined) {
                    throw new UnauthorizedError('Admin session required');
                }
                adminSession.require(request);
            });

            admin.get(
                '/activity',
                { schema: { querystring: activityQuery, response: { 200: activityPage } } },
                ({ query }) => {
                    const limit = query.limit ?? 10;
                    const page = query.page ?? 1;
                    const total = store.tradesCount();
                    const outcomesCache = new Map<number, ReturnType<IndexStore['outcomesOf']>>();
                    const rows = store.recentTrades(limit, (page - 1) * limit).map((trade) => {
                        const outcomes = outcomesCache.get(trade.market_id) ?? store.outcomesOf(trade.market_id);
                        outcomesCache.set(trade.market_id, outcomes);
                        return presentTrade(trade, outcomes);
                    });
                    return { rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
                }
            );

            admin.get('/stats', { schema: { response: { 200: adminStats } } }, () => {
                const counts = store.statusCounts();
                const aggregate = store.aggregates(nowSeconds() - DAY);
                return {
                    markets: aggregate.markets,
                    open: counts[0],
                    paused: counts[1],
                    closed: counts[2],
                    resolved: counts[3],
                    voided: counts[4],
                    volume: aggregate.volume,
                    volume24h: aggregate.volume24h,
                    traders: aggregate.traders,
                    feesCollected: aggregate.fees,
                    tvl: aggregate.tvl
                };
            });

            admin.get(
                '/markets',
                { schema: { querystring: marketsQuery, response: { 200: adminMarketPage } } },
                ({ query }) => {
                    const result = pageOf(query, { includeEnded: true });
                    // One query for the whole page rather than one per row: the flag decides a
                    // badge, and a badge is not worth N round trips to sqlite.
                    const corrected = store.overridesIn(result.rows.map((row) => row.id));
                    const rows: AdminMarketRow[] = result.rows.map((row) => {
                        const presented = present(row);
                        return {
                            id: presented.id,
                            address: row.address,
                            title: presented.title,
                            emoji: row.emoji,
                            category: row.category,
                            status: statusName(row.status),
                            kind: row.kind === 1 ? 'pool' : 'amm',
                            winningOutcomeId: presented.winningOutcomeId,
                            outcomeCount: row.outcome_count,
                            createdAt: new Date(row.created_at * 1000).toISOString(),
                            startsAt: presented.startsAt,
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
            );

            // The start time a market waits on. It is stored, never enforced from here: the
            // market itself is PAUSED on chain, and this row only says when to lift that.
            admin.post(
                '/schedule',
                { schema: { body: scheduleInput, response: { 200: Type.Object({ ok: Type.Boolean() }) } } },
                async ({ body }) => {
                    const issued = Date.parse(body.issuedAt);
                    if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > SIGNATURE_WINDOW_MS) {
                        throw new BadRequestError('Stale signature');
                    }
                    const valid = await verifyMessage({
                        address: body.address as Address,
                        message: scheduleMessage(body.marketId, body.startsAt, body.issuedAt),
                        signature: body.signature as `0x${string}`
                    });
                    if (!valid) {
                        throw new ForbiddenError('Bad signature');
                    }
                    await requireAdmin(body.address);
                    const market = requireMarket(body.marketId);

                    if (body.startsAt === '') {
                        store.clearOpening(market.id);
                        return { ok: true };
                    }
                    const startsAt = Date.parse(body.startsAt);
                    if (!Number.isFinite(startsAt)) {
                        throw new BadRequestError('Unreadable start time');
                    }
                    // A start after the lock is a market that never trades at all - the pause
                    // would lift into a market whose betting window had already closed.
                    if (Math.floor(startsAt / 1000) >= market.lock_time) {
                        throw new BadRequestError('Start time is after trading locks');
                    }
                    store.scheduleOpening(market.id, Math.floor(startsAt / 1000));
                    return { ok: true };
                }
            );

            // Everything a deployed market lets an admin correct, plus what the chain still
            // holds. Both halves in one read: the dialog opens on the current text and has to
            // be able to show what it is departing from without a second request.
            admin.get(
                '/markets/:id/edit',
                { schema: { params: marketParams, response: { 200: marketEditState } } },
                ({ params }) => {
                    const row = requireMarket(params.id);
                    const current = textOf(store, row.id);
                    const origin = chainTextOf(store, row.id);
                    if (current === null || origin === null) {
                        throw new NotFoundError(`No market ${params.id}`);
                    }
                    const override = store.overrideOf(row.id);
                    const opening = store.opening(row.id);
                    return {
                        marketId: String(row.id),
                        ...current,
                        startsAt: opening === null ? null : new Date(opening.start_at * 1000).toISOString(),
                        locksAt: new Date(row.lock_time * 1000).toISOString(),
                        resolvesAt: new Date(row.resolve_time * 1000).toISOString(),
                        status: statusName(row.status),
                        origin,
                        editedAt: override === null ? null : new Date(override.edited_at * 1000).toISOString(),
                        editedBy: override?.edited_by ?? null
                    };
                }
            );

            // A correction to a market that is already running. This changes what the SITE
            // shows and nothing the chain knows - there is no setter to call, so the original
            // text stays on chain and stays readable, which is the honest shape for a
            // correction to something people have already staked money against.
            admin.post(
                '/market',
                { schema: { body: marketEditInput, response: { 200: marketEditResult } } },
                async ({ body }) => {
                    await requireSigned({ ...body, message: marketEditMessage(body.marketId, body.issuedAt) });
                    const row = requireMarket(body.marketId);

                    const current = textOf(store, row.id);
                    if (current === null) {
                        throw new NotFoundError(`No market ${body.marketId}`);
                    }
                    const next = normalise({
                        title: body.title,
                        emoji: body.emoji,
                        rules: body.rules,
                        image: body.image,
                        category: body.category,
                        outcomes: body.outcomes
                    } satisfies MarketText);

                    if (next.title.en.trim() === '') {
                        throw new BadRequestError('An English title is required');
                    }
                    if (next.outcomes.some((outcome) => outcome.label.en.trim() === '')) {
                        throw new BadRequestError('Every outcome needs an English label');
                    }
                    if (outcomeCountMismatch(current, next)) {
                        throw new BadRequestError(`This market has ${current.outcomes.length} outcomes on chain`);
                    }
                    if (reshapesBinary(current, next)) {
                        throw new ConflictError('Renaming the legs of a Yes/No market would change how it trades');
                    }

                    const { edited } = saveText(store, row.id, next, body.address, nowSeconds());
                    return { ok: true, edited };
                }
            );

            // Drops a correction. Separate from posting an empty edit on purpose: the message
            // signed for one is not replayable as the other.
            admin.post(
                '/market/revert',
                { schema: { body: marketRevertInput, response: { 200: marketEditResult } } },
                async ({ body }) => {
                    await requireSigned({ ...body, message: marketRevertMessage(body.marketId, body.issuedAt) });
                    const row = requireMarket(body.marketId);
                    revertText(store, row.id);
                    return { ok: true, edited: false };
                }
            );

            // ------------------------------------------------------------------------------
            // The bot: its settings, who may command it, and what they proposed.

            admin.get('/telegram', { schema: { response: { 200: telegramState } } }, () => telegramStateOf());

            admin.post(
                '/telegram/settings',
                { schema: { body: telegramSettingsInput, response: { 200: telegramSettings } } },
                async ({ body }) => {
                    await requireSigned({
                        ...body,
                        message: telegramSettingsMessage(body.backupMinutes, body.events, body.issuedAt)
                    });
                    const next = { backupMinutes: body.backupMinutes, events: body.events };
                    writeTelegramSettings(store, next);
                    // Saved FIRST, then applied. A running service that took the change but a
                    // database that did not would revert at the next restart, which is the
                    // confusing way round to fail.
                    options.telegram?.configure(next);
                    return next;
                }
            );

            admin.post(
                '/telegram/admins',
                { schema: { body: telegramAdminInput, response: { 200: telegramState } } },
                async ({ body }) => {
                    await requireSigned({ ...body, message: telegramAdminMessage(body.id, body.issuedAt) });
                    // Stored without its @, however it was typed: the column is compared
                    // against what Telegram reports, which never carries one.
                    const username = body.username.trim().replace(/^@/, '').slice(0, 64);
                    store.putTelegramAdmin(body.id, username, body.address.toLowerCase(), Date.now());
                    return telegramStateOf();
                }
            );

            admin.post(
                '/telegram/admins/remove',
                { schema: { body: telegramAdminRemoveInput, response: { 200: telegramState } } },
                async ({ body }) => {
                    await requireSigned({ ...body, message: telegramAdminRemoveMessage(body.id, body.issuedAt) });
                    store.removeTelegramAdmin(body.id);
                    return telegramStateOf();
                }
            );

            admin.get(
                '/proposals',
                { schema: { querystring: proposalQuery, response: { 200: proposalPage } } },
                ({ query }) => {
                    const limit = query.limit ?? 20;
                    const page = Math.max(query.page ?? 1, 1);
                    const state = query.state ?? '';
                    const total = store.countProposals(state);
                    const pages = Math.max(1, Math.ceil(total / limit));
                    const at = Math.min(page, pages);
                    return {
                        rows: store.listProposals(state, limit, (at - 1) * limit).map(presentProposal),
                        total,
                        page: at,
                        pages,
                        pending: store.countProposals('pending')
                    };
                }
            );

            // Approve or reject. Approving does NOT create anything: it records the verdict and
            // the console opens the create form seeded from the row, where an admin signs the
            // deploy with their own wallet. The server holds no key that could mint a market,
            // and a queue that could would be a much more interesting thing to compromise.
            admin.post(
                '/proposals/decide',
                { schema: { body: proposalDecideInput, response: { 200: proposalResult } } },
                async ({ body }) => {
                    await requireSigned({
                        ...body,
                        message: proposalDecideMessage(body.id, body.approve, body.issuedAt)
                    });
                    const row = store.proposalById(body.id);
                    if (row === null) {
                        throw new NotFoundError(`No proposal ${body.id}`);
                    }
                    const state: ProposalState = body.approve ? 'approved' : 'rejected';
                    const note = (body.note ?? '').trim().slice(0, 300);
                    // Conditional on still being pending, so two admins reaching for the same
                    // row do not both tell the proposer a different answer.
                    if (!store.decideProposal(body.id, state, body.address.toLowerCase(), note, Date.now())) {
                        throw new ConflictError(`Proposal ${body.id} was already decided`);
                    }

                    // Told, not left to be discovered. Best effort: the verdict is recorded
                    // either way, and a chat that cannot be reached must not undo it.
                    const verdict = body.approve
                        ? `✅ <b>Suggestion #${body.id} accepted</b>
An admin is creating it now.`
                        : `❌ <b>Suggestion #${body.id} declined</b>${
                              note === ''
                                  ? ''
                                  : `
${escapeHtml(note)}`
                          }`;
                    void options.telegram?.notify(row.tg_id, verdict);

                    return { ok: true, state };
                }
            );

            admin.post(
                '/feature',
                { schema: { body: featureInput, response: { 200: featureResult } } },
                async ({ body }) => {
                    const issued = Date.parse(body.issuedAt);
                    if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > SIGNATURE_WINDOW_MS) {
                        throw new BadRequestError('Stale signature');
                    }
                    const valid = await verifyMessage({
                        address: body.address as Address,
                        message: featureMessage(body.marketId, body.featured, body.issuedAt),
                        signature: body.signature as `0x${string}`
                    });
                    if (!valid) {
                        throw new ForbiddenError('Bad signature');
                    }
                    await requireAdmin(body.address);
                    requireMarket(body.marketId);
                    store.setFeatured(Number(body.marketId), body.featured);
                    return { ok: true, featured: body.featured };
                }
            );
        },
        { prefix: '/api/admin' }
    );

    // ------------------------------------------------------------------------------------
    // Static halves, mounted last so nothing shadows /api.
    // ------------------------------------------------------------------------------------

    // Content-addressed bytes: the name IS the hash, so a cached copy can never go stale.
    if (options.uploadDir !== undefined) {
        app.register(fastifyStatic, {
            root: resolve(options.uploadDir),
            prefix: '/uploads/',
            decorateReply: false,
            cacheControl: true,
            maxAge: '1y',
            immutable: true
        });
    }

    // The built SPA. Every unmatched GET that is not an /api call falls through to
    // index.html, which is what makes a deep link like /market/12 work on a hard reload.
    if (options.clientDir !== undefined) {
        const root = resolve(options.clientDir);
        // This one KEEPS `decorateReply` (the uploads mount above gave it up): the SPA
        // fallback below calls `reply.sendFile`, and only a decorating mount provides it.
        app.register(fastifyStatic, { root, prefix: '/' });
        app.setNotFoundHandler((request, reply) => {
            if (request.method !== 'GET' || request.url.startsWith('/api/')) {
                return reply.status(404).send({ error: 'Not found' });
            }
            return reply.sendFile('index.html', root);
        });
    }

    return app;
}
