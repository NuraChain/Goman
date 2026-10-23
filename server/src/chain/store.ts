import { AsyncLocalStorage } from 'node:async_hooks';

import type { Logger } from '@azerothjs/logger';
import { DataSource, MigrationExecutor, type EntityManager, type Logger as OrmLogger } from 'typeorm';

import { normalizeTag, type MarketTag, type TagCount, type TagMode } from '../wire.ts';
import { dataSourceOptions, type Connection } from './data-source.ts';

// The whole persistence layer, in one module on purpose: every SQL statement the indexer and the
// API run lives here, in PostgreSQL through TypeORM. TypeORM owns the pool, the transactions and
// the migrations; the statements are written out by hand, because their exact shape is what keeps
// a listing on an index.
//
// Amounts are DOUBLE PRECISION ether-unit floats - this is a display index; exact wei never
// leaves the chain (writes are signed client-side against contract state, not this DB). Ids and
// times are int8, which cross into JS as numbers (parseInt8, checked when the store opens).

/** The LP share id (`type(uint256).max`); balances of it are liquidity, not positions. */
const LP_TOKEN_ID = (2n ** 256n - 1n).toString();

/** A share balance below this is dust left by float rounding, not a position. */
const DUST = 1e-9;

/**
 * The contract's MarketStatus enum. Written out rather than derived from the wire names this
 * file deliberately does not import. There is no Closed: an Open market simply stops trading at
 * its lock time, so "trading is over" is `status = OPEN AND lock_time <= now`.
 *
 * A trade fee sits in the market's escrow until RESOLVED and is refunded on a cancel, so it is
 * only money the treasury received once its market is there.
 */
export const CHAIN_STATUS = { open: 0, resolved: 1, cancelled: 2 } as const;
const { open: OPEN, resolved: RESOLVED, cancelled: CANCELLED } = CHAIN_STATUS;

function nowSeconds(): number
{
    return Math.floor(Date.now() / 1000);
}

export interface MarketRow {
    id: number;
    address: string;
    status: number;
    category: string;
    /** The decoded Localized as JSON - every language the market was written in. A column
     *  pair per language would be twenty columns and a migration every time one is added. */
    title_json: string;
    emoji: string;
    rules_json: string;
    image: string;
    creator: string;
    created_at: number;
    lock_time: number;
    resolve_time: number;
    outcome_count: number;
    volume: number;
    liquidity: number;
    collected: number;
    winning_outcome: number | null;
    featured: number;
    search_text: string;
    kind: number;
}

/**
 * What a match is WORTH when a search is ranked. Tags dominate deliberately: a tag is the one
 * signal an author put there on purpose to say what the market is about, where a title match
 * can be any word that happens to appear.
 *
 * The scores are summed per query term, so a market matching two of the terms as tags scores
 * twice - which is what makes `football iran` rank an item carrying BOTH above one carrying
 * either. A prefix match is the same subquery as the exact one with a wider bound, so an
 * exact tag collects both and always outranks a prefix-only hit.
 */
const RANK = { tag: 100, tagPrefix: 50, title: 40, rules: 20, text: 10 } as const;

/** Words past this in one search box are noise, and each one costs two subqueries a row. */
const TERMS_MAX = 8;

/** Above every character a tag can contain, so `slug >= q AND slug < q + this` is a prefix
 *  scan the UNIQUE index answers with a range seek rather than a table scan. */
const HIGHEST = String.fromCodePoint(0x10ffff);

export interface OutcomeRow {
    market_id: number;
    idx: number;
    oid: string;

    /** The decoded Localized as JSON; see {@link MarketRow.title_json}. */
    label_json: string;
    icon: string;
    price: number;
}

export interface TradeRow {
    id: string;
    market_id: number;
    account: string;
    outcome_idx: number;
    action: string;
    amount: number;
    shares: number;
    price: number;

    /**
     * This trade's fee, in ether units, as FeeMath charged it. The market ESCROWS it: the
     * treasury only receives it if the market resolves, and a cancel refunds it. Referral
     * earnings therefore count it on resolved markets only (see {@link RESOLVED}). Zero for a
     * pool bet, whose house fee comes off the whole pot at resolution.
     */
    fee: number;
    at: number;
    block: number;
}

export interface BalanceRow {
    account: string;
    market_id: number;
    token_id: string;
    shares: number;
    first_at: number;
}

/** One redemption, as a P&L curve reads it. */
export interface ClaimRow {
    market_id: number;
    amount: number;
    at: number;
}

/** "The last known price of (market, outcomeIdx) at or before t", answered from a read already made. */
export type PriceAt = (marketId: number, outcomeIdx: number, at: number) => number | null;

function priceKey(marketId: number, outcomeIdx: number, at: number): string
{
    return `${ marketId }/${ outcomeIdx }/${ at }`;
}

/** One wallet invited to prepare markets, as stored. */
export interface MarketCreatorRow {
    /** Lowercased hex - the allowlist key. */
    address: string;

    /** A name for whoever holds the wallet, so the console's list is readable. Display only. */
    label: string;

    /** The wallet address of the console admin who invited them. */
    added_by: string;
    added_at: number;
}

/** One proposed market, as stored. `draft` is the create form's querystring, opaque here. */
export interface ProposalRow {
    id: number;
    draft: string;
    proposer: string;

    /** 'pending' | 'accepted' | 'declined' - widened, because the column is TEXT and a
     *  hand-edited database must not be able to type-check its way into the console. */
    state: string;
    note: string;
    created_at: number;
    decided_at: number;
    decided_by: string;
}

/**
 * An admin's correction to a market that is already DEPLOYED. The contracts write the title,
 * rules, image, category and outcome names once in `initialize` and expose no setter for any
 * of them, so without this a typo in a live market is permanent.
 *
 * The patch is applied to the `markets` and `outcomes` rows rather than merged at read time,
 * because those rows are what every filter, sort and search runs against - an overlay living
 * only in the presenter would leave a corrected market unfindable by its correction. What
 * makes that safe is `origin_json`: the chain text the FIRST edit displaced, kept so a revert
 * needs no RPC and so the console can always show what the chain still says.
 *
 * Off-chain like `categories`, so a schema bump does not drop it - but it IS wiped when the
 * chain underneath changes, because a market id on a different chain is a different market
 * and the correction would land on a stranger.
 */
export interface MarketOverrideRow {
    market_id: number;

    /** The fields that DIFFER from the chain, as JSON. An absent field is not overridden. */
    patch_json: string;

    /** What those same fields held on chain, as JSON. */
    origin_json: string;
    edited_by: string;
    edited_at: number;
}

export interface ReferralCampaignRow {
    code: string;
    owner: string;
    name: string;
    created_at: number;
}

export interface ReferralRow {
    account: string;
    code: string;
    referrer: string;
    at: number;
}

export interface MarketFilter {
    search?: string;

    /** Normalised tag slugs to filter by; empty or absent means no tag filter. */
    tags?: readonly string[];

    /** How {@link tags} combine. `any` (the default) is OR, `all` is AND. */
    tagMode?: TagMode;
    category?: string;
    /** A {@link CHAIN_STATUS} value. */
    status?: number;

    /** With an Open `status`: true keeps only markets past their lock time, false only those
     *  still trading. */
    locked?: boolean;
    featured?: boolean;
    exclude?: number;
    ids?: number[];

    /** Drops every market whose trading is over: settled, or Open past its lock time. */
    liveOnly?: boolean;

    sort: 'volume' | 'newest' | 'ending';
    page: number;
    limit: number;
}

/** The words a search box was filled with. Repeats collapse - typing one word twice must not
 *  make it count twice, in the WHERE or in the score. */
function searchTerms(search: string | undefined): string[]
{
    const trimmed = (search ?? '').trim().toLowerCase();
    return trimmed === '' ? [] : [...new Set(trimmed.split(/\s+/))].slice(0, TERMS_MAX);
}

/** Collects a statement's values as it is assembled, handing back each one's `$n` placeholder. */
class Params
{
    public readonly values: unknown[] = [];

    public bind(value: unknown): string
    {
        this.values.push(value);
        return `$${ this.values.length }`;
    }
}

/** A market's count of tags whose slug is exactly `slug`. */
function exactTags(slug: string): string
{
    return `(SELECT COUNT(*) FROM market_tags mt JOIN tags t ON t.id = mt.tag_id
        WHERE mt.market_id = markets.id AND t.slug = ${ slug })`;
}

/** The same count over a prefix RANGE, which contains the exact match - so an exact tag
 *  collects this score as well and can never be outranked by a mere prefix hit. */
function prefixTags(from: string, below: string): string
{
    return `(SELECT COUNT(*) FROM market_tags mt JOIN tags t ON t.id = mt.tag_id
        WHERE mt.market_id = markets.id AND t.slug >= ${ from } AND t.slug < ${ below })`;
}

