import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The whole persistence layer, in one module on purpose: every SQL statement the indexer
// and the API run lives here, so swapping SQLite for Postgres later is this one file.
// Amounts are stored as REAL ether-unit floats - this is a display index; exact wei never
// leaves the chain (writes are signed client-side against contract state, not this DB).

/** The LP share id (`type(uint256).max`); balances of it are liquidity, not positions. */
const LP_TOKEN_ID = (2n ** 256n - 1n).toString();

/** A share balance below this is dust left by float rounding, not a position. */
const DUST = 1e-9;

export interface MarketRow {
    id: number;
    address: string;
    status: number;
    category: string;
    title_en: string;
    title_fa: string;
    emoji: string;
    rules_en: string;
    rules_fa: string;
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
const SCHEMA_VERSION = '5';

export interface OutcomeRow {
    market_id: number;
    idx: number;
    oid: string;
    label_en: string;
    label_fa: string;
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
     * The protocol's cut of this trade's fee, in ether units - the `FeeCollected` the treasury
     * emitted in the SAME transaction. Zero when the trade produced no treasury receipt.
     * Referral earnings are a share of this, so it is money the platform actually received.
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

export interface MarketFilter {
    search?: string;
    category?: string;
    status?: number;
    featured?: boolean;
    exclude?: number;
    ids?: number[];
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
    title_en TEXT NOT NULL,
    title_fa TEXT NOT NULL,
    emoji TEXT NOT NULL,
    rules_en TEXT NOT NULL,
    rules_fa TEXT NOT NULL,
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
    label_en TEXT NOT NULL,
    label_fa TEXT NOT NULL,
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
   string. What it adds is the part that was never on-chain to begin with: a bilingual label,
   an image, an order, and a retired flag. Without it a category was not an entity at all (the
   list was a GROUP BY over live markets), so it could not be created before its first market
   existed, reviewed, or retired. Rows here are NOT wiped by the genesis guard - they describe
   presentation, not chain state. */
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    label_en TEXT NOT NULL DEFAULT '',
    label_fa TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    retired INTEGER NOT NULL DEFAULT 0
);
`;

export class IndexStore {
    readonly #db: DatabaseSync;

    constructor(path: string) {
        if (path !== ':memory:') {
            mkdirSync(dirname(path), { recursive: true });
        }
        this.#db = new DatabaseSync(path);
        this.#db.exec('PRAGMA journal_mode = WAL;');
        this.#db.exec(DDL);
        this.#migrate();
    }

    /**
     * Every table but `categories` is DERIVED from the chain, so a schema change needs no
     * hand-written column migration: drop them, recreate them, and let the indexer replay
     * from the deploy block. `categories` is the one table holding data the chain does not
     * have, so it survives. Bump SCHEMA_VERSION whenever a derived column changes.
     */
    #migrate(): void {
        if (this.getMeta('schema') === SCHEMA_VERSION) {
            return;
        }
        this.#db.exec(
            'DROP TABLE IF EXISTS markets;' +
                'DROP TABLE IF EXISTS outcomes;' +
                'DROP TABLE IF EXISTS trades;' +
                'DROP TABLE IF EXISTS price_points;' +
                'DROP TABLE IF EXISTS balances;' +
                'DROP TABLE IF EXISTS claims;' +
                'DROP TABLE IF EXISTS meta;'
        );
        this.#db.exec(DDL);
        this.setMeta('schema', SCHEMA_VERSION);
        this.setMeta('cursor', '-1');
    }

    public close(): void {
        this.#db.close();
    }

    // ------------------------------------------------------------------------------------
    // Meta / cursor
    // ------------------------------------------------------------------------------------

    public getMeta(key: string): string | null {
        const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
        return row?.value ?? null;
    }

    public setMeta(key: string, value: string): void {
        this.#db
            .prepare(
                'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
            )
            .run(key, value);
    }

    /**
     * The stale-index guard: if the chain behind the RPC is not the chain this index was
     * built from (a restarted local node), wipe everything and start over.
     */
    public ensureChain(genesisHash: string): boolean {
        const known = this.getMeta('genesis');
        if (known === genesisHash) {
            return false;
        }
        if (known !== null) {
            this.#db.exec(
                'DELETE FROM markets; DELETE FROM outcomes; DELETE FROM trades; DELETE FROM price_points; DELETE FROM balances; DELETE FROM claims; DELETE FROM meta;'
            );
        }
        this.setMeta('genesis', genesisHash);
        this.setMeta('cursor', '-1');
        return known !== null;
    }

    public cursor(): number {
        return Number(this.getMeta('cursor') ?? '-1');
    }

    public setCursor(block: number): void {
        this.setMeta('cursor', String(block));
    }

    // ------------------------------------------------------------------------------------
    // Ingest writes
    // ------------------------------------------------------------------------------------

    public insertMarket(row: MarketRow, outcomes: OutcomeRow[]): void {
        this.#db
            .prepare(`
            INSERT INTO markets (id, address, status, category, title_en, title_fa, emoji, rules_en, rules_fa,
                image, creator, created_at, lock_time, resolve_time, outcome_count, volume, liquidity, collected,
                winning_outcome, featured, search_text, kind)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO NOTHING`)
            .run(
                row.id,
                row.address,
                row.status,
                row.category,
                row.title_en,
                row.title_fa,
                row.emoji,
                row.rules_en,
                row.rules_fa,
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
            'INSERT INTO outcomes (market_id, idx, oid, label_en, label_fa, icon, price) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (market_id, idx) DO NOTHING'
        );
        for (const outcome of outcomes) {
            insert.run(
                outcome.market_id,
                outcome.idx,
                outcome.oid,
                outcome.label_en,
                outcome.label_fa,
                outcome.icon,
                outcome.price
            );
        }
    }

    /** Refreshes an existing market's live numbers after a trade or liquidity event. */
    public setPrices(marketId: number, prices: number[], liquidity: number, at: number): void {
        const update = this.#db.prepare('UPDATE outcomes SET price = ? WHERE market_id = ? AND idx = ?');
        const point = this.#db.prepare(
            'INSERT INTO price_points (market_id, outcome_idx, at, price) VALUES (?, ?, ?, ?)'
        );
        prices.forEach((price, idx) => {
            update.run(price, marketId, idx);
            point.run(marketId, idx, at, price);
        });
        this.#db.prepare('UPDATE markets SET liquidity = ? WHERE id = ?').run(liquidity, marketId);
    }

    public setStatus(marketId: number, status: number, winningOutcome: number | null): void {
        this.#db
            .prepare('UPDATE markets SET status = ?, winning_outcome = COALESCE(?, winning_outcome) WHERE id = ?')
            .run(status, winningOutcome, marketId);
    }

    public setLiquidity(marketId: number, liquidity: number): void {
        this.#db.prepare('UPDATE markets SET liquidity = ? WHERE id = ?').run(liquidity, marketId);
    }

    public setFeatured(marketId: number, featured: boolean): void {
        this.#db.prepare('UPDATE markets SET featured = ? WHERE id = ?').run(featured ? 1 : 0, marketId);
    }

    public insertTrade(row: TradeRow): void {
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
                row.at,
                row.block
            );
        this.#db.prepare('UPDATE markets SET volume = volume + ? WHERE id = ?').run(row.amount, row.market_id);
    }

    /** One historical price mark; trades insert their own fill price so backfills keep shape. */
    public insertPricePoint(marketId: number, outcomeIdx: number, at: number, price: number): void {
        this.#db
            .prepare('INSERT INTO price_points (market_id, outcome_idx, at, price) VALUES (?, ?, ?, ?)')
            .run(marketId, outcomeIdx, at, price);
    }

    public applyBalanceDelta(account: string, marketId: number, tokenId: string, delta: number, at: number): void {
        this.#db
            .prepare(`
            INSERT INTO balances (account, market_id, token_id, shares, first_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (account, market_id, token_id) DO UPDATE SET shares = shares + excluded.shares`)
            .run(account, marketId, tokenId, delta, at);
    }

    public insertClaim(id: string, marketId: number, account: string, amount: number, at: number): void {
        this.#db
            .prepare(
                'INSERT INTO claims (id, market_id, account, amount, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING'
            )
            .run(id, marketId, account, amount, at);
    }

    public addCollected(marketId: number, amount: number): void {
        this.#db.prepare('UPDATE markets SET collected = collected + ? WHERE id = ?').run(amount, marketId);
    }

    public marketIdByAddress(address: string): number | null {
        const row = this.#db.prepare('SELECT id FROM markets WHERE address = ?').get(address.toLowerCase()) as
            | { id: number }
            | undefined;
        return row?.id ?? null;
    }

    // ------------------------------------------------------------------------------------
    // Queries
    // ------------------------------------------------------------------------------------

    public marketById(id: number): MarketRow | null {
        return (this.#db.prepare('SELECT * FROM markets WHERE id = ?').get(id) as MarketRow | undefined) ?? null;
    }

    public outcomesOf(marketId: number): OutcomeRow[] {
        return this.#db
            .prepare('SELECT * FROM outcomes WHERE market_id = ? ORDER BY idx')
            .all(marketId) as unknown as OutcomeRow[];
    }

    public listMarkets(filter: MarketFilter): { rows: MarketRow[]; total: number } {
        const where: string[] = [];
        const params: Array<string | number> = [];
        if (filter.search !== undefined && filter.search.trim() !== '') {
            where.push('search_text LIKE ?');
            params.push(`%${filter.search.trim().toLowerCase()}%`);
        }
        if (filter.category !== undefined) {
            where.push('category = ?');
            params.push(filter.category);
        }
        if (filter.status !== undefined) {
            where.push('status = ?');
            params.push(filter.status);
        }
        if (filter.featured === true) {
            where.push('featured = 1');
        }
        if (filter.exclude !== undefined) {
            where.push('id != ?');
            params.push(filter.exclude);
        }
        if (filter.ids !== undefined) {
            where.push(`id IN (${filter.ids.map(() => '?').join(', ')})`);
            params.push(...filter.ids);
        }
        const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
        const order =
            filter.sort === 'newest'
                ? 'created_at DESC, id DESC'
                : filter.sort === 'ending'
                  ? 'lock_time ASC, id DESC'
                  : 'volume DESC, id DESC';

        const total = (this.#db.prepare(`SELECT COUNT(*) AS n FROM markets${clause}`).get(...params) as { n: number })
            .n;
        const rows = this.#db
            .prepare(`SELECT * FROM markets${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
            .all(...params, filter.limit, (filter.page - 1) * filter.limit) as unknown as MarketRow[];
        return { rows, total };
    }

    /** The market ids leading 24h volume - the "trending" set. */
    public trendingIds(since: number, limit: number): number[] {
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
    public categories(): Array<{
        id: string;
        count: number;
        labelEn: string;
        labelFa: string;
        image: string;
        retired: boolean;
    }> {
        return this.#db
            .prepare(`
            SELECT
                ids.id                                   AS id,
                COALESCE(used.count, 0)                  AS count,
                COALESCE(c.label_en, '')                 AS labelEn,
                COALESCE(c.label_fa, '')                 AS labelFa,
                COALESCE(c.image, '')                    AS image,
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
            .map((row) => {
                const entry = row as unknown as {
                    id: string;
                    count: number;
                    labelEn: string;
                    labelFa: string;
                    image: string;
                    retired: number;
                };
                return { ...entry, retired: entry.retired === 1 };
            });
    }

    /** Creates or updates a category's presentation metadata. The id is never changed. */
    public upsertCategory(entry: {
        id: string;
        labelEn: string;
        labelFa: string;
        image: string;
        sortOrder: number;
        retired: boolean;
    }): void {
        this.#db
            .prepare(`
            INSERT INTO categories (id, label_en, label_fa, image, sort_order, retired)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                label_en = excluded.label_en,
                label_fa = excluded.label_fa,
                image = excluded.image,
                sort_order = excluded.sort_order,
                retired = excluded.retired`)
            .run(entry.id, entry.labelEn, entry.labelFa, entry.image, entry.sortOrder, entry.retired ? 1 : 0);
    }

    public statusCounts(): Record<number, number> {
        const rows = this.#db.prepare('SELECT status, COUNT(*) AS n FROM markets GROUP BY status').all() as Array<{
            status: number;
            n: number;
        }>;
        const out: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
        for (const row of rows) {
            out[row.status] = row.n;
        }
        return out;
    }

    public aggregates(daySince: number): {
        markets: number;
        volume: number;
        volume24h: number;
        traders: number;
        fees: number;
        tvl: number;
    } {
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

    public pricePoints(marketId: number, outcomeIdx: number, since: number): Array<{ at: number; price: number }> {
        return this.#db
            .prepare(
                'SELECT at, price FROM price_points WHERE market_id = ? AND outcome_idx = ? AND at >= ? ORDER BY at'
            )
            .all(marketId, outcomeIdx, since) as unknown as Array<{ at: number; price: number }>;
    }

    /** The last known price at or before `at`, for mark-to-market curves. */
    public priceAt(marketId: number, outcomeIdx: number, at: number): number | null {
        const row = this.#db
            .prepare(
                'SELECT price FROM price_points WHERE market_id = ? AND outcome_idx = ? AND at <= ? ORDER BY at DESC LIMIT 1'
            )
            .get(marketId, outcomeIdx, at) as { price: number } | undefined;
        return row?.price ?? null;
    }

    public tradesOfMarket(marketId: number, limit: number, offset = 0): TradeRow[] {
        return this.#db
            .prepare('SELECT * FROM trades WHERE market_id = ? ORDER BY at DESC, id DESC LIMIT ? OFFSET ?')
            .all(marketId, limit, offset) as unknown as TradeRow[];
    }

    public tradesCountOfMarket(marketId: number): number {
        return (this.#db.prepare('SELECT COUNT(*) AS n FROM trades WHERE market_id = ?').get(marketId) as { n: number })
            .n;
    }

    public recentTrades(limit: number, offset = 0): TradeRow[] {
        return this.#db
            .prepare('SELECT * FROM trades ORDER BY at DESC, id DESC LIMIT ? OFFSET ?')
            .all(limit, offset) as unknown as TradeRow[];
    }

    public tradesCount(): number {
        return (this.#db.prepare('SELECT COUNT(*) AS n FROM trades').get() as { n: number }).n;
    }

    public holdersOf(marketId: number, limit: number, offset = 0): BalanceRow[] {
        return this.#db
            .prepare(`
            SELECT * FROM balances WHERE market_id = ? AND token_id != ? AND shares > ?
            ORDER BY shares DESC LIMIT ? OFFSET ?`)
            .all(marketId, LP_TOKEN_ID, DUST, limit, offset) as unknown as BalanceRow[];
    }

    /** Counts under the SAME filters holdersOf pages, or the last page would run short. */
    public holdersCountOf(marketId: number): number {
        return (
            this.#db
                .prepare('SELECT COUNT(*) AS n FROM balances WHERE market_id = ? AND token_id != ? AND shares > ?')
                .get(marketId, LP_TOKEN_ID, DUST) as { n: number }
        ).n;
    }

    /** Open outcome-share balances for one account (LP shares and dust excluded). */
    public positionsOf(account: string): BalanceRow[] {
        return this.#db
            .prepare(`
            SELECT * FROM balances WHERE account = ? AND token_id != ? AND shares > ?
            ORDER BY first_at DESC`)
            .all(account.toLowerCase(), LP_TOKEN_ID, DUST) as unknown as BalanceRow[];
    }

    public tradesOfAccount(account: string, since: number): TradeRow[] {
        return this.#db
            .prepare('SELECT * FROM trades WHERE account = ? AND at >= ? ORDER BY at')
            .all(account.toLowerCase(), since) as unknown as TradeRow[];
    }

    public claimsOfAccount(account: string, since: number): Array<{ market_id: number; amount: number; at: number }> {
        return this.#db
            .prepare('SELECT market_id, amount, at FROM claims WHERE account = ? AND at >= ? ORDER BY at')
            .all(account.toLowerCase(), since) as unknown as Array<{ market_id: number; amount: number; at: number }>;
    }

    /** VWAP cost basis of buys per (market, outcome) for one account. */
    public buyBasis(
        account: string
    ): Array<{ market_id: number; outcome_idx: number; amount: number; shares: number }> {
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
    public tradeRollup(since: number): Array<{ account: string; flow: number; volume: number }> {
        return this.#db
            .prepare(`
            SELECT account,
                SUM(CASE WHEN action = 'sell' THEN amount ELSE -amount END) AS flow,
                SUM(amount) AS volume
            FROM trades WHERE at >= ? GROUP BY account`)
            .all(since) as unknown as Array<{ account: string; flow: number; volume: number }>;
    }

    public claimRollup(since: number): Array<{ account: string; amount: number }> {
        return this.#db
            .prepare('SELECT account, SUM(amount) AS amount FROM claims WHERE at >= ? GROUP BY account')
            .all(since) as unknown as Array<{ account: string; amount: number }>;
    }

    /** Current mark-to-market value of every account's open outcome shares. */
    public unrealizedByAccount(): Array<{ account: string; value: number }> {
        return this.#db
            .prepare(`
            SELECT b.account AS account, SUM(b.shares * o.price) AS value
            FROM balances b
            JOIN outcomes o ON o.market_id = b.market_id AND o.idx = CAST(b.token_id AS INTEGER)
            WHERE b.token_id != ? AND b.shares > ? AND LENGTH(b.token_id) < 12
            GROUP BY b.account`)
            .all(LP_TOKEN_ID, DUST) as unknown as Array<{ account: string; value: number }>;
    }
}

export { LP_TOKEN_ID };
