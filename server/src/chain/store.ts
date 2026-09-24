import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { normalizeTag, type MarketTag, type TagCount, type TagMode } from '../wire.ts';

// The whole persistence layer, in one module on purpose: every SQL statement the indexer
// and the API run lives here, so swapping SQLite for Postgres later is this one file.
// Amounts are stored as REAL ether-unit floats - this is a display index; exact wei never
// leaves the chain (writes are signed client-side against contract state, not this DB).

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

/** Bumped whenever a DERIVED table's columns change; the index rebuilds itself from the chain. */
const SCHEMA_VERSION = '7';

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

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS markets (
    id INTEGER PRIMARY KEY,
    address TEXT NOT NULL UNIQUE,
    status INTEGER NOT NULL,
    category TEXT NOT NULL,
    title_json TEXT NOT NULL,
    emoji TEXT NOT NULL,
    rules_json TEXT NOT NULL,
    image TEXT NOT NULL,
    creator TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    lock_time INTEGER NOT NULL,
    resolve_time INTEGER NOT NULL,
    outcome_count INTEGER NOT NULL,
    volume REAL NOT NULL DEFAULT 0,
    liquidity REAL NOT NULL DEFAULT 0,
    collected REAL NOT NULL DEFAULT 0,
    winning_outcome INTEGER,
    featured INTEGER NOT NULL DEFAULT 0,
    search_text TEXT NOT NULL,
    kind INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets (status);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets (category);
CREATE INDEX IF NOT EXISTS idx_markets_volume ON markets (volume DESC);
CREATE INDEX IF NOT EXISTS idx_markets_created ON markets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_lock ON markets (lock_time ASC);
CREATE INDEX IF NOT EXISTS idx_markets_featured ON markets (featured);
CREATE TABLE IF NOT EXISTS outcomes (
    market_id INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    oid TEXT NOT NULL,
    label_json TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL,
    PRIMARY KEY (market_id, idx)
);
CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    market_id INTEGER NOT NULL,
    account TEXT NOT NULL,
    outcome_idx INTEGER NOT NULL,
    action TEXT NOT NULL,
    amount REAL NOT NULL,
    shares REAL NOT NULL,
    price REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    at INTEGER NOT NULL,
    block INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_market ON trades (market_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_account ON trades (account, at);
CREATE INDEX IF NOT EXISTS idx_trades_at ON trades (at);
CREATE TABLE IF NOT EXISTS price_points (
    market_id INTEGER NOT NULL,
    outcome_idx INTEGER NOT NULL,
    at INTEGER NOT NULL,
    price REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points ON price_points (market_id, outcome_idx, at);
CREATE TABLE IF NOT EXISTS balances (
    account TEXT NOT NULL,
    market_id INTEGER NOT NULL,
    token_id TEXT NOT NULL,
    shares REAL NOT NULL,
    first_at INTEGER NOT NULL,
    PRIMARY KEY (account, market_id, token_id)
);
CREATE INDEX IF NOT EXISTS idx_balances_market ON balances (market_id);
CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    market_id INTEGER NOT NULL,
    account TEXT NOT NULL,
    amount REAL NOT NULL,
    at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_claims_account ON claims (account, at);

/* Category PRESENTATION metadata, and only that. A market's category is an immutable string
   inside its on-chain envelope, so this table can never rename one - the id column IS that
   string. What it adds is the part that was never on-chain to begin with: a label in every
   language, an order, and a retired flag. Without it a category was not an entity at all (the
   list was a GROUP BY over live markets), so it could not be created before its first market
   existed, reviewed, retired or removed. Rows here are NOT wiped by the genesis guard - they
   describe presentation, not chain state, which is also why they need a REAL migration when
   their columns change (see #migrateCategories). */
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    label_json TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    retired INTEGER NOT NULL DEFAULT 0
);

/* The referral program. Like the categories table and UNLIKE every other one here, these two hold
   data the chain does not have: a campaign is a name someone typed and a join is a signature
   the server checked. They are therefore NOT in the drop list a schema bump runs and NOT in
   the wipe a genesis change triggers - replaying the chain cannot bring a campaign back, and
   losing one silently reassigns a stranger's earnings. */
CREATE TABLE IF NOT EXISTS referral_campaigns (
    code TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_owner ON referral_campaigns (owner);

/* One row per referred account, and the PRIMARY KEY is what makes first touch final: a
   second join for an address that already has one is a no-op, not an overwrite. */
CREATE TABLE IF NOT EXISTS referrals (
    account TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    referrer TEXT NOT NULL,
    at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals (code);

/* Post-deploy corrections to a market's text; see MarketOverrideRow. One row per market at
   most, so re-editing replaces the correction rather than stacking a second one on top. */
CREATE TABLE IF NOT EXISTS market_overrides (
    market_id INTEGER PRIMARY KEY,
    patch_json TEXT NOT NULL,
    origin_json TEXT NOT NULL,
    edited_by TEXT NOT NULL,
    edited_at INTEGER NOT NULL
);

/* The factory's category registry, as the chain reports it. Categories used to be a string
   each market carried; they are an id into this registry now, and what a reader is shown is the
   meaning stored here per language. Markets from before the registry keep their string, so both
   eras live side by side in the markets table: a numeric category resolves HERE, a name does not. */
CREATE TABLE IF NOT EXISTS chain_categories (
    id INTEGER PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1
);

/* One row per language a category has been named in. The chain's own fallback is English, and
   so is the reader's, so a category with no English meaning is a registry bug, not ours. */
CREATE TABLE IF NOT EXISTS chain_category_names (
    id INTEGER NOT NULL,
    lang TEXT NOT NULL,
    meaning TEXT NOT NULL,
    PRIMARY KEY (id, lang)
);

/* Settings the CONSOLE owns rather than the environment. A value here is one an operator has
   to be able to change on a running server - the backup period is the first - so it cannot
   live in .env, where changing it means a redeploy. Off-chain like the categories table, so
   neither the schema-bump drop list nor the genesis wipe touches it: replaying the chain cannot
   bring a setting back, and silently reverting to a default is worse than failing loudly. */
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

/* Wallets the console has invited to PREPARE a market. This is an app permission and nothing
   else: the factory gates createMarket on ADMIN_ROLE, and a row here grants no on-chain role
   at all - an invited wallet fills the create form in and hands the draft back as a link that
   an admin signs. The key is the lowercased address, because that is what a browser reports
   and comparing checksummed hex to it is how an allowlist silently admits nobody. Off-chain,
   so it survives a genesis change exactly like the categories table does. */
CREATE TABLE IF NOT EXISTS market_creators (
    address TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    added_by TEXT NOT NULL DEFAULT '',
    added_at INTEGER NOT NULL
);

/* Markets WRITTEN but not deployed. One row is a create-form draft, held as the form's own
   querystring and never parsed here - this server stores the string and hands it back, so a
   field added to the form needs no column added to this table.

   Nothing in here is on chain and nothing in here can get on chain by itself: accepting a
   proposal records a verdict, and the market is still deployed by the owner's own wallet.
   Off-chain like market_creators, so neither the schema-bump drop list nor the genesis wipe
   touches it - replaying the chain cannot bring a proposal back. */
CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY,
    draft TEXT NOT NULL,
    proposer TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    decided_at INTEGER NOT NULL DEFAULT 0,
    decided_by TEXT NOT NULL DEFAULT ''
);
/* The proposer's own list, which is the only read that filters. The console's read takes the
   whole queue newest-first and needs no index of its own. */
CREATE INDEX IF NOT EXISTS idx_proposals_proposer ON proposals (proposer, id DESC);

/* Tags, normalised - one row per SUBJECT rather than a list repeated inside every market.
   The slug is the identity and the only thing ever compared: normalizeTag produces it, so
   Football, FOOTBALL and " Iran Football " cannot become three subjects. The name column is
   the first author's spelling, kept for the chip and never for matching.

   UNIQUE(slug) is the normalized-name constraint AND the prefix index the autocomplete seeks
   on - SQLite builds an index for it, so a second CREATE INDEX over the same column would be
   a duplicate of the same b-tree.

   DERIVED, like the markets table: a market's tags come from its on-chain envelope plus any
   admin correction, so a schema bump can drop these two and let the replay rebuild them. */
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT 0
);

/* The join. The PRIMARY KEY is the pair, which both forbids tagging one market twice with
   one tag and indexes the market -> tags direction; the index below is the tag -> markets
   direction, which is what a tag page and a tag filter read. */
CREATE TABLE IF NOT EXISTS market_tags (
    market_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (market_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_market_tags_tag ON market_tags (tag_id);
`;

/** The words a search box was filled with. Repeats collapse - typing one word twice must not
 *  make it count twice, in the WHERE or in the score. */
function searchTerms(search: string | undefined): string[]
{
    const trimmed = (search ?? '').trim().toLowerCase();
    return trimmed === '' ? [] : [...new Set(trimmed.split(/\s+/))].slice(0, TERMS_MAX);
}

/** A market's count of tags whose slug is exactly the bound parameter. */
const EXACT_TAGS = `(SELECT COUNT(*) FROM market_tags mt JOIN tags t ON t.id = mt.tag_id
    WHERE mt.market_id = markets.id AND t.slug = ?)`;

/** The same count over a prefix RANGE, which contains the exact match - so an exact tag
 *  collects this score as well and can never be outranked by a mere prefix hit. */
const PREFIX_TAGS = `(SELECT COUNT(*) FROM market_tags mt JOIN tags t ON t.id = mt.tag_id
    WHERE mt.market_id = markets.id AND t.slug >= ? AND t.slug < ?)`;

/**
 * The relevance score, as a SQL expression plus its bound parameters, or null when there is
 * nothing to rank by.
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
function rankOf(terms: readonly string[], tags: readonly string[]): { sql: string; params: string[] } | null
{
    const parts: string[] = [];
    const params: string[] = [];

    for (const term of terms)
    {
        const slug = normalizeTag(term);
        if (slug !== '')
        {
            parts.push(`${ EXACT_TAGS } * ${ RANK.tag }`);
            params.push(slug);
            parts.push(`${ PREFIX_TAGS } * ${ RANK.tagPrefix }`);
            params.push(slug, `${ slug }${ HIGHEST }`);
        }
        parts.push(`(CASE WHEN LOWER(title_json) LIKE ? THEN ${ RANK.title } ELSE 0 END)`);
        params.push(`%${ term }%`);
        parts.push(`(CASE WHEN LOWER(rules_json) LIKE ? THEN ${ RANK.rules } ELSE 0 END)`);
        params.push(`%${ term }%`);
        parts.push(`(CASE WHEN search_text LIKE ? THEN ${ RANK.text } ELSE 0 END)`);
        params.push(`%${ term }%`);
    }

    for (const slug of tags)
    {
        parts.push(`${ EXACT_TAGS } * ${ RANK.tag }`);
        params.push(slug);
    }

    return parts.length === 0 ? null : { sql: parts.join(' + '), params };
}

export class IndexStore
{
    readonly #db: DatabaseSync;

    constructor(path: string)
    {
        if (path !== ':memory:')
        {
            mkdirSync(dirname(path), { recursive: true });
        }
        this.#db = new DatabaseSync(path);
        this.#db.exec('PRAGMA journal_mode = WAL;');
        this.#db.exec(DDL);
        // Retired tables. discover_cache held the venue crawl behind the console's old Discover
        // tab; rounds held the price-round schedule; market_openings held scheduled start
        // times, which meant nothing once the contracts lost the pause that enforced them.
        this.#db.exec(
            'DROP TABLE IF EXISTS discover_cache; DROP TABLE IF EXISTS rounds; DROP TABLE IF EXISTS market_openings;'
        );
        this.#migrateCategories();
        this.#migrate();
    }

    /**
     * The ONE table a schema bump cannot rebuild from the chain, so its column changes are
     * migrated by hand. Runs on every boot and returns immediately once done - the DDL above
     * only creates the table when it is absent, so an existing database still carries the old
     * bilingual columns until this rewrites it.
     *
     * A full table rebuild rather than ALTER ... DROP COLUMN: the rebuild works on every
     * SQLite ever shipped, and this table is a few dozen rows.
     */
    #migrateCategories(): void
    {
        const columns = this.#db.prepare('PRAGMA table_info(categories)').all() as Array<{ name: string }>;
        if (columns.length === 0 || columns.some((column) => column.name === 'label_json'))
        {
            return;
        }
        this.#db.exec(`
            CREATE TABLE categories_migrated (
                id TEXT PRIMARY KEY,
                label_json TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                retired INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO categories_migrated (id, label_json, sort_order, retired)
                SELECT
                    id,
                    CASE WHEN label_fa = ''
                        THEN json_object('en', label_en)
                        ELSE json_object('en', label_en, 'fa', label_fa)
                    END,
                    sort_order,
                    retired
                FROM categories;
            DROP TABLE categories;
            ALTER TABLE categories_migrated RENAME TO categories;
        `);
    }

    /**
     * Every table but `categories` is DERIVED from the chain, so a schema change needs no
     * hand-written column migration: drop them, recreate them, and let the indexer replay
     * from the deploy block. `categories` is the one table holding data the chain does not
     * have, so it survives. Bump SCHEMA_VERSION whenever a derived column changes.
     */
    #migrate(): void
    {
        if (this.getMeta('schema') === SCHEMA_VERSION)
        {
            return;
        }
        this.#db.exec(
            'DROP TABLE IF EXISTS markets;' +
                'DROP TABLE IF EXISTS outcomes;' +
                'DROP TABLE IF EXISTS trades;' +
                'DROP TABLE IF EXISTS price_points;' +
                'DROP TABLE IF EXISTS balances;' +
                'DROP TABLE IF EXISTS claims;' +
                'DROP TABLE IF EXISTS tags;' +
                'DROP TABLE IF EXISTS market_tags;' +
                'DROP TABLE IF EXISTS meta;'
        );
        this.#db.exec(DDL);
        this.setMeta('schema', SCHEMA_VERSION);
        this.setMeta('cursor', '-1');
    }

    public close(): void
    {
        this.#db.close();
    }

    /**
     * SQLite's own plan for a query, flattened to one string.
     *
     * Here so that "this uses the index" can be ASSERTED rather than assumed. A tag lookup
     * that quietly degrades to a full scan is fast on a development database and slow on a
     * real one, which is the class of regression no timing test on a fixture ever catches.
     */
    public queryPlan(sql: string, params: ReadonlyArray<string | number> = []): string
    {
        return (this.#db.prepare(`EXPLAIN QUERY PLAN ${ sql }`).all(...params) as Array<{ detail: string }>)
            .map((row) => row.detail)
            .join('\n');
    }

    /**
     * Writes a consistent copy of the whole database to `path`, which must not already exist.
     *
     * NOT a file copy. This database runs in WAL mode, so `index.db` on disk is only part of
     * the state - the recent writes are in `index.db-wal`, and copying the pair while the
     * indexer is mid-transaction restores to a torn database. `VACUUM INTO` holds a read
     * transaction for its duration and writes one file that is already whole and compacted.
     */
    public snapshot(path: string): void
    {
        this.#db.prepare('VACUUM INTO ?').run(path);
    }

    // ------------------------------------------------------------------------------------
    // Meta / cursor
    // ------------------------------------------------------------------------------------

    public getMeta(key: string): string | null
    {
        const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value ?? null;
    }

    public setMeta(key: string, value: string): void
    {
        this.#db
            .prepare(
                'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
            )
            .run(key, value);
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
     * @param genesisHash The chain's genesis block hash.
     * @param factory The factory this index reads.
     */
    public ensureChain(genesisHash: string, factory: string): boolean
    {
        const origin = `${ genesisHash }|${ factory.toLowerCase() }`;
        // 'genesis' is what pre-factory-aware indexes stored; reading it here means an index
        // built before this guard starts over once, which is correct - it cannot know which
        // factory it was filled from.
        const known = this.getMeta('origin') ?? this.getMeta('genesis');
        if (known === origin)
        {
            return false;
        }
        if (known !== null)
        {
            this.#db.exec(
                'DELETE FROM markets; DELETE FROM outcomes; DELETE FROM trades; DELETE FROM price_points; DELETE FROM balances; DELETE FROM claims; DELETE FROM market_overrides; DELETE FROM chain_categories; DELETE FROM chain_category_names; DELETE FROM tags; DELETE FROM market_tags; DELETE FROM meta;'
            );
        }
        this.setMeta('origin', origin);
        this.setMeta('cursor', '-1');
        return known !== null;
    }

    public cursor(): number
    {
        return Number(this.getMeta('cursor') ?? '-1');
    }

    public setCursor(block: number): void
    {
        this.setMeta('cursor', String(block));
    }

    // ------------------------------------------------------------------------------------
    // Ingest writes
    // ------------------------------------------------------------------------------------

    public insertMarket(row: MarketRow, outcomes: OutcomeRow[]): void
    {
        this.#db
            .prepare(`
            INSERT INTO markets (id, address, status, category, title_json, emoji, rules_json,
                image, creator, created_at, lock_time, resolve_time, outcome_count, volume, liquidity, collected,
                winning_outcome, featured, search_text, kind)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING`)
            .run(
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
            );
        const insert = this.#db.prepare(
            'INSERT INTO outcomes (market_id, idx, oid, label_json, icon, price) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (market_id, idx) DO NOTHING'
        );
        for (const outcome of outcomes)
        {
            insert.run(outcome.market_id, outcome.idx, outcome.oid, outcome.label_json, outcome.icon, outcome.price);
        }
    }

    /** Refreshes an existing market's live numbers after a trade or liquidity event. */
    public setPrices(marketId: number, prices: number[], liquidity: number, at: number): void
    {
        const update = this.#db.prepare('UPDATE outcomes SET price = ? WHERE market_id = ? AND idx = ?');
        const point = this.#db.prepare(
            'INSERT INTO price_points (market_id, outcome_idx, at, price) VALUES (?, ?, ?, ?)'
        );
        prices.forEach((price, idx) =>
        {
            update.run(price, marketId, idx);
            point.run(marketId, idx, at, price);
        });
        this.#db.prepare('UPDATE markets SET liquidity = ? WHERE id = ?').run(liquidity, marketId);
    }

    public setStatus(marketId: number, status: number, winningOutcome: number | null): void
    {
        this.#db
            .prepare('UPDATE markets SET status = ?, winning_outcome = COALESCE(?, winning_outcome) WHERE id = ?')
            .run(status, winningOutcome, marketId);
    }

    public setLiquidity(marketId: number, liquidity: number): void
    {
        this.#db.prepare('UPDATE markets SET liquidity = ? WHERE id = ?').run(liquidity, marketId);
    }

    public setFeatured(marketId: number, featured: boolean): void
    {
        this.#db.prepare('UPDATE markets SET featured = ? WHERE id = ?').run(featured ? 1 : 0, marketId);
    }

    public insertTrade(row: TradeRow): void
    {
        this.#db
            .prepare(`
            INSERT INTO trades (id, market_id, account, outcome_idx, action, amount, shares, price, fee, at, block)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`)
            .run(
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
            );
        this.#db.prepare('UPDATE markets SET volume = volume + ? WHERE id = ?').run(row.amount, row.market_id);
    }

    /** One historical price mark; trades insert their own fill price so backfills keep shape. */
    public insertPricePoint(marketId: number, outcomeIdx: number, at: number, price: number): void
    {
        this.#db
            .prepare('INSERT INTO price_points (market_id, outcome_idx, at, price) VALUES (?, ?, ?, ?)')
            .run(marketId, outcomeIdx, at, price);
    }

    public applyBalanceDelta(account: string, marketId: number, tokenId: string, delta: number, at: number): void
    {
        this.#db
            .prepare(`
            INSERT INTO balances (account, market_id, token_id, shares, first_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (account, market_id, token_id) DO UPDATE SET shares = shares + excluded.shares`)
            .run(account, marketId, tokenId, delta, at);
    }

    public insertClaim(id: string, marketId: number, account: string, amount: number, at: number): void
    {
        this.#db
            .prepare(
                'INSERT INTO claims (id, market_id, account, amount, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING'
            )
            .run(id, marketId, account, amount, at);
    }

    public addCollected(marketId: number, amount: number): void
    {
        this.#db.prepare('UPDATE markets SET collected = collected + ? WHERE id = ?').run(amount, marketId);
    }

    public marketIdByAddress(address: string): number | null
    {
        const row = this.#db.prepare('SELECT id FROM markets WHERE address = ?').get(address.toLowerCase()) as
            | { id: number }
            | undefined;
        return row?.id ?? null;
    }

    // ------------------------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------------------------

    public marketById(id: number): MarketRow | null
    {
        return (this.#db.prepare('SELECT * FROM markets WHERE id = ?').get(id) as MarketRow | undefined) ?? null;
    }

    public outcomesOf(marketId: number): OutcomeRow[]
    {
        return this.#db
            .prepare('SELECT * FROM outcomes WHERE market_id = ? ORDER BY idx')
            .all(marketId) as unknown as OutcomeRow[];
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
    public setMarketTags(marketId: number, tags: readonly MarketTag[]): void
    {
        const mint = this.#db.prepare(
            'INSERT INTO tags (slug, name, created_at) VALUES (?, ?, ?) ON CONFLICT (slug) DO NOTHING'
        );
        const link = this.#db.prepare(
            'INSERT INTO market_tags (market_id, tag_id) SELECT ?, id FROM tags WHERE slug = ? ON CONFLICT DO NOTHING'
        );
        const now = Math.floor(Date.now() / 1000);
        this.#db.prepare('DELETE FROM market_tags WHERE market_id = ?').run(marketId);
        for (const tag of tags)
        {
            mint.run(tag.slug, tag.name, now);
            link.run(marketId, tag.slug);
        }
        // A subject nothing is filed under any more is not a subject. Left behind, it would
        // keep completing in the autocomplete and then return an empty page when picked.
        // ponytail: a full sweep, which costs nothing on a table of subjects - scope it to
        // the ids just unlinked if the vocabulary ever grows enough for it to show.
        this.#db.exec('DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM market_tags WHERE tag_id = tags.id)');
    }

    public tagsOf(marketId: number): MarketTag[]
    {
        return this.#db
            .prepare(`
            SELECT t.slug AS slug, t.name AS name FROM market_tags mt
            JOIN tags t ON t.id = mt.tag_id WHERE mt.market_id = ? ORDER BY t.slug`)
            .all(marketId) as unknown as MarketTag[];
    }

    /**
     * Every listed market's tags in ONE query, keyed by market id.
     *
     * The reason this exists rather than a `tagsOf` per row: a page is twelve markets, and
     * twelve extra round trips to print a chip each is the N+1 that makes a list endpoint
     * slow for a reason no reader could name.
     */
    public tagsOfMarkets(marketIds: readonly number[]): Map<number, MarketTag[]>
    {
        const byMarket = new Map<number, MarketTag[]>();
        if (marketIds.length === 0)
        {
            return byMarket;
        }
        const rows = this.#db
            .prepare(`
            SELECT mt.market_id AS marketId, t.slug AS slug, t.name AS name FROM market_tags mt
            JOIN tags t ON t.id = mt.tag_id
            WHERE mt.market_id IN (${ marketIds.map(() => '?').join(', ') })
            ORDER BY mt.market_id, t.slug`)
            .all(...marketIds) as unknown as Array<{ marketId: number; slug: string; name: string }>;
        for (const row of rows)
        {
            const list = byMarket.get(row.marketId) ?? [];
            list.push({ slug: row.slug, name: row.name });
            byMarket.set(row.marketId, list);
        }
        return byMarket;
    }

    /**
     * Tags whose slug STARTS with `prefix`, most used first - the autocomplete.
     *
     * A range seek rather than `LIKE prefix || '%'`: SQLite only uses an index for a LIKE
     * when the collation happens to line up, and silently falling back to a scan of every
     * subject is exactly what an autocomplete must not do. Slugs are lowercased by
     * `normalizeTag`, so a plain range over the UNIQUE index is both correct and index-served.
     *
     * The count is the join's own, not a stored counter, so it cannot drift from the number
     * of markets a click on the tag actually returns.
     */
    public searchTags(prefix: string, limit: number): TagCount[]
    {
        return this.#db
            .prepare(`
            SELECT t.slug AS slug, t.name AS name, COUNT(mt.market_id) AS count FROM tags t
            JOIN market_tags mt ON mt.tag_id = t.id
            WHERE t.slug >= ? AND t.slug < ?
            GROUP BY t.id ORDER BY count DESC, t.slug ASC LIMIT ?`)
            .all(prefix, `${ prefix }${ HIGHEST }`, limit) as unknown as TagCount[];
    }

    public listMarkets(filter: MarketFilter): { rows: MarketRow[]; total: number }
    {
        const where: string[] = [];
        const params: Array<string | number> = [];

        // Every TERM has to appear, rather than the whole box as one substring. A one-word
        // search is byte for byte the query it always was; a two-word one used to demand the
        // pair verbatim and in order, so `football iran` found nothing at all unless some
        // market happened to spell it that way.
        const terms = searchTerms(filter.search);
        for (const term of terms)
        {
            where.push('search_text LIKE ?');
            params.push(`%${ term }%`);
        }

        const tags = [...new Set((filter.tags ?? []).map(normalizeTag).filter((slug) => slug !== ''))];
        if (tags.length > 0)
        {
            const holes = tags.map(() => '?').join(', ');
            if (filter.tagMode === 'all')
            {
                where.push(`(SELECT COUNT(DISTINCT t.slug) FROM market_tags mt
                    JOIN tags t ON t.id = mt.tag_id
                    WHERE mt.market_id = markets.id AND t.slug IN (${ holes })) = ?`);
                params.push(...tags, tags.length);
            }
            else
            {
                where.push(`EXISTS (SELECT 1 FROM market_tags mt
                    JOIN tags t ON t.id = mt.tag_id
                    WHERE mt.market_id = markets.id AND t.slug IN (${ holes }))`);
                params.push(...tags);
            }
        }
        if (filter.category !== undefined)
        {
            where.push('category = ?');
            params.push(filter.category);
        }
        if (filter.status !== undefined)
        {
            where.push('status = ?');
            params.push(filter.status);
        }
        if (filter.locked !== undefined)
        {
            where.push(filter.locked ? 'lock_time <= ?' : 'lock_time > ?');
            params.push(nowSeconds());
        }
        if (filter.featured === true)
        {
            where.push('featured = 1');
        }
        if (filter.exclude !== undefined)
        {
            where.push('id != ?');
            params.push(filter.exclude);
        }
        if (filter.ids !== undefined)
        {
            where.push(`id IN (${ filter.ids.map(() => '?').join(', ') })`);
            params.push(...filter.ids);
        }
        if (filter.liveOnly === true)
        {
            where.push('status = ? AND lock_time > ?');
            params.push(OPEN, nowSeconds());
        }
        const clause = where.length > 0 ? ` WHERE ${ where.join(' AND ') }` : '';
        const order =
            filter.sort === 'newest'
                ? 'created_at DESC, id DESC'
                : filter.sort === 'ending'
                    ? 'lock_time ASC, id DESC'
                    : 'volume DESC, id DESC';

        // Relevance leads only when the caller actually asked something. A plain listing is
        // ordered exactly as it always was, and the chosen sort stays the TIE-BREAK, so two
        // equally relevant markets still arrive in volume (or date) order.
        const relevance = rankOf(terms, tags);
        const orderBy = relevance === null ? order : `(${ relevance.sql }) DESC, ${ order }`;

        const total = (this.#db.prepare(`SELECT COUNT(*) AS n FROM markets${ clause }`).get(...params) as { n: number })
            .n;
        const rows = this.#db
            .prepare(`SELECT * FROM markets${ clause } ORDER BY ${ orderBy } LIMIT ? OFFSET ?`)
            .all(
                ...params,
                ...(relevance?.params ?? []),
                filter.limit,
                (filter.page - 1) * filter.limit
            ) as unknown as MarketRow[];
        return { rows, total };
    }

    /** The market ids leading 24h volume - the "trending" set. */
    public trendingIds(since: number, limit: number): number[]
    {
        const rows = this.#db
            .prepare(`
            SELECT market_id, SUM(amount) AS vol FROM trades WHERE at >= ?
            GROUP BY market_id ORDER BY vol DESC LIMIT ?`)
            .all(since, limit) as Array<{ market_id: number }>;
        return rows.map((row) => row.market_id);
    }

    /**
     * Every category the app knows about: the ones markets actually carry, UNION the ones an
     * admin registered ahead of their first market. A registered-but-unused category reports a
     * count of 0 rather than vanishing, which is the whole point of registering it.
     */
    public categories(): Array<{ id: string; count: number; labelJson: string; retired: boolean }>
    {
        return this.#db
            .prepare(`
            SELECT
                ids.id                                   AS id,
                COALESCE(used.count, 0)                  AS count,
                COALESCE(c.label_json, '')               AS labelJson,
                COALESCE(c.retired, 0)                   AS retired
            FROM (
                SELECT category AS id FROM markets
                UNION
                SELECT id FROM categories
            ) AS ids
            LEFT JOIN (SELECT category AS id, COUNT(*) AS count FROM markets GROUP BY category) AS used
                ON used.id = ids.id
            LEFT JOIN categories AS c ON c.id = ids.id
            ORDER BY COALESCE(c.sort_order, 0) DESC, COALESCE(used.count, 0) DESC, ids.id ASC`)
            .all()
            .map((row) =>
            {
                const entry = row as unknown as {
                    id: string;
                    count: number;
                    labelJson: string;
                    retired: number;
                };
                return { ...entry, retired: entry.retired === 1 };
            });
    }

    /** Creates or updates a category's presentation metadata. The id is never changed. */
    public upsertCategory(entry: { id: string; labelJson: string; sortOrder: number; retired: boolean }): void
    {
        this.#db
            .prepare(`
            INSERT INTO categories (id, label_json, sort_order, retired)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                label_json = excluded.label_json,
                sort_order = excluded.sort_order,
                retired = excluded.retired`)
            .run(entry.id, entry.labelJson, entry.sortOrder, entry.retired ? 1 : 0);
    }

    /**
     * Forgets a category's presentation row. Markets that carry the id on-chain are untouched
     * and keep listing under it - they simply show the raw id again, and registering the id
     * here once more brings every label back.
     * @returns True when a row was actually removed.
     */
    public deleteCategory(id: string): boolean
    {
        return this.#db.prepare('DELETE FROM categories WHERE id = ?').run(id).changes > 0;
    }

    /** Markets per lifecycle stage, with Open split at the lock time into still-trading and over. */
    public statusCounts(): { open: number; closed: number; resolved: number; cancelled: number }
    {
        const now = nowSeconds();
        return this.#db
            .prepare(`
            SELECT COALESCE(SUM(status = ${ OPEN } AND lock_time > ?), 0) AS open,
                COALESCE(SUM(status = ${ OPEN } AND lock_time <= ?), 0) AS closed,
                COALESCE(SUM(status = ${ RESOLVED }), 0) AS resolved,
                COALESCE(SUM(status = ${ CANCELLED }), 0) AS cancelled
            FROM markets`)
            .get(now, now) as { open: number; closed: number; resolved: number; cancelled: number };
    }

    public aggregates(daySince: number): {
        markets: number;
        volume: number;
        volume24h: number;
        traders: number;
        fees: number;
        tvl: number;
    }
    {
        const base = this.#db
            .prepare(
                'SELECT COUNT(*) AS markets, COALESCE(SUM(volume), 0) AS volume, COALESCE(SUM(collected), 0) AS fees, COALESCE(SUM(liquidity), 0) AS tvl FROM markets'
            )
            .get() as { markets: number; volume: number; fees: number; tvl: number };
        const day = (
            this.#db.prepare('SELECT COALESCE(SUM(amount), 0) AS v FROM trades WHERE at >= ?').get(daySince) as {
                v: number;
            }
        ).v;
        const traders = (this.#db.prepare('SELECT COUNT(DISTINCT account) AS n FROM trades').get() as { n: number }).n;
        return { markets: base.markets, volume: base.volume, volume24h: day, traders, fees: base.fees, tvl: base.tvl };
    }

    public pricePoints(marketId: number, outcomeIdx: number, since: number): Array<{ at: number; price: number }>
    {
        return this.#db
            .prepare(
                'SELECT at, price FROM price_points WHERE market_id = ? AND outcome_idx = ? AND at >= ? ORDER BY at'
            )
            .all(marketId, outcomeIdx, since) as unknown as Array<{ at: number; price: number }>;
    }

    /** The last known price at or before `at`, for mark-to-market curves. */
    public priceAt(marketId: number, outcomeIdx: number, at: number): number | null
    {
        const row = this.#db
            .prepare(
                'SELECT price FROM price_points WHERE market_id = ? AND outcome_idx = ? AND at <= ? ORDER BY at DESC LIMIT 1'
            )
            .get(marketId, outcomeIdx, at) as { price: number } | undefined;
        return row?.price ?? null;
    }

    public tradesOfMarket(marketId: number, limit: number, offset = 0): TradeRow[]
    {
        return this.#db
            .prepare('SELECT * FROM trades WHERE market_id = ? ORDER BY at DESC, id DESC LIMIT ? OFFSET ?')
            .all(marketId, limit, offset) as unknown as TradeRow[];
    }

    public tradesCountOfMarket(marketId: number): number
    {
        return (this.#db.prepare('SELECT COUNT(*) AS n FROM trades WHERE market_id = ?').get(marketId) as { n: number })
            .n;
    }

    public recentTrades(limit: number, offset = 0): TradeRow[]
    {
        return this.#db
            .prepare('SELECT * FROM trades ORDER BY at DESC, id DESC LIMIT ? OFFSET ?')
            .all(limit, offset) as unknown as TradeRow[];
    }

    public tradesCount(): number
    {
        return (this.#db.prepare('SELECT COUNT(*) AS n FROM trades').get() as { n: number }).n;
    }

    public holdersOf(marketId: number, limit: number, offset = 0): BalanceRow[]
    {
        return this.#db
            .prepare(`
            SELECT * FROM balances WHERE market_id = ? AND token_id != ? AND shares > ?
            ORDER BY shares DESC LIMIT ? OFFSET ?`)
            .all(marketId, LP_TOKEN_ID, DUST, limit, offset) as unknown as BalanceRow[];
    }

    /** Counts under the SAME filters holdersOf pages, or the last page would run short. */
    public holdersCountOf(marketId: number): number
    {
        return (
            this.#db
                .prepare('SELECT COUNT(*) AS n FROM balances WHERE market_id = ? AND token_id != ? AND shares > ?')
                .get(marketId, LP_TOKEN_ID, DUST) as { n: number }
        ).n;
    }

    /** Open outcome-share balances for one account (LP shares and dust excluded). */
    public positionsOf(account: string): BalanceRow[]
    {
        return this.#db
            .prepare(`
            SELECT * FROM balances WHERE account = ? AND token_id != ? AND shares > ?
            ORDER BY first_at DESC`)
            .all(account.toLowerCase(), LP_TOKEN_ID, DUST) as unknown as BalanceRow[];
    }

    public tradesOfAccount(account: string, since: number): TradeRow[]
    {
        return this.#db
            .prepare('SELECT * FROM trades WHERE account = ? AND at >= ? ORDER BY at')
            .all(account.toLowerCase(), since) as unknown as TradeRow[];
    }

    public claimsOfAccount(account: string, since: number): Array<{ market_id: number; amount: number; at: number }>
    {
        return this.#db
            .prepare('SELECT market_id, amount, at FROM claims WHERE account = ? AND at >= ? ORDER BY at')
            .all(account.toLowerCase(), since) as unknown as Array<{ market_id: number; amount: number; at: number }>;
    }

    /** VWAP cost basis of buys per (market, outcome) for one account. */
    public buyBasis(
        account: string
    ): Array<{ market_id: number; outcome_idx: number; amount: number; shares: number }>
    {
        return this.#db
            .prepare(`
            SELECT market_id, outcome_idx, SUM(amount) AS amount, SUM(shares) AS shares
            FROM trades WHERE account = ? AND action = 'buy' GROUP BY market_id, outcome_idx`)
            .all(account.toLowerCase()) as unknown as Array<{
            market_id: number;
            outcome_idx: number;
            amount: number;
            shares: number;
        }>;
    }

    /** Per-account realized flow and volume inside a window, for the leaderboard. */
    public tradeRollup(since: number): Array<{ account: string; flow: number; volume: number }>
    {
        return this.#db
            .prepare(`
            SELECT account,
                SUM(CASE WHEN action = 'sell' THEN amount ELSE -amount END) AS flow,
                SUM(amount) AS volume
            FROM trades WHERE at >= ? GROUP BY account`)
            .all(since) as unknown as Array<{ account: string; flow: number; volume: number }>;
    }

    public claimRollup(since: number): Array<{ account: string; amount: number }>
    {
        return this.#db
            .prepare('SELECT account, SUM(amount) AS amount FROM claims WHERE at >= ? GROUP BY account')
            .all(since) as unknown as Array<{ account: string; amount: number }>;
    }

    // ------------------------------------------------------------------------------------
    // Referrals
    //
    // Reads here are keyed by referrer, which is what the dashboard asks for. The second
    // tier is one more self-join: the people referred by the people you referred, and no
    // further - the program is two levels deep by design, not by recursion limit.
    // ------------------------------------------------------------------------------------

    public campaignByCode(code: string): ReferralCampaignRow | null
    {
        const row = this.#db
            .prepare('SELECT code, owner, name, created_at FROM referral_campaigns WHERE code = ?')
            .get(code) as ReferralCampaignRow | undefined;
        return row ?? null;
    }

    public campaignCount(owner: string): number
    {
        const row = this.#db.prepare('SELECT COUNT(*) AS n FROM referral_campaigns WHERE owner = ?').get(owner) as {
            n: number;
        };
        return row.n;
    }

    public insertCampaign(row: ReferralCampaignRow): void
    {
        this.#db
            .prepare('INSERT INTO referral_campaigns (code, owner, name, created_at) VALUES (?, ?, ?, ?)')
            .run(row.code, row.owner, row.name, row.created_at);
    }

    /**
     * Campaign rows with their sign-ups and the fees those sign-ups paid inside the window.
     * A campaign only ever names DIRECT arrivals, so no second tier appears here.
     */
    public campaignRollup(
        owner: string,
        since: number
    ): Array<ReferralCampaignRow & { signups: number; fees: number }>
    {
        return this.#db
            .prepare(`
            SELECT c.code AS code, c.owner AS owner, c.name AS name, c.created_at AS created_at,
                (SELECT COUNT(*) FROM referrals r WHERE r.code = c.code AND r.at >= ?) AS signups,
                (SELECT COALESCE(SUM(t.fee), 0) FROM trades t
                    JOIN referrals r ON r.account = t.account
                    JOIN markets m ON m.id = t.market_id
                    WHERE r.code = c.code AND t.at >= ? AND m.status = ${ RESOLVED }) AS fees
            FROM referral_campaigns c
            WHERE c.owner = ?
            ORDER BY c.created_at DESC`)
            .all(since, since, owner) as unknown as Array<ReferralCampaignRow & { signups: number; fees: number }>;
    }

    public referralOf(account: string): ReferralRow | null
    {
        const row = this.#db
            .prepare('SELECT account, code, referrer, at FROM referrals WHERE account = ?')
            .get(account) as ReferralRow | undefined;
        return row ?? null;
    }

    /** First touch wins: an account that already has a referrer is left exactly as it was. */
    public insertReferral(row: ReferralRow): boolean
    {
        const result = this.#db
            .prepare('INSERT INTO referrals (account, code, referrer, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
            .run(row.account, row.code, row.referrer, row.at);
        return Number(result.changes) > 0;
    }

    public directReferrals(referrer: string): ReferralRow[]
    {
        return this.#db
            .prepare('SELECT account, code, referrer, at FROM referrals WHERE referrer = ? ORDER BY at DESC')
            .all(referrer) as unknown as ReferralRow[];
    }

    public indirectReferrals(referrer: string): ReferralRow[]
    {
        return this.#db
            .prepare(`
            SELECT r1.account AS account, r1.code AS code, r1.referrer AS referrer, r1.at AS at
            FROM referrals r1
            JOIN referrals r2 ON r2.account = r1.referrer
            WHERE r2.referrer = ? AND r1.account != ?
            ORDER BY r1.at DESC`)
            .all(referrer, referrer) as unknown as ReferralRow[];
    }

    /** Per-account trading inside the window, for both tiers at once. */
    public referredRollup(
        referrer: string,
        since: number
    ): Array<{ account: string; trades: number; volume: number; fees: number; lastAt: number }>
    {
        return this.#db
            .prepare(`
            SELECT t.account AS account, COUNT(*) AS trades, SUM(t.amount) AS volume,
                COALESCE(SUM(CASE WHEN m.status = ${ RESOLVED } THEN t.fee ELSE 0 END), 0) AS fees,
                MAX(t.at) AS lastAt
            FROM trades t
            LEFT JOIN markets m ON m.id = t.market_id
            WHERE t.at >= ? AND t.account IN (
                SELECT account FROM referrals WHERE referrer = ?
                UNION
                SELECT r1.account FROM referrals r1
                    JOIN referrals r2 ON r2.account = r1.referrer
                    WHERE r2.referrer = ?
            )
            GROUP BY t.account`)
            .all(since, referrer, referrer) as unknown as Array<{
            account: string;
            trades: number;
            volume: number;
            fees: number;
            lastAt: number;
        }>;
    }

    /** Current mark-to-market value of every account's open outcome shares. */
    public unrealizedByAccount(): Array<{ account: string; value: number }>
    {
        return this.#db
            .prepare(`
            SELECT b.account AS account, SUM(b.shares * o.price) AS value
            FROM balances b
            JOIN outcomes o ON o.market_id = b.market_id AND o.idx = CAST(b.token_id AS INTEGER)
            WHERE b.token_id != ? AND b.shares > ? AND LENGTH(b.token_id) < 12
            GROUP BY b.account`)
            .all(LP_TOKEN_ID, DUST) as unknown as Array<{ account: string; value: number }>;
    }

    // ------------------------------------------------------------------------------------
    // Market overrides
    // ------------------------------------------------------------------------------------

    // ------------------------------------------------------------------------------------
    // The chain's category registry
    // ------------------------------------------------------------------------------------

    /** Registers a category id, or flips whether it still accepts new markets. */
    public putChainCategory(id: number, enabled: boolean): void
    {
        this.#db
            .prepare(`
            INSERT INTO chain_categories (id, enabled) VALUES (?, ?)
            ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled`)
            .run(id, enabled ? 1 : 0);
    }

    /** Records what a category means in one language. Setting it again replaces the text. */
    public putChainCategoryName(id: number, lang: string, meaning: string): void
    {
        this.#db
            .prepare(`
            INSERT INTO chain_category_names (id, lang, meaning) VALUES (?, ?, ?)
            ON CONFLICT (id, lang) DO UPDATE SET meaning = excluded.meaning`)
            .run(id, lang, meaning);
    }

    /** Every registered category id with whether it is open for new markets. */
    public chainCategories(): Array<{ id: number; enabled: boolean }>
    {
        const rows = this.#db
            .prepare('SELECT id, enabled FROM chain_categories ORDER BY id ASC')
            .all() as unknown as Array<{ id: number; enabled: number }>;
        return rows.map((row) => ({ id: row.id, enabled: row.enabled === 1 }));
    }

    /** True when the index already holds this registry category. */
    public hasChainCategory(id: number): boolean
    {
        return this.#db.prepare('SELECT 1 FROM chain_categories WHERE id = ?').get(id) !== undefined;
    }

    /** Every meaning the registry holds, as (id, lang) -> text. */
    public chainCategoryNames(): Array<{ id: number; lang: string; meaning: string }>
    {
        return this.#db.prepare('SELECT id, lang, meaning FROM chain_category_names').all() as unknown as Array<{
            id: number;
            lang: string;
            meaning: string;
        }>;
    }

    // ------------------------------------------------------------------------------------
    // Console-owned settings and the create-form allowlist.

    /** A stored setting, or null when it has never been written. */
    public setting(key: string): string | null
    {
        return (
            (this.#db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)
                ?.value ?? null
        );
    }

    public putSetting(key: string, value: string): void
    {
        this.#db
            .prepare(`
            INSERT INTO app_settings (key, value) VALUES (?, ?)
            ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
            .run(key, value);
    }

    /** Everyone invited to prepare a market, newest first. */
    public marketCreators(): MarketCreatorRow[]
    {
        return this.#db
            .prepare('SELECT address, label, added_by, added_at FROM market_creators ORDER BY added_at DESC')
            .all() as unknown as MarketCreatorRow[];
    }

    /** The allowlist check behind the create form. Lowercased on the way in, because the
     *  column is lowercased and a checksummed address would miss every row. */
    public isMarketCreator(address: string): boolean
    {
        return (
            this.#db.prepare('SELECT 1 FROM market_creators WHERE address = ?').get(address.toLowerCase()) !== undefined
        );
    }

    /** Invites one, or re-labels an invitation already made. */
    public putMarketCreator(address: string, label: string, addedBy: string, addedAt: number): void
    {
        this.#db
            .prepare(`
            INSERT INTO market_creators (address, label, added_by, added_at) VALUES (?, ?, ?, ?)
            ON CONFLICT (address) DO UPDATE SET label = excluded.label`)
            .run(address.toLowerCase(), label, addedBy, addedAt);
    }

    public removeMarketCreator(address: string): boolean
    {
        return this.#db.prepare('DELETE FROM market_creators WHERE address = ?').run(address.toLowerCase()).changes > 0;
    }

    /** Files a proposal and returns its number, which is what the proposer is told. */
    public addProposal(draft: string, proposer: string, createdAt: number): number
    {
        const result = this.#db
            .prepare('INSERT INTO proposals (draft, proposer, created_at) VALUES (?, ?, ?)')
            .run(draft, proposer.toLowerCase(), createdAt);
        return Number(result.lastInsertRowid);
    }

    /** The console's queue: everything still waiting first, then the decided ones newest-first.
     *  Capped rather than paged - a queue long enough to need pages is a queue nobody is
     *  working through, and the cap is what stops one read growing without limit. */
    public proposals(limit: number): ProposalRow[]
    {
        return this.#db
            .prepare(`
            SELECT * FROM proposals
            ORDER BY (state = 'pending') DESC, id DESC
            LIMIT ?`)
            .all(limit) as unknown as ProposalRow[];
    }

    /** One wallet's own proposals, so a proposer can see what became of them. */
    public proposalsBy(proposer: string, limit: number): ProposalRow[]
    {
        return this.#db
            .prepare('SELECT * FROM proposals WHERE proposer = ? ORDER BY id DESC LIMIT ?')
            .all(proposer.toLowerCase(), limit) as unknown as ProposalRow[];
    }

    /** How many of this wallet's proposals are still waiting - the flood guard's input. */
    public pendingProposalCount(proposer: string): number
    {
        const row = this.#db
            .prepare("SELECT COUNT(*) AS n FROM proposals WHERE proposer = ? AND state = 'pending'")
            .get(proposer.toLowerCase()) as { n: number } | undefined;
        return row?.n ?? 0;
    }

    /** Records a verdict. Conditional on the row still being PENDING, so a second click - or a
     *  second admin - cannot overwrite a decision already made and told to the proposer. */
    public decideProposal(id: number, state: string, decidedBy: string, note: string, at: number): boolean
    {
        return (
            this.#db
                .prepare(`
            UPDATE proposals SET state = ?, decided_by = ?, note = ?, decided_at = ?
            WHERE id = ? AND state = 'pending'`)
                .run(state, decidedBy.toLowerCase(), note, at, id).changes > 0
        );
    }

    public overrideOf(marketId: number): MarketOverrideRow | null
    {
        return (
            (this.#db.prepare('SELECT * FROM market_overrides WHERE market_id = ?').get(marketId) as
                | MarketOverrideRow
                | undefined) ?? null
        );
    }

    /** Which of these markets carry a correction, so a listing joins them in one query. */
    public overridesIn(marketIds: readonly number[]): Set<number>
    {
        if (marketIds.length === 0)
        {
            return new Set();
        }
        const rows = this.#db
            .prepare(
                `SELECT market_id FROM market_overrides WHERE market_id IN (${ marketIds.map(() => '?').join(', ') })`
            )
            .all(...marketIds) as unknown as Array<{ market_id: number }>;
        return new Set(rows.map((row) => row.market_id));
    }

    /** Note what the conflict clause does NOT touch: `origin_json` is whatever the FIRST edit
     *  displaced, and a second edit must not record the first edit's text as the chain's. */
    public putOverride(row: MarketOverrideRow): void
    {
        this.#db
            .prepare(`
            INSERT INTO market_overrides (market_id, patch_json, origin_json, edited_by, edited_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (market_id) DO UPDATE SET
                patch_json = excluded.patch_json,
                edited_by = excluded.edited_by,
                edited_at = excluded.edited_at`)
            .run(row.market_id, row.patch_json, row.origin_json, row.edited_by, row.edited_at);
    }

    public deleteOverride(marketId: number): void
    {
        this.#db.prepare('DELETE FROM market_overrides WHERE market_id = ?').run(marketId);
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
    ): void
    {
        this.#db
            .prepare(`
            UPDATE markets SET title_json = ?, emoji = ?, rules_json = ?, image = ?, category = ?, search_text = ?
            WHERE id = ?`)
            .run(text.title_json, text.emoji, text.rules_json, text.image, text.category, text.search_text, marketId);
    }

    /** The label and the icon only. `oid` stays as the chain minted it: it is the identifier
     *  every recorded trade and every open position is presented against, and renaming an
     *  outcome is a change of wording, not a change of which outcome it is. */
    public setOutcomeText(marketId: number, idx: number, labelJson: string, icon: string): void
    {
        this.#db
            .prepare('UPDATE outcomes SET label_json = ?, icon = ? WHERE market_id = ? AND idx = ?')
            .run(labelJson, icon, marketId, idx);
    }

    /**
     * Native collateral staked per outcome, from the bets themselves rather than the market's
     * balance: the balance also holds whatever has not been claimed out of a settled round.
     */
    public stakeByOutcome(marketId: number): Map<number, number>
    {
        const rows = this.#db
            .prepare(
                "SELECT outcome_idx AS idx, SUM(amount) AS total FROM trades WHERE market_id = ? AND action = 'buy' GROUP BY outcome_idx"
            )
            .all(marketId) as unknown as Array<{ idx: number; total: number }>;
        return new Map(rows.map((row) => [row.idx, row.total]));
    }
}

export { LP_TOKEN_ID };