/**
 * The relevance score, as a SQL expression whose values are bound into `params`, or null when
 * there is nothing to rank by.
 *
 * Every term contributes independently and the contributions ADD UP, which is the whole
 * design: `football iran` scores a market tagged both at twice what it scores one tagged
 * either, so "matched several tags" needs no rule of its own. A term matching as a TAG is
 * worth an order of magnitude more than the same word turning up in the body text.
 *
 * Tags named by the `tags=` filter score too. Under the default OR mode that is what floats
 * the markets carrying all of them to the top of a deliberately wider net.
 *
 * ponytail: correlated subqueries, two per term, over the rows the WHERE has already cut
 * down to. Comfortable at index scale and it keeps the ranking in one readable expression -
 * if the market table ever outgrows it, this is the piece to replace with a join onto a
 * materialised score.
 */
function rankOf(terms: readonly string[], tags: readonly string[], params: Params): string | null
{
    const parts: string[] = [];

    for (const term of terms)
    {
        const slug = normalizeTag(term);
        if (slug !== '')
        {
            parts.push(`${ exactTags(params.bind(slug)) } * ${ RANK.tag }`);
            parts.push(`${ prefixTags(params.bind(slug), params.bind(`${ slug }${ HIGHEST }`)) } * ${ RANK.tagPrefix }`);
        }
        const like = params.bind(`%${ term }%`);
        parts.push(`(CASE WHEN LOWER(title_json) LIKE ${ like } THEN ${ RANK.title } ELSE 0 END)`);
        parts.push(`(CASE WHEN LOWER(rules_json) LIKE ${ like } THEN ${ RANK.rules } ELSE 0 END)`);
        parts.push(`(CASE WHEN search_text LIKE ${ like } THEN ${ RANK.text } ELSE 0 END)`);
    }

    for (const slug of tags)
    {
        parts.push(`${ exactTags(params.bind(slug)) } * ${ RANK.tag }`);
    }

    return parts.length === 0 ? null : parts.join(' + ');
}

/** A statement slower than this is logged with its text, when the store was handed a log. */
const SLOW_QUERY_MS = 1_000;

/**
 * Every table, with the key a dump orders it by. No table refers to another, so a restore may
 * write them in any order; this one reads top to bottom.
 */
const DUMP_TABLES: ReadonlyArray<readonly [table: string, key: string]> = [
    ['meta', 'key'],
    ['markets', 'id'],
    ['outcomes', 'market_id, idx'],
    ['trades', 'id'],
    ['price_points', 'id'],
    ['balances', 'account, market_id, token_id'],
    ['claims', 'id'],
    ['categories', 'id'],
    ['referral_campaigns', 'code'],
    ['referrals', 'account'],
    ['market_overrides', 'market_id'],
    ['chain_categories', 'id'],
    ['chain_category_names', 'id, lang'],
    ['app_settings', 'key'],
    ['market_creators', 'address'],
    ['proposals', 'id'],
    ['tags', 'id'],
    ['market_tags', 'market_id, tag_id']
];

/** The BIGSERIAL keys. A restore writes their values explicitly, so each sequence has to be moved
 *  past the rows it brought back or the next insert collides with one. */
const SERIALS = ['price_points', 'proposals', 'tags'] as const;

/** Rows per INSERT in a dump: short enough to read, long enough that a restore is not a statement a row. */
const DUMP_ROWS_PER_INSERT = 200;

/** One value as a SQL literal. Text has its quotes doubled - a dump is restored with
 *  standard_conforming_strings on, so a backslash is only a backslash. */
function literal(value: unknown): string
{
    if (value === null || value === undefined)
    {
        return 'NULL';
    }
    if (typeof value === 'number')
    {
        // NaN and the infinities are only literals as quoted text.
        return Number.isFinite(value) ? String(value) : `'${ String(value) }'`;
    }
    if (typeof value === 'string')
    {
        return `'${ value.replaceAll('\'', '\'\'') }'`;
    }
    throw new Error(`index store: cannot write a ${ typeof value } into a dump`);
}

/** TypeORM's reports, into this server's log: a migration that failed, and statements that crawl. */
class IndexLog implements OrmLogger
{
    readonly #log: Logger;

    constructor(log: Logger)
    {
        this.#log = log;
    }

    public logQuery(): void
    {
        // Every statement would drown the log; the slow ones are what is worth reading.
    }

    public logQueryError(): void
    {
        // A failed statement rejects to its caller, which decides whether it is worth a line.
    }

    public logQuerySlow(time: number, query: string): void
    {
        this.#log.warn('slow index query', { ms: time, query: query.replace(/\s+/g, ' ').trim().slice(0, 500) });
    }

    public logSchemaBuild(): void
    {
        // The schema is the migration's to build; nothing is synchronized from the entities.
    }

    public logMigration(message: string): void
    {
        // TypeORM speaks here only when a migration FAILED; the store logs the ones that ran.
        this.#log.warn('index migration failed', { message });
    }

    public log(level: 'log' | 'info' | 'warn', message: unknown): void
    {
        if (level === 'warn')
        {
            this.#log.warn('typeorm', { message: String(message) });
        }
    }
}

/**
 * Refuses a database this index cannot be correct against, before a single row is written.
 *
 * An int8 that came back as text means something in this process turned pg's parseInt8 off - it is
 * one global switch - and every id and time would cross as a string. An encoding other than UTF8
 * would refuse the first title written outside it, and every one after.
 */
async function verify(source: DataSource): Promise<void>
{
    const [row] = await source.query('SELECT 1::int8 AS one, current_setting(\'server_encoding\') AS encoding') as Array<{
        one: unknown;
        encoding: unknown;
    }>;
    if (typeof row?.one !== 'number')
    {
        throw new Error('index store: an int8 came back as text - pg\'s parseInt8 is off in this process');
    }
    if (row.encoding !== 'UTF8')
    {
        throw new Error(`index store: the database encoding is ${ String(row.encoding) }; the index needs UTF8`);
    }
}

/**
 * Applies every pending migration, on ONE connection, inside ONE transaction.
 *
 * The advisory lock belongs to that transaction, so it can never be left behind on a pooled
 * connection: two processes booting at once - a rolling deploy - take turns rather than both
 * creating the same tables, and the second finds nothing pending. Answers with the names of the
 * migrations it applied, which on most boots is none.
 */
async function migrate(source: DataSource, schema: string): Promise<string[]>
{
    const runner = source.createQueryRunner();
    try
    {
        await runner.connect();
        await runner.startTransaction();
        await runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`goman:migrate:${ schema }`]);
        // A migration over a long chain may rewrite every row; the default statement cap is for requests.
        await runner.query('SET LOCAL statement_timeout = 0');
        const executor = new MigrationExecutor(source, runner);
        // Joins the transaction above rather than opening its own.
        executor.transaction = 'all';
        const applied = await executor.executePendingMigrations();
        await runner.commitTransaction();
        return applied.map((migration) => migration.name);
    }
    catch (error)
    {
        if (runner.isTransactionActive)
        {
            await runner.rollbackTransaction().catch(() => undefined);
        }
        throw error;
    }
    finally
    {
        await runner.release();
    }
}

export interface StoreOptions {
    /** Where the index lives - see data-source.ts. */
    connection: Connection;

    /** Where migrations and slow statements are reported. Optional: a test runs quiet. */
    log?: Logger;

    /**
     * Refuse, rather than run, a query made outside the transaction this store has open.
     *
     * Test-only. While a transaction is open, a query that does not carry its frame either belongs
     * to a concurrent caller - which simply takes another pooled connection - or ESCAPED the
     * transaction it was written inside, and then commits on its own whatever the transaction
     * decides. A suite that never runs two callers at once can only see the second kind, and
     * failing it on the spot names the call.
     */
    strict?: boolean;
}

/** The marker a transaction leaves on every call made inside it. */
interface Frame {
    /** The transaction's own connection; every call made under this frame goes through it. */
    manager: EntityManager;

    /** False from the moment the transaction's work settles; a later call made under it is a bug. */
    live: boolean;

    readOnly: boolean;
}

const DEAD_FRAME = 'index store: a call outlived the transaction it was made in';
const ESCAPED = 'index store: a query ran outside the transaction this store has open';
const READ_ONLY = 'index store: a write inside a read-only snapshot';
const CLOSED = 'index store is closed';

export class IndexStore
{
    readonly #source: DataSource;

    /** Per store: a frame of one store says nothing about another. */
    readonly #frames = new AsyncLocalStorage<Frame>();

    readonly #strict: boolean;

    /** Transactions currently open on this store - what `strict` checks a frameless call against. */
    #open = 0;
    #closed = false;

    private constructor(source: DataSource, strict: boolean)
    {
        this.#source = source;
        this.#strict = strict;
    }

