import type { MigrationInterface, QueryRunner } from 'typeorm';

// The index's first schema, written as the PostgreSQL it is rather than generated: TypeORM cannot
// declare a DESC key or a collation on one. The names are bare - every connection's search_path
// is the index's own schema (see data-source.ts).
//
// Two kinds of table live here, and a later migration has to tell them apart. Most are DERIVED
// from the chain - markets, outcomes, trades, price marks, balances, claims, the category
// registry, tags - and a change to one may simply truncate it and reset the cursor, because the
// indexer replays from DEPLOY_BLOCK. The rest hold what the chain does not have and cannot give
// back - categories, referral campaigns and sign-ups, text corrections, console settings, invited
// creators, proposals - and a change to one of those has to carry its rows across.
//
// Amounts are DOUBLE PRECISION ether units, as the index has always kept them: this is a display
// index, and exact wei never leaves the chain. Times and ids are BIGINT - a millisecond stamp and
// a uint32 category id both outgrow a 4-byte INTEGER.

export class InitialIndex1792800000000 implements MigrationInterface
{
    public readonly name = 'InitialIndex1792800000000';

    public async up(runner: QueryRunner): Promise<void>
    {
        await runner.query(`
            CREATE TABLE meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE markets (
                id BIGINT PRIMARY KEY,
                address TEXT NOT NULL,
                status INTEGER NOT NULL,
                category TEXT NOT NULL,
                title_json TEXT NOT NULL,
                emoji TEXT NOT NULL,
                rules_json TEXT NOT NULL,
                image TEXT NOT NULL,
                creator TEXT NOT NULL,
                created_at BIGINT NOT NULL,
                lock_time BIGINT NOT NULL,
                resolve_time BIGINT NOT NULL,
                outcome_count INTEGER NOT NULL,
                volume DOUBLE PRECISION NOT NULL DEFAULT 0,
                liquidity DOUBLE PRECISION NOT NULL DEFAULT 0,
                collected DOUBLE PRECISION NOT NULL DEFAULT 0,
                winning_outcome INTEGER,
                featured INTEGER NOT NULL DEFAULT 0,
                search_text TEXT NOT NULL,
                kind INTEGER NOT NULL DEFAULT 0,
                CONSTRAINT uq_markets_address UNIQUE (address)
            );
            CREATE INDEX idx_markets_status ON markets (status);
            CREATE INDEX idx_markets_category ON markets (category);
            CREATE INDEX idx_markets_volume ON markets (volume DESC);
            CREATE INDEX idx_markets_created ON markets (created_at DESC);
            CREATE INDEX idx_markets_lock ON markets (lock_time ASC);
            CREATE INDEX idx_markets_featured ON markets (featured);

            CREATE TABLE outcomes (
                market_id BIGINT NOT NULL,
                idx INTEGER NOT NULL,
                oid TEXT NOT NULL,
                label_json TEXT NOT NULL,
                icon TEXT NOT NULL DEFAULT '',
                price DOUBLE PRECISION NOT NULL,
                PRIMARY KEY (market_id, idx)
            );

            CREATE TABLE trades (
                id TEXT PRIMARY KEY,
                market_id BIGINT NOT NULL,
                account TEXT NOT NULL,
                outcome_idx INTEGER NOT NULL,
                action TEXT NOT NULL,
                amount DOUBLE PRECISION NOT NULL,
                shares DOUBLE PRECISION NOT NULL,
                price DOUBLE PRECISION NOT NULL,
                fee DOUBLE PRECISION NOT NULL DEFAULT 0,
                at BIGINT NOT NULL,
                block BIGINT NOT NULL
            );
            CREATE INDEX idx_trades_market ON trades (market_id, at DESC);
            CREATE INDEX idx_trades_account ON trades (account, at);
            CREATE INDEX idx_trades_at ON trades (at);

            CREATE TABLE price_points (
                id BIGSERIAL PRIMARY KEY,
                market_id BIGINT NOT NULL,
                outcome_idx INTEGER NOT NULL,
                at BIGINT NOT NULL,
                price DOUBLE PRECISION NOT NULL
            );
            CREATE INDEX idx_points ON price_points (market_id, outcome_idx, at);

            CREATE TABLE balances (
                account TEXT NOT NULL,
                market_id BIGINT NOT NULL,
                token_id TEXT NOT NULL,
                shares DOUBLE PRECISION NOT NULL,
                first_at BIGINT NOT NULL,
                PRIMARY KEY (account, market_id, token_id)
            );
            CREATE INDEX idx_balances_market ON balances (market_id);

            CREATE TABLE claims (
                id TEXT PRIMARY KEY,
                market_id BIGINT NOT NULL,
                account TEXT NOT NULL,
                amount DOUBLE PRECISION NOT NULL,
                at BIGINT NOT NULL
            );
            CREATE INDEX idx_claims_account ON claims (account, at);

            CREATE TABLE categories (
                id TEXT PRIMARY KEY,
                label_json TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                retired INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE referral_campaigns (
                code TEXT PRIMARY KEY,
                owner TEXT NOT NULL,
                name TEXT NOT NULL,
                created_at BIGINT NOT NULL
            );
            CREATE INDEX idx_campaigns_owner ON referral_campaigns (owner);

            -- The key is what makes first touch final: a second join for an account that has one
            -- is a no-op, not an overwrite.
            CREATE TABLE referrals (
                account TEXT PRIMARY KEY,
                code TEXT NOT NULL,
                referrer TEXT NOT NULL,
                at BIGINT NOT NULL
            );
            CREATE INDEX idx_referrals_referrer ON referrals (referrer);
            CREATE INDEX idx_referrals_code ON referrals (code);

            CREATE TABLE market_overrides (
                market_id BIGINT PRIMARY KEY,
                patch_json TEXT NOT NULL,
                origin_json TEXT NOT NULL,
                edited_by TEXT NOT NULL,
                edited_at BIGINT NOT NULL
            );

            CREATE TABLE chain_categories (
                id BIGINT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE chain_category_names (
                id BIGINT NOT NULL,
                lang TEXT NOT NULL,
                meaning TEXT NOT NULL,
                PRIMARY KEY (id, lang)
            );

            CREATE TABLE app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE market_creators (
                address TEXT PRIMARY KEY,
                label TEXT NOT NULL DEFAULT '',
                added_by TEXT NOT NULL DEFAULT '',
                added_at BIGINT NOT NULL
            );

            CREATE TABLE proposals (
                id BIGSERIAL PRIMARY KEY,
                draft TEXT NOT NULL,
                proposer TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'pending',
                note TEXT NOT NULL DEFAULT '',
                created_at BIGINT NOT NULL,
                decided_at BIGINT NOT NULL DEFAULT 0,
                decided_by TEXT NOT NULL DEFAULT ''
            );
            CREATE INDEX idx_proposals_proposer ON proposals (proposer, id DESC);

            -- The slug compares in byte order whatever the database's locale: the autocomplete
            -- seeks the prefix range [q, q + U+10FFFF) on the unique index, which only holds
            -- when no locale reorders what sits between.
            CREATE TABLE tags (
                id BIGSERIAL PRIMARY KEY,
                slug TEXT COLLATE "C" NOT NULL,
                name TEXT NOT NULL,
                created_at BIGINT NOT NULL DEFAULT 0,
                CONSTRAINT uq_tags_slug UNIQUE (slug)
            );

            CREATE TABLE market_tags (
                market_id BIGINT NOT NULL,
                tag_id BIGINT NOT NULL,
                PRIMARY KEY (market_id, tag_id)
            );
            CREATE INDEX idx_market_tags_tag ON market_tags (tag_id);
        `);
    }

    public async down(runner: QueryRunner): Promise<void>
    {
        await runner.query(`
            DROP TABLE market_tags, tags, proposals, market_creators, app_settings, chain_category_names,
                chain_categories, market_overrides, referrals, referral_campaigns, categories, claims,
                balances, price_points, trades, outcomes, markets, meta
        `);
    }
}