    /** Connects, refuses a database the index cannot be correct against, and migrates it. */
    public static async open(options: StoreOptions): Promise<IndexStore>
    {
        const settings = dataSourceOptions(options.connection);
        const source = new DataSource(options.log === undefined
            ? settings
            : { ...settings, logger: new IndexLog(options.log), maxQueryExecutionTime: SLOW_QUERY_MS });

        await source.initialize();
        try
        {
            await verify(source);
            const schema = settings.schema ?? 'public';
            const applied = await migrate(source, schema);
            if (applied.length > 0)
            {
                options.log?.info('index migrated', { schema, migrations: applied });
            }
            return new IndexStore(source, options.strict ?? false);
        }
        catch (error)
        {
            await source.destroy().catch(() => undefined);
            throw error;
        }
    }

    /**
     * The connection a call runs on: its transaction's own, when it is made inside one of this
     * store's - otherwise the pool. Taken fresh for EVERY statement, never kept: a manager held
     * across an await would outlive the transaction it belonged to.
     */
    #manager(label: string, writes: boolean): EntityManager
    {
        if (this.#closed)
        {
            throw new Error(CLOSED);
        }
        const frame = this.#frames.getStore();
        if (frame !== undefined)
        {
            if (!frame.live)
            {
                throw new Error(DEAD_FRAME);
            }
            if (writes && frame.readOnly)
            {
                throw new Error(READ_ONLY);
            }
            return frame.manager;
        }
        if (this.#strict && this.#open > 0)
        {
            throw new Error(`${ ESCAPED } ('${ label }')`);
        }
        return this.#source.manager;
    }

    /**
     * One statement's rows. A write whose outcome is read answers through a SELECT over its
     * RETURNING (`WITH gone AS (DELETE ... RETURNING ...) SELECT ...`): TypeORM hands an UPDATE
     * or a DELETE back as `[rows, count]` rather than as rows.
     */
    async #rows<T>(label: string, sql: string, params: readonly unknown[] = [], writes = false): Promise<T[]>
    {
        return await this.#manager(label, writes).query(sql, [...params]) as T[];
    }

    /** One statement's first row, or undefined. */
    async #row<T>(label: string, sql: string, params: readonly unknown[] = []): Promise<T | undefined>
    {
        return (await this.#rows<T>(label, sql, params))[0];
    }

    /** A write whose result nothing reads. */
    async #run(label: string, sql: string, params: readonly unknown[] = []): Promise<void>
    {
        await this.#rows(label, sql, params, true);
    }

    /**
     * Runs `work` inside ONE transaction, on one connection. A call made inside it - a nested
     * `transaction()` included - JOINS it, so a batch commits or vanishes as one.
     *
     * Nothing inside `work` may wait on the network, run two store calls at once, or leave one
     * running after it returns: the transaction holds its connection and its row locks until it
     * settles, and a call that outlives it is refused rather than committed on its own.
     */
    public transaction<T>(work: () => Promise<T>): Promise<T>
    {
        return this.#atomically('transaction', false, work);
    }

    /**
     * A transaction that also runs alone among every caller asking under the same `lock` - for a
     * check followed by a write, where two callers checking at once would both pass. The lock is
     * the transaction's own: it goes with the commit, and a failure cannot leave it held.
     */
    public exclusive<T>(lock: string, work: () => Promise<T>): Promise<T>
    {
        return this.#atomically('exclusive', false, async () =>
        {
            await this.#rows('exclusive', 'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`goman:${ lock }`]);
            return work();
        });
    }

    /**
     * Runs read-only `work` against ONE consistent state of the index, with no statement cap - for
     * the reads that are many statements but one answer, and must not straddle an ingest commit.
     * A write inside it is refused.
     */
    public snapshot<T>(work: () => Promise<T>): Promise<T>
    {
        return this.#atomically('snapshot', true, work);
    }

    async #atomically<T>(label: string, readOnly: boolean, work: () => Promise<T>): Promise<T>
    {
        if (this.#closed)
        {
            throw new Error(CLOSED);
        }
        const outer = this.#frames.getStore();
        if (outer !== undefined)
        {
            if (!outer.live)
            {
                throw new Error(DEAD_FRAME);
            }
            if (!readOnly && outer.readOnly)
            {
                throw new Error(READ_ONLY);
            }
            return work();
        }
        if (this.#strict && this.#open > 0)
        {
            throw new Error(`${ ESCAPED } ('${ label }')`);
        }

        const runner = this.#source.createQueryRunner();
        this.#open += 1;
        try
        {
            await runner.connect();
            await runner.startTransaction(readOnly ? 'REPEATABLE READ' : undefined);
            if (readOnly)
            {
                await runner.query('SET TRANSACTION READ ONLY');
                await runner.query('SET LOCAL statement_timeout = 0');
            }
            const frame: Frame = { manager: runner.manager, live: true, readOnly };
            try
            {
                // Dead the moment `work` settles - before COMMIT, so nothing it left running can
                // slip a statement in after the outcome is decided.
                const result = await this.#frames.run(frame, () => work().finally(() =>
                {
                    frame.live = false;
                }));
                await runner.commitTransaction();
                return result;
            }
            catch (error)
            {
                frame.live = false;
                if (runner.isTransactionActive)
                {
                    await runner.rollbackTransaction().catch(() => undefined);
                }
                throw error;
            }
        }
        finally
        {
            this.#open -= 1;
            await runner.release();
        }
    }

    /** Closes the pool. A second close is a no-op; any call after the first is refused. */
    public async close(): Promise<void>
    {
        if (this.#closed)
        {
            return;
        }
        this.#closed = true;
        await this.#source.destroy();
    }

    /**
     * PostgreSQL's plan for a query, as EXPLAIN's text.
     *
     * Here so that "this uses the index" can be ASSERTED rather than assumed. A tag lookup that
     * quietly degrades to a full scan is fast on a development database and slow on a real one,
     * which is the class of regression no timing test on a fixture ever catches. Sequential and
     * bitmap scans are priced out for the one statement: on a near-empty table a scan IS the
     * cheapest plan whatever indexes exist, so only then does the plan say whether an index can
     * serve the query at all.
     */
    public queryPlan(sql: string, params: readonly unknown[] = []): Promise<string>
    {
        return this.snapshot(async () =>
        {
            await this.#rows('queryPlan', 'SET LOCAL enable_seqscan = off');
            await this.#rows('queryPlan', 'SET LOCAL enable_bitmapscan = off');
            const rows = await this.#rows<{ 'QUERY PLAN': string }>('queryPlan', `EXPLAIN (COSTS OFF) ${ sql }`, params);
            return rows.map((row) => row['QUERY PLAN']).join('\n');
        });
    }

    /**
     * The whole index as one SQL script, from ONE consistent state of it - what the Telegram backup
     * carries. Data only: it restores into a database the server has already migrated, in one
     * transaction that first empties every table, so running it twice gives the same index.
     */
    public dumpSql(): Promise<string>
    {
        return this.snapshot(async () =>
        {
            const tables = DUMP_TABLES.map(([table]) => table);
            const out = [
                `-- Goman index, ${ new Date().toISOString() }.`,
                '-- Restore into a database the server has migrated - start it once against an empty one, then',
                '-- stop it - with: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <this file>',
                'SET standard_conforming_strings = on;',
                'SET client_encoding = \'UTF8\';',
                'BEGIN;',
                `TRUNCATE ${ tables.join(', ') };`
            ];
            for (const [table, key] of DUMP_TABLES)
            {
                const rows = await this.#rows<Record<string, unknown>>('dumpSql', `SELECT * FROM ${ table } ORDER BY ${ key }`);
                if (rows.length === 0)
                {
                    continue;
                }
                const columns = Object.keys(rows[0]);
                for (let at = 0; at < rows.length; at += DUMP_ROWS_PER_INSERT)
                {
                    const values = rows
                        .slice(at, at + DUMP_ROWS_PER_INSERT)
                        .map((row) => `(${ columns.map((column) => literal(row[column])).join(', ') })`);
                    out.push(`INSERT INTO ${ table } (${ columns.join(', ') }) VALUES\n${ values.join(',\n') };`);
                }
            }
            for (const table of SERIALS)
            {
                out.push(`SELECT setval(pg_get_serial_sequence('${ table }', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${ table };`);
            }
            out.push('COMMIT;', '');
            return out.join('\n');
        });
    }

    // ------------------------------------------------------------------------------------
    // Meta / cursor
    // ------------------------------------------------------------------------------------

    public async getMeta(key: string): Promise<string | null>
    {
        return (await this.#row<{ value: string }>('getMeta', 'SELECT value FROM meta WHERE key = $1', [key]))?.value ?? null;
    }

    public setMeta(key: string, value: string): Promise<void>
    {
        return this.#run('setMeta',
            'INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
            [key, value]);
    }

    /**
     * The stale-index guard: this index is everything ONE factory on ONE chain has emitted, so
     * it starts over whenever either changes.
     *
     * The chain half catches a restarted local node. The FACTORY half catches a redeploy, which
     * is not a cosmetic difference: market ids are that registry's own counter, so a new factory
     * hands out id 0 again and every row of the old one collides with it - silently, because
     * inserting a market that already exists does nothing.
     *
     * One transaction, so the wipe and the new origin land together or not at all.
     *
     * @param genesisHash The chain's genesis block hash.
     * @param factory The factory this index reads.
     */
    public ensureChain(genesisHash: string, factory: string): Promise<boolean>
    {
        return this.transaction(async () =>
        {
            const origin = `${ genesisHash }|${ factory.toLowerCase() }`;
            // 'genesis' is what pre-factory-aware indexes stored; reading it here means an index
            // built before this guard starts over once, which is correct - it cannot know which
            // factory it was filled from.
            const known = (await this.getMeta('origin')) ?? (await this.getMeta('genesis'));
            if (known === origin)
            {
                return false;
            }
            if (known !== null)
            {
                // Everything the chain derived, and the corrections made to markets that are now
                // somebody else's - but not what the chain never had: categories, campaigns and
                // sign-ups, settings, invitations and proposals all survive.
                for (const table of ['markets', 'outcomes', 'trades', 'price_points', 'balances', 'claims', 'market_overrides',
                    'chain_categories', 'chain_category_names', 'tags', 'market_tags', 'meta'])
                {
                    await this.#run('ensureChain', `DELETE FROM ${ table }`);
                }
            }
            await this.setMeta('origin', origin);
            await this.setMeta('cursor', '-1');
            return known !== null;
        });
    }

    public async cursor(): Promise<number>
    {
        return Number((await this.getMeta('cursor')) ?? '-1');
    }

    public setCursor(block: number): Promise<void>
    {
        return this.setMeta('cursor', String(block));
    }

    // ------------------------------------------------------------------------------------
    // Ingest writes
    // ------------------------------------------------------------------------------------

    public insertMarket(row: MarketRow, outcomes: OutcomeRow[]): Promise<void>
    {
        return this.transaction(async () =>
        {
            await this.#run('insertMarket', `
                INSERT INTO markets (id, address, status, category, title_json, emoji, rules_json,
                    image, creator, created_at, lock_time, resolve_time, outcome_count, volume, liquidity, collected,
                    winning_outcome, featured, search_text, kind)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
                ON CONFLICT (id) DO NOTHING`, [
                row.id,
                row.address,
                row.status,
                row.category,
                row.title_json,
                row.emoji,
                row.rules_json,
                row.image,
                row.creator,
                row.created_at,
                row.lock_time,
                row.resolve_time,
                row.outcome_count,
                row.volume,
                row.liquidity,
                row.collected,
                row.winning_outcome,
                row.featured,
                row.search_text,
                row.kind
            ]);
            for (const outcome of outcomes)
            {
                await this.#run('insertMarket', `
                    INSERT INTO outcomes (market_id, idx, oid, label_json, icon, price) VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (market_id, idx) DO NOTHING`,
                [outcome.market_id, outcome.idx, outcome.oid, outcome.label_json, outcome.icon, outcome.price]);
            }
        });
    }

    /** Refreshes an existing market's live numbers after a trade or liquidity event. */
    public setPrices(marketId: number, prices: number[], liquidity: number, at: number): Promise<void>
    {
        const idx = prices.map((_, at) => at);
        return this.transaction(async () =>
        {
            await this.#run('setPrices', `
                UPDATE outcomes AS o SET price = mark.price
                FROM unnest($2::int[], $3::float8[]) AS mark(idx, price)
                WHERE o.market_id = $1 AND o.idx = mark.idx`, [marketId, idx, prices]);
            await this.#run('setPrices', `
                INSERT INTO price_points (market_id, outcome_idx, at, price)
                SELECT $1::bigint, mark.idx, $2::bigint, mark.price FROM unnest($3::int[], $4::float8[]) WITH ORDINALITY AS mark(idx, price, n)
                ORDER BY mark.n`, [marketId, at, idx, prices]);
            await this.#run('setPrices', 'UPDATE markets SET liquidity = $1 WHERE id = $2', [liquidity, marketId]);
        });
    }

    public setStatus(marketId: number, status: number, winningOutcome: number | null): Promise<void>
    {
        return this.#run('setStatus',
            'UPDATE markets SET status = $1, winning_outcome = COALESCE($2::int, winning_outcome) WHERE id = $3',
            [status, winningOutcome, marketId]);
    }

    public setFeatured(marketId: number, featured: boolean): Promise<void>
    {
        return this.#run('setFeatured', 'UPDATE markets SET featured = $1 WHERE id = $2', [featured ? 1 : 0, marketId]);
    }

    /** A trade, and its amount added to its market's volume - only when the trade is new, so a
     *  replayed log counts once. One statement, so the two cannot land apart. */
    public insertTrade(row: TradeRow): Promise<void>
    {
        return this.#run('insertTrade', `
            WITH inserted AS (
                INSERT INTO trades (id, market_id, account, outcome_idx, action, amount, shares, price, fee, at, block)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) ON CONFLICT (id) DO NOTHING
                RETURNING market_id, amount
            )
            UPDATE markets SET volume = markets.volume + inserted.amount FROM inserted WHERE markets.id = inserted.market_id`, [
            row.id,
            row.market_id,
            row.account,
            row.outcome_idx,
            row.action,
            row.amount,
            row.shares,
            row.price,
            row.fee,
            row.at,
            row.block
        ]);
    }

    /** One historical price mark; trades insert their own fill price so backfills keep shape. */
    public insertPricePoint(marketId: number, outcomeIdx: number, at: number, price: number): Promise<void>
    {
        return this.#run('insertPricePoint',
            'INSERT INTO price_points (market_id, outcome_idx, at, price) VALUES ($1, $2, $3, $4)',
            [marketId, outcomeIdx, at, price]);
    }

    public applyBalanceDelta(account: string, marketId: number, tokenId: string, delta: number, at: number): Promise<void>
    {
        return this.#run('applyBalanceDelta', `
            INSERT INTO balances (account, market_id, token_id, shares, first_at) VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (account, market_id, token_id) DO UPDATE SET shares = balances.shares + EXCLUDED.shares`,
        [account, marketId, tokenId, delta, at]);
    }

    public insertClaim(id: string, marketId: number, account: string, amount: number, at: number): Promise<void>
    {
        return this.#run('insertClaim',
            'INSERT INTO claims (id, market_id, account, amount, at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
            [id, marketId, account, amount, at]);
    }

    public addCollected(marketId: number, amount: number): Promise<void>
    {
        return this.#run('addCollected', 'UPDATE markets SET collected = collected + $1 WHERE id = $2', [amount, marketId]);
    }

    /** Which of these addresses are markets the index holds, as lowercased address -> id. One
     *  read for a whole chunk of logs, where a lookup per log would be a round trip each. */
    public async marketIdsByAddresses(addresses: readonly string[]): Promise<Map<string, number>>
    {
        const wanted = [...new Set(addresses.map((address) => address.toLowerCase()))];
        if (wanted.length === 0)
        {
            return new Map();
        }
        const rows = await this.#rows<{ id: number; address: string }>('marketIdsByAddresses',
            'SELECT id, address FROM markets WHERE address = ANY($1::text[])', [wanted]);
        return new Map(rows.map((row) => [row.address, row.id]));
    }

    // ------------------------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------------------------

    public async marketById(id: number): Promise<MarketRow | null>
    {
        return (await this.#row<MarketRow>('marketById', 'SELECT * FROM markets WHERE id = $1', [id])) ?? null;
    }

    /** Several markets in one read, keyed by id; an id the index does not hold is absent. */
    public async marketsByIds(ids: readonly number[]): Promise<Map<number, MarketRow>>
    {
        const wanted = [...new Set(ids)];
        if (wanted.length === 0)
        {
            return new Map();
        }
        const rows = await this.#rows<MarketRow>('marketsByIds', 'SELECT * FROM markets WHERE id = ANY($1::bigint[])', [wanted]);
        return new Map(rows.map((row) => [row.id, row]));
    }

    public outcomesOf(marketId: number): Promise<OutcomeRow[]>
    {
        return this.#rows<OutcomeRow>('outcomesOf', 'SELECT * FROM outcomes WHERE market_id = $1 ORDER BY idx', [marketId]);
    }

    /** Every listed market's outcomes in index order, keyed by market id - one read for a page. */
    public async outcomesOfMarkets(marketIds: readonly number[]): Promise<Map<number, OutcomeRow[]>>
    {
        const byMarket = new Map<number, OutcomeRow[]>();
        const wanted = [...new Set(marketIds)];
        if (wanted.length === 0)
        {
            return byMarket;
        }
        const rows = await this.#rows<OutcomeRow>('outcomesOfMarkets',
            'SELECT * FROM outcomes WHERE market_id = ANY($1::bigint[]) ORDER BY market_id, idx', [wanted]);
        for (const row of rows)
        {
            const list = byMarket.get(row.market_id) ?? [];
            list.push(row);
            byMarket.set(row.market_id, list);
        }
        return byMarket;
    }

    // ------------------------------------------------------------------------------------
    // Tags
    // ------------------------------------------------------------------------------------

    /**
     * Replaces a market's tags with `tags`, minting any subject nobody has used before.
     *
     * The whole set is written at once rather than diffed: a market's tags arrive as a list
     * from the envelope or from an admin's correction, and a set difference is more code than
     * the delete-and-reinsert of at most a dozen rows it would save.
     *
     * `ON CONFLICT (slug) DO NOTHING` is what makes the feature case-insensitive at the
     * storage layer too: whichever market is indexed first NAMES the tag, and every later one
     * joins that row rather than minting a second spelling of the same subject.
     */
    public setMarketTags(marketId: number, tags: readonly MarketTag[]): Promise<void>
    {
        const slugs = tags.map((tag) => tag.slug);
        return this.transaction(async () =>
        {
            await this.#run('setMarketTags', 'DELETE FROM market_tags WHERE market_id = $1', [marketId]);
            await this.#run('setMarketTags', `
                INSERT INTO tags (slug, name, created_at)
                SELECT tag.slug, tag.name, $3::bigint FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS tag(slug, name, n)
                ORDER BY tag.n
                ON CONFLICT (slug) DO NOTHING`, [slugs, tags.map((tag) => tag.name), nowSeconds()]);
            await this.#run('setMarketTags', `
                INSERT INTO market_tags (market_id, tag_id) SELECT $1::bigint, id FROM tags WHERE slug = ANY($2::text[])
                ON CONFLICT DO NOTHING`, [marketId, slugs]);
            // A subject nothing is filed under any more is not a subject. Left behind, it would
            // keep completing in the autocomplete and then return an empty page when picked.
            // ponytail: a full sweep, which costs nothing on a table of subjects - scope it to
            // the ids just unlinked if the vocabulary ever grows enough for it to show.
            await this.#run('setMarketTags', 'DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM market_tags WHERE tag_id = tags.id)');
        });
    }

    public tagsOf(marketId: number): Promise<MarketTag[]>
    {
        return this.#rows<MarketTag>('tagsOf', `
            SELECT t.slug AS slug, t.name AS name FROM market_tags mt
            JOIN tags t ON t.id = mt.tag_id WHERE mt.market_id = $1 ORDER BY t.slug`, [marketId]);
    }

    /**
     * Every listed market's tags in ONE query, keyed by market id.
     *
     * The reason this exists rather than a `tagsOf` per row: a page is twelve markets, and
     * twelve extra round trips to print a chip each is the N+1 that makes a list endpoint
     * slow for a reason no reader could name.
     */
    public async tagsOfMarkets(marketIds: readonly number[]): Promise<Map<number, MarketTag[]>>
    {
        const byMarket = new Map<number, MarketTag[]>();
        if (marketIds.length === 0)
        {
            return byMarket;
        }
        const rows = await this.#rows<{ market_id: number; slug: string; name: string }>('tagsOfMarkets', `
            SELECT mt.market_id AS market_id, t.slug AS slug, t.name AS name FROM market_tags mt
            JOIN tags t ON t.id = mt.tag_id
            WHERE mt.market_id = ANY($1::bigint[])
            ORDER BY mt.market_id, t.slug`, [[...new Set(marketIds)]]);
        for (const row of rows)
        {
            const list = byMarket.get(row.market_id) ?? [];
            list.push({ slug: row.slug, name: row.name });
            byMarket.set(row.market_id, list);
        }
        return byMarket;
    }

    /**
     * Tags whose slug STARTS with `prefix`, most used first - the autocomplete.
     *
     * A range seek rather than `LIKE prefix || '%'`: a LIKE is index-served only under a
     * collation that happens to line up, and silently falling back to a scan of every subject
     * is exactly what an autocomplete must not do. Slugs are lowercased by `normalizeTag` and
     * compared in byte order (the column's collation is "C"), so a plain range over the
     * unique index is both correct and index-served.
     *
     * The count is the join's own, not a stored counter, so it cannot drift from the number
     * of markets a click on the tag actually returns.
     */
    public searchTags(prefix: string, limit: number): Promise<TagCount[]>
    {
        return this.#rows<TagCount>('searchTags', `
            SELECT t.slug AS slug, t.name AS name, COUNT(mt.market_id) AS count FROM tags t
            JOIN market_tags mt ON mt.tag_id = t.id
            WHERE t.slug >= $1 AND t.slug < $2
            GROUP BY t.id ORDER BY count DESC, t.slug ASC LIMIT $3`, [prefix, `${ prefix }${ HIGHEST }`, limit]);
    }

    public async listMarkets(filter: MarketFilter): Promise<{ rows: MarketRow[]; total: number }>
    {
        const params = new Params();
        const where: string[] = [];

        // Every TERM has to appear, rather than the whole box as one substring. A one-word
        // search is byte for byte the query it always was; a two-word one used to demand the
        // pair verbatim and in order, so `football iran` found nothing at all unless some
        // market happened to spell it that way.
        const terms = searchTerms(filter.search);
        for (const term of terms)
        {
            where.push(`search_text LIKE ${ params.bind(`%${ term }%`) }`);
        }

        const tags = [...new Set((filter.tags ?? []).map(normalizeTag).filter((slug) => slug !== ''))];
        if (tags.length > 0)
        {
            const slugs = params.bind(tags);
            if (filter.tagMode === 'all')
            {
                where.push(`(SELECT COUNT(DISTINCT t.slug) FROM market_tags mt
                    JOIN tags t ON t.id = mt.tag_id
                    WHERE mt.market_id = markets.id AND t.slug = ANY(${ slugs }::text[])) = ${ params.bind(tags.length) }`);
            }
            else
            {
                where.push(`EXISTS (SELECT 1 FROM market_tags mt
                    JOIN tags t ON t.id = mt.tag_id
                    WHERE mt.market_id = markets.id AND t.slug = ANY(${ slugs }::text[]))`);
            }
        }
        if (filter.category !== undefined)
        {
            where.push(`category = ${ params.bind(filter.category) }`);
        }
        if (filter.status !== undefined)
        {
            where.push(`status = ${ params.bind(filter.status) }`);
        }
        if (filter.locked !== undefined)
        {
            where.push(`lock_time ${ filter.locked ? '<=' : '>' } ${ params.bind(nowSeconds()) }`);
        }
        if (filter.featured === true)
        {
            where.push('featured = 1');
        }
        if (filter.exclude !== undefined)
        {
            where.push(`id != ${ params.bind(filter.exclude) }`);
        }
        if (filter.ids !== undefined)
        {
            where.push(`id = ANY(${ params.bind(filter.ids) }::bigint[])`);
        }
        if (filter.liveOnly === true)
        {
            where.push(`status = ${ params.bind(OPEN) } AND lock_time > ${ params.bind(nowSeconds()) }`);
        }
        const clause = where.length > 0 ? ` WHERE ${ where.join(' AND ') }` : '';
        const filtered = params.values.length;
        const order =
            filter.sort === 'newest'
                ? 'created_at DESC, id DESC'
                : filter.sort === 'ending'
                    ? 'lock_time ASC, id DESC'
                    : 'volume DESC, id DESC';

        // Relevance leads only when the caller actually asked something. A plain listing is
        // ordered exactly as it always was, and the chosen sort stays the TIE-BREAK, so two
        // equally relevant markets still arrive in volume (or date) order.
        const relevance = rankOf(terms, tags, params);
        const orderBy = relevance === null ? order : `(${ relevance }) DESC, ${ order }`;

        const total = await this.#row<{ n: number }>('listMarkets', `SELECT COUNT(*) AS n FROM markets${ clause }`,
            params.values.slice(0, filtered));
        const rows = await this.#rows<MarketRow>('listMarkets',
            `SELECT * FROM markets${ clause } ORDER BY ${ orderBy } LIMIT ${ params.bind(filter.limit) } OFFSET ${
                params.bind((filter.page - 1) * filter.limit) }`,
            params.values);
        return { rows, total: total?.n ?? 0 };
    }

    /** The market ids leading 24h volume - the "trending" set. */
    public async trendingIds(since: number, limit: number): Promise<number[]>
    {
        const rows = await this.#rows<{ market_id: number }>('trendingIds', `
            SELECT market_id, SUM(amount) AS vol FROM trades WHERE at >= $1
            GROUP BY market_id ORDER BY vol DESC, market_id ASC LIMIT $2`, [since, limit]);
        return rows.map((row) => row.market_id);
    }

    /**
     * Every category the app knows about: the ones markets actually carry, UNION the ones an
     * admin registered ahead of their first market. A registered-but-unused category reports a
     * count of 0 rather than vanishing, which is the whole point of registering it.
     */
    public async categories(): Promise<Array<{ id: string; count: number; labelJson: string; retired: boolean }>>
    {
        const rows = await this.#rows<{ id: string; count: number; label_json: string; retired: number }>('categories', `
            SELECT
                ids.id                                   AS id,
                COALESCE(used.count, 0)                  AS count,
                COALESCE(c.label_json, '')               AS label_json,
                COALESCE(c.retired, 0)                   AS retired
            FROM (
                SELECT category AS id FROM markets
                UNION
                SELECT id FROM categories
            ) AS ids
            LEFT JOIN (SELECT category AS id, COUNT(*) AS count FROM markets GROUP BY category) AS used
                ON used.id = ids.id
            LEFT JOIN categories AS c ON c.id = ids.id
            ORDER BY COALESCE(c.sort_order, 0) DESC, COALESCE(used.count, 0) DESC, ids.id ASC`);
        return rows.map((row) => ({ id: row.id, count: row.count, labelJson: row.label_json, retired: row.retired === 1 }));
    }

    /** Creates or updates a category's presentation metadata. The id is never changed. */
    public upsertCategory(entry: { id: string; labelJson: string; sortOrder: number; retired: boolean }): Promise<void>
    {
        return this.#run('upsertCategory', `
            INSERT INTO categories (id, label_json, sort_order, retired)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (id) DO UPDATE SET
                label_json = EXCLUDED.label_json,
                sort_order = EXCLUDED.sort_order,
                retired = EXCLUDED.retired`, [entry.id, entry.labelJson, entry.sortOrder, entry.retired ? 1 : 0]);
    }

    /**
     * Forgets a category's presentation row. Markets that carry the id on-chain are untouched
     * and keep listing under it - they simply show the raw id again, and registering the id
     * here once more brings every label back.
     * @returns True when a row was actually removed.
     */
    public async deleteCategory(id: string): Promise<boolean>
    {
        const gone = await this.#rows('deleteCategory',
            'WITH gone AS (DELETE FROM categories WHERE id = $1 RETURNING id) SELECT id FROM gone', [id], true);
        return gone.length > 0;
    }

    /** Markets per lifecycle stage, with Open split at the lock time into still-trading and over. */
    public async statusCounts(): Promise<{ open: number; closed: number; resolved: number; cancelled: number }>
    {
        const now = nowSeconds();
        const row = await this.#row<{ open: number; closed: number; resolved: number; cancelled: number }>('statusCounts', `
            SELECT COUNT(*) FILTER (WHERE status = ${ OPEN } AND lock_time > $1) AS open,
                COUNT(*) FILTER (WHERE status = ${ OPEN } AND lock_time <= $1) AS closed,
                COUNT(*) FILTER (WHERE status = ${ RESOLVED }) AS resolved,
                COUNT(*) FILTER (WHERE status = ${ CANCELLED }) AS cancelled
            FROM markets`, [now]);
        return row ?? { open: 0, closed: 0, resolved: 0, cancelled: 0 };
    }

    public async aggregates(daySince: number): Promise<{
        markets: number;
        volume: number;
        volume24h: number;
        traders: number;
        fees: number;
        tvl: number;
    }>
    {
        const row = await this.#row<{ markets: number; volume: number; fees: number; tvl: number; day: number; traders: number }>(
            'aggregates', `
            SELECT (SELECT COUNT(*) FROM markets) AS markets,
                (SELECT COALESCE(SUM(volume), 0) FROM markets) AS volume,
                (SELECT COALESCE(SUM(collected), 0) FROM markets) AS fees,
                (SELECT COALESCE(SUM(liquidity), 0) FROM markets) AS tvl,
                (SELECT COALESCE(SUM(amount), 0) FROM trades WHERE at >= $1) AS day,
                (SELECT COUNT(DISTINCT account) FROM trades) AS traders`, [daySince]);
        return {
            markets: row?.markets ?? 0,
            volume: row?.volume ?? 0,
            volume24h: row?.day ?? 0,
            traders: row?.traders ?? 0,
            fees: row?.fees ?? 0,
            tvl: row?.tvl ?? 0
        };
    }

    public pricePoints(marketId: number, outcomeIdx: number, since: number): Promise<Array<{ at: number; price: number }>>
    {
        return this.#rows<{ at: number; price: number }>('pricePoints',
            'SELECT at, price FROM price_points WHERE market_id = $1 AND outcome_idx = $2 AND at >= $3 ORDER BY at, id',
            [marketId, outcomeIdx, since]);
    }

    /**
     * The last known price of every (market, outcome) pair at or before every one of `times`, in
     * ONE read - for mark-to-market curves, which ask it of each position at each sample. A pair
     * that had no mark by then answers null. Of two marks at the same second, the later written.
     */
    public async pricesAt(pairs: ReadonlyArray<readonly [number, number]>, times: readonly number[]): Promise<PriceAt>
    {
        const known = new Map<string, number>();
        if (pairs.length > 0 && times.length > 0)
        {
            // `at` is whole seconds, so "at or before t" is "at or before floor(t)".
            const moments = [...new Set(times.map(Math.floor))];
            const rows = await this.#rows<{ market_id: number; outcome_idx: number; at: number; price: number }>('pricesAt', `
                SELECT pair.market_id AS market_id, pair.outcome_idx AS outcome_idx, moment.at AS at, mark.price AS price
                FROM unnest($1::bigint[], $2::int[]) AS pair(market_id, outcome_idx)
                CROSS JOIN unnest($3::bigint[]) AS moment(at)
                JOIN LATERAL (
                    SELECT p.price FROM price_points p
                    WHERE p.market_id = pair.market_id AND p.outcome_idx = pair.outcome_idx AND p.at <= moment.at
                    ORDER BY p.at DESC, p.id DESC LIMIT 1
                ) AS mark ON true`, [pairs.map(([marketId]) => marketId), pairs.map(([, idx]) => idx), moments]);
            for (const row of rows)
            {
                known.set(priceKey(row.market_id, row.outcome_idx, row.at), row.price);
            }
        }
        return (marketId, outcomeIdx, at) => known.get(priceKey(marketId, outcomeIdx, Math.floor(at))) ?? null;
    }

    public tradesOfMarket(marketId: number, limit: number, offset = 0): Promise<TradeRow[]>
    {
        return this.#rows<TradeRow>('tradesOfMarket',
            'SELECT * FROM trades WHERE market_id = $1 ORDER BY at DESC, id DESC LIMIT $2 OFFSET $3', [marketId, limit, offset]);
    }

    public async tradesCountOfMarket(marketId: number): Promise<number>
    {
        return (await this.#row<{ n: number }>('tradesCountOfMarket', 'SELECT COUNT(*) AS n FROM trades WHERE market_id = $1', [marketId]))
            ?.n ?? 0;
    }

    public recentTrades(limit: number, offset = 0): Promise<TradeRow[]>
    {
        return this.#rows<TradeRow>('recentTrades', 'SELECT * FROM trades ORDER BY at DESC, id DESC LIMIT $1 OFFSET $2', [limit, offset]);
    }

    public async tradesCount(): Promise<number>
    {
        return (await this.#row<{ n: number }>('tradesCount', 'SELECT COUNT(*) AS n FROM trades'))?.n ?? 0;
    }

    public holdersOf(marketId: number, limit: number, offset = 0): Promise<BalanceRow[]>
    {
        return this.#rows<BalanceRow>('holdersOf', `
            SELECT * FROM balances WHERE market_id = $1 AND token_id != $2 AND shares > $3
            ORDER BY shares DESC, account ASC LIMIT $4 OFFSET $5`, [marketId, LP_TOKEN_ID, DUST, limit, offset]);
    }

    /** Counts under the SAME filters holdersOf pages, or the last page would run short. */
    public async holdersCountOf(marketId: number): Promise<number>
    {
        return (await this.#row<{ n: number }>('holdersCountOf',
            'SELECT COUNT(*) AS n FROM balances WHERE market_id = $1 AND token_id != $2 AND shares > $3',
            [marketId, LP_TOKEN_ID, DUST]))?.n ?? 0;
    }

    /** Open outcome-share balances for one account (LP shares and dust excluded). */
    public positionsOf(account: string): Promise<BalanceRow[]>
    {
        return this.#rows<BalanceRow>('positionsOf', `
            SELECT * FROM balances WHERE account = $1 AND token_id != $2 AND shares > $3
            ORDER BY first_at DESC, market_id DESC, token_id ASC`, [account.toLowerCase(), LP_TOKEN_ID, DUST]);
    }

    public tradesOfAccount(account: string, since: number): Promise<TradeRow[]>
    {
        return this.#rows<TradeRow>('tradesOfAccount',
            'SELECT * FROM trades WHERE account = $1 AND at >= $2 ORDER BY at, id', [account.toLowerCase(), since]);
    }

    /** Every trade of each of these accounts, oldest first, keyed by account - one read where the
     *  leaderboard would otherwise make one per trader. */
    public async tradesOfAccounts(accounts: readonly string[]): Promise<Map<string, TradeRow[]>>
    {
        const byAccount = new Map<string, TradeRow[]>();
        const wanted = [...new Set(accounts.map((account) => account.toLowerCase()))];
        if (wanted.length === 0)
        {
            return byAccount;
        }
        const rows = await this.#rows<TradeRow>('tradesOfAccounts',
            'SELECT * FROM trades WHERE account = ANY($1::text[]) ORDER BY at, id', [wanted]);
        for (const row of rows)
        {
            const list = byAccount.get(row.account) ?? [];
            list.push(row);
            byAccount.set(row.account, list);
        }
        return byAccount;
    }

    public claimsOfAccount(account: string, since: number): Promise<ClaimRow[]>
    {
        return this.#rows<ClaimRow>('claimsOfAccount',
            'SELECT market_id, amount, at FROM claims WHERE account = $1 AND at >= $2 ORDER BY at, id', [account.toLowerCase(), since]);
    }

    /** Every claim of each of these accounts, oldest first, keyed by account. */
    public async claimsOfAccounts(accounts: readonly string[]): Promise<Map<string, ClaimRow[]>>
    {
        const byAccount = new Map<string, ClaimRow[]>();
        const wanted = [...new Set(accounts.map((account) => account.toLowerCase()))];
        if (wanted.length === 0)
        {
            return byAccount;
        }
        const rows = await this.#rows<ClaimRow & { account: string }>('claimsOfAccounts',
            'SELECT account, market_id, amount, at FROM claims WHERE account = ANY($1::text[]) ORDER BY at, id', [wanted]);
        for (const { account, ...claim } of rows)
        {
            const list = byAccount.get(account) ?? [];
            list.push(claim);
            byAccount.set(account, list);
        }
        return byAccount;
    }

    /** VWAP cost basis of buys per (market, outcome) for one account. */
    public buyBasis(
        account: string
    ): Promise<Array<{ market_id: number; outcome_idx: number; amount: number; shares: number }>>
    {
        return this.#rows<{ market_id: number; outcome_idx: number; amount: number; shares: number }>('buyBasis', `
            SELECT market_id, outcome_idx, SUM(amount) AS amount, SUM(shares) AS shares
            FROM trades WHERE account = $1 AND action = 'buy' GROUP BY market_id, outcome_idx`, [account.toLowerCase()]);
    }

    /** Per-account realized flow and volume inside a window, for the leaderboard. */
    public tradeRollup(since: number): Promise<Array<{ account: string; flow: number; volume: number }>>
    {
        return this.#rows<{ account: string; flow: number; volume: number }>('tradeRollup', `
            SELECT account,
                SUM(CASE WHEN action = 'sell' THEN amount ELSE -amount END) AS flow,
                SUM(amount) AS volume
            FROM trades WHERE at >= $1 GROUP BY account`, [since]);
    }

    // ------------------------------------------------------------------------------------
    // Referrals
    //
    // Reads here are keyed by referrer, which is what the dashboard asks for. The second
    // tier is one more self-join: the people referred by the people you referred, and no
    // further - the program is two levels deep by design, not by recursion limit.
    // ------------------------------------------------------------------------------------

    public async campaignByCode(code: string): Promise<ReferralCampaignRow | null>
    {
        return (await this.#row<ReferralCampaignRow>('campaignByCode',
            'SELECT code, owner, name, created_at FROM referral_campaigns WHERE code = $1', [code])) ?? null;
    }

    public async campaignCount(owner: string): Promise<number>
    {
        return (await this.#row<{ n: number }>('campaignCount', 'SELECT COUNT(*) AS n FROM referral_campaigns WHERE owner = $1', [owner]))
            ?.n ?? 0;
    }

    public insertCampaign(row: ReferralCampaignRow): Promise<void>
    {
        return this.#run('insertCampaign',
            'INSERT INTO referral_campaigns (code, owner, name, created_at) VALUES ($1, $2, $3, $4)',
            [row.code, row.owner, row.name, row.created_at]);
    }

    /**
     * Campaign rows with their sign-ups and the fees those sign-ups paid inside the window.
     * A campaign only ever names DIRECT arrivals, so no second tier appears here.
     */
    public campaignRollup(
        owner: string,
        since: number
    ): Promise<Array<ReferralCampaignRow & { signups: number; fees: number }>>
    {
        return this.#rows<ReferralCampaignRow & { signups: number; fees: number }>('campaignRollup', `
            SELECT c.code AS code, c.owner AS owner, c.name AS name, c.created_at AS created_at,
                (SELECT COUNT(*) FROM referrals r WHERE r.code = c.code AND r.at >= $1) AS signups,
                (SELECT COALESCE(SUM(t.fee), 0) FROM trades t
                    JOIN referrals r ON r.account = t.account
                    JOIN markets m ON m.id = t.market_id
                    WHERE r.code = c.code AND t.at >= $1 AND m.status = ${ RESOLVED }) AS fees
            FROM referral_campaigns c
            WHERE c.owner = $2
            ORDER BY c.created_at DESC, c.code ASC`, [since, owner]);
    }

    public async referralOf(account: string): Promise<ReferralRow | null>
    {
        return (await this.#row<ReferralRow>('referralOf',
            'SELECT account, code, referrer, at FROM referrals WHERE account = $1', [account])) ?? null;
    }

    /** First touch wins: an account that already has a referrer is left exactly as it was. */
    public async insertReferral(row: ReferralRow): Promise<boolean>
    {
        const inserted = await this.#rows('insertReferral', `
            INSERT INTO referrals (account, code, referrer, at) VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING RETURNING account`, [row.account, row.code, row.referrer, row.at], true);
        return inserted.length > 0;
    }

    public directReferrals(referrer: string): Promise<ReferralRow[]>
    {
        return this.#rows<ReferralRow>('directReferrals',
            'SELECT account, code, referrer, at FROM referrals WHERE referrer = $1 ORDER BY at DESC, account ASC', [referrer]);
    }

    public indirectReferrals(referrer: string): Promise<ReferralRow[]>
    {
        return this.#rows<ReferralRow>('indirectReferrals', `
            SELECT r1.account AS account, r1.code AS code, r1.referrer AS referrer, r1.at AS at
            FROM referrals r1
            JOIN referrals r2 ON r2.account = r1.referrer
            WHERE r2.referrer = $1 AND r1.account != $1
            ORDER BY r1.at DESC, r1.account ASC`, [referrer]);
    }

    /** Per-account trading inside the window, for both tiers at once. */
    public async referredRollup(
        referrer: string,
        since: number
    ): Promise<Array<{ account: string; trades: number; volume: number; fees: number; lastAt: number }>>
    {
        const rows = await this.#rows<{ account: string; trades: number; volume: number; fees: number; last_at: number }>('referredRollup', `
            SELECT t.account AS account, COUNT(*) AS trades, SUM(t.amount) AS volume,
                COALESCE(SUM(CASE WHEN m.status = ${ RESOLVED } THEN t.fee ELSE 0 END), 0) AS fees,
                MAX(t.at) AS last_at
            FROM trades t
            LEFT JOIN markets m ON m.id = t.market_id
            WHERE t.at >= $1 AND t.account IN (
                SELECT account FROM referrals WHERE referrer = $2
                UNION
                SELECT r1.account FROM referrals r1
                    JOIN referrals r2 ON r2.account = r1.referrer
                    WHERE r2.referrer = $2
            )
            GROUP BY t.account`, [since, referrer]);
        return rows.map((row) => ({ account: row.account, trades: row.trades, volume: row.volume, fees: row.fees, lastAt: row.last_at }));
    }

    // ------------------------------------------------------------------------------------
    // The chain's category registry
    // ------------------------------------------------------------------------------------

    /** Registers a category id, or flips whether it still accepts new markets. */
    public putChainCategory(id: number, enabled: boolean): Promise<void>
    {
        return this.#run('putChainCategory', `
            INSERT INTO chain_categories (id, enabled) VALUES ($1, $2)
            ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled`, [id, enabled ? 1 : 0]);
    }

    /** Records what a category means in one language. Setting it again replaces the text. */
    public putChainCategoryName(id: number, lang: string, meaning: string): Promise<void>
    {
        return this.#run('putChainCategoryName', `
            INSERT INTO chain_category_names (id, lang, meaning) VALUES ($1, $2, $3)
            ON CONFLICT (id, lang) DO UPDATE SET meaning = EXCLUDED.meaning`, [id, lang, meaning]);
    }

    /** Every registered category id with whether it is open for new markets. */
    public async chainCategories(): Promise<Array<{ id: number; enabled: boolean }>>
    {
        const rows = await this.#rows<{ id: number; enabled: number }>('chainCategories',
            'SELECT id, enabled FROM chain_categories ORDER BY id ASC');
        return rows.map((row) => ({ id: row.id, enabled: row.enabled === 1 }));
    }

    /** True when the index already holds this registry category. */
    public async hasChainCategory(id: number): Promise<boolean>
    {
        return (await this.#row('hasChainCategory', 'SELECT 1 AS known FROM chain_categories WHERE id = $1', [id])) !== undefined;
    }

    /** Every registry category id the index holds - one read for a boot that compares them all. */
    public async chainCategoryIds(): Promise<Set<number>>
    {
        return new Set((await this.#rows<{ id: number }>('chainCategoryIds', 'SELECT id FROM chain_categories')).map((row) => row.id));
    }

    /** Every meaning the registry holds, as (id, lang) -> text. */
    public chainCategoryNames(): Promise<Array<{ id: number; lang: string; meaning: string }>>
    {
        return this.#rows<{ id: number; lang: string; meaning: string }>('chainCategoryNames',
            'SELECT id, lang, meaning FROM chain_category_names ORDER BY id, lang');
    }

    // ------------------------------------------------------------------------------------
    // Console-owned settings and the create-form allowlist.

    /** A stored setting, or null when it has never been written. */
    public async setting(key: string): Promise<string | null>
    {
        return (await this.#row<{ value: string }>('setting', 'SELECT value FROM app_settings WHERE key = $1', [key]))?.value ?? null;
    }

    public putSetting(key: string, value: string): Promise<void>
    {
        return this.#run('putSetting', `
            INSERT INTO app_settings (key, value) VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, value]);
    }

    /** Everyone invited to prepare a market, newest first. */
    public marketCreators(): Promise<MarketCreatorRow[]>
    {
        return this.#rows<MarketCreatorRow>('marketCreators',
            'SELECT address, label, added_by, added_at FROM market_creators ORDER BY added_at DESC, address ASC');
    }

    /** The allowlist check behind the create form. Lowercased on the way in, because the
     *  column is lowercased and a checksummed address would miss every row. */
    public async isMarketCreator(address: string): Promise<boolean>
    {
        return (await this.#row('isMarketCreator', 'SELECT 1 AS known FROM market_creators WHERE address = $1', [address.toLowerCase()]))
            !== undefined;
    }

    /** Invites one, or re-labels an invitation already made. */
    public putMarketCreator(address: string, label: string, addedBy: string, addedAt: number): Promise<void>
    {
        return this.#run('putMarketCreator', `
            INSERT INTO market_creators (address, label, added_by, added_at) VALUES ($1, $2, $3, $4)
            ON CONFLICT (address) DO UPDATE SET label = EXCLUDED.label`, [address.toLowerCase(), label, addedBy, addedAt]);
    }

    public async removeMarketCreator(address: string): Promise<boolean>
    {
        const gone = await this.#rows('removeMarketCreator',
            'WITH gone AS (DELETE FROM market_creators WHERE address = $1 RETURNING address) SELECT address FROM gone',
            [address.toLowerCase()], true);
        return gone.length > 0;
    }

    /** Files a proposal and returns its number, which is what the proposer is told. */
    public async addProposal(draft: string, proposer: string, createdAt: number): Promise<number>
    {
        const [row] = await this.#rows<{ id: number }>('addProposal',
            'INSERT INTO proposals (draft, proposer, created_at) VALUES ($1, $2, $3) RETURNING id',
            [draft, proposer.toLowerCase(), createdAt], true);
        return row.id;
    }

    /** The console's queue: everything still waiting first, then the decided ones newest-first.
     *  Capped rather than paged - a queue long enough to need pages is a queue nobody is
     *  working through, and the cap is what stops one read growing without limit. */
    public proposals(limit: number): Promise<ProposalRow[]>
    {
        return this.#rows<ProposalRow>('proposals', `
            SELECT * FROM proposals
            ORDER BY (state = 'pending') DESC, id DESC
            LIMIT $1`, [limit]);
    }

    /** One wallet's own proposals, so a proposer can see what became of them. */
    public proposalsBy(proposer: string, limit: number): Promise<ProposalRow[]>
    {
        return this.#rows<ProposalRow>('proposalsBy',
            'SELECT * FROM proposals WHERE proposer = $1 ORDER BY id DESC LIMIT $2', [proposer.toLowerCase(), limit]);
    }

    /** How many of this wallet's proposals are still waiting - the flood guard's input. */
    public async pendingProposalCount(proposer: string): Promise<number>
    {
        return (await this.#row<{ n: number }>('pendingProposalCount',
            'SELECT COUNT(*) AS n FROM proposals WHERE proposer = $1 AND state = \'pending\'', [proposer.toLowerCase()]))?.n ?? 0;
    }

    /** Records a verdict. Conditional on the row still being PENDING, so a second click - or a
     *  second admin - cannot overwrite a decision already made and told to the proposer. */
    public async decideProposal(id: number, state: string, decidedBy: string, note: string, at: number): Promise<boolean>
    {
        const decided = await this.#rows('decideProposal', `
            WITH decided AS (
                UPDATE proposals SET state = $1, decided_by = $2, note = $3, decided_at = $4
                WHERE id = $5 AND state = 'pending' RETURNING id
            )
            SELECT id FROM decided`, [state, decidedBy.toLowerCase(), note, at, id], true);
        return decided.length > 0;
    }

    // ------------------------------------------------------------------------------------
    // Market overrides
    // ------------------------------------------------------------------------------------

    public async overrideOf(marketId: number): Promise<MarketOverrideRow | null>
    {
        return (await this.#row<MarketOverrideRow>('overrideOf', 'SELECT * FROM market_overrides WHERE market_id = $1', [marketId])) ?? null;
    }

    /** Which of these markets carry a correction, so a listing joins them in one query. */
    public async overridesIn(marketIds: readonly number[]): Promise<Set<number>>
    {
        if (marketIds.length === 0)
        {
            return new Set();
        }
        const rows = await this.#rows<{ market_id: number }>('overridesIn',
            'SELECT market_id FROM market_overrides WHERE market_id = ANY($1::bigint[])', [[...new Set(marketIds)]]);
        return new Set(rows.map((row) => row.market_id));
    }

    /** Note what the conflict clause does NOT touch: `origin_json` is whatever the FIRST edit
     *  displaced, and a second edit must not record the first edit's text as the chain's. */
    public putOverride(row: MarketOverrideRow): Promise<void>
    {
        return this.#run('putOverride', `
            INSERT INTO market_overrides (market_id, patch_json, origin_json, edited_by, edited_at)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (market_id) DO UPDATE SET
                patch_json = EXCLUDED.patch_json,
                edited_by = EXCLUDED.edited_by,
                edited_at = EXCLUDED.edited_at`, [row.market_id, row.patch_json, row.origin_json, row.edited_by, row.edited_at]);
    }

    public deleteOverride(marketId: number): Promise<void>
    {
        return this.#run('deleteOverride', 'DELETE FROM market_overrides WHERE market_id = $1', [marketId]);
    }

    /** Rewrites a market's PRESENTATION columns and nothing else - the status, the pools and
     *  the times are chain state and are not reachable from here. */
    public setMarketText(
        marketId: number,
        text: {
            title_json: string;
            emoji: string;
            rules_json: string;
            image: string;
            category: string;
            search_text: string;
        }
    ): Promise<void>
    {
        return this.#run('setMarketText', `
            UPDATE markets SET title_json = $1, emoji = $2, rules_json = $3, image = $4, category = $5, search_text = $6
            WHERE id = $7`, [text.title_json, text.emoji, text.rules_json, text.image, text.category, text.search_text, marketId]);
    }

    /** The label and the icon only. `oid` stays as the chain minted it: it is the identifier
     *  every recorded trade and every open position is presented against, and renaming an
     *  outcome is a change of wording, not a change of which outcome it is. */
    public setOutcomeText(marketId: number, idx: number, labelJson: string, icon: string): Promise<void>
    {
        return this.#run('setOutcomeText',
            'UPDATE outcomes SET label_json = $1, icon = $2 WHERE market_id = $3 AND idx = $4', [labelJson, icon, marketId, idx]);
    }
}

export { LP_TOKEN_ID };
