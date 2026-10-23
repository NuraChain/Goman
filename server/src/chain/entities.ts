import { EntitySchema } from 'typeorm';

import type {
    BalanceRow,
    MarketCreatorRow,
    MarketOverrideRow,
    MarketRow,
    OutcomeRow,
    ProposalRow,
    ReferralCampaignRow,
    ReferralRow,
    TradeRow
} from './store.ts';

// The index's tables, described to TypeORM.
//
// As EntitySchema objects rather than decorated classes: the server runs as `node src/main.ts`
// under Node's own type stripping, which refuses a decorator outright and never reads tsconfig, so
// there is no `emitDecoratorMetadata` to lean on either. The property names ARE the column names,
// so a row comes back in exactly the shape the store declares.
//
// The tables themselves are made by the migration in ./migrations, which can say what TypeORM
// cannot - a DESC key, a collation on a key. Every index it makes is named here with
// `synchronize: false`, so the schema TypeORM sees and the one the migration built cannot disagree
// without a test noticing (see store.spec.ts).

/** One key/value pair of the index's own bookkeeping: the origin it was built from, the cursor. */
interface MetaRow {
    key: string;
    value: string;
}

/** One price mark. The id is only there to give the row a key; nothing reads it. */
interface PricePointRow {
    id: number;
    market_id: number;
    outcome_idx: number;
    at: number;
    price: number;
}

interface ClaimEntityRow {
    id: string;
    market_id: number;
    account: string;
    amount: number;
    at: number;
}

interface CategoryRow {
    id: string;
    label_json: string;
    sort_order: number;
    retired: number;
}

interface ChainCategoryRow {
    id: number;
    enabled: number;
}

interface ChainCategoryNameRow {
    id: number;
    lang: string;
    meaning: string;
}

interface SettingRow {
    key: string;
    value: string;
}

interface TagRow {
    id: number;
    slug: string;
    name: string;
    created_at: number;
}

interface MarketTagRow {
    market_id: number;
    tag_id: number;
}

export const Meta = new EntitySchema<MetaRow>({
    name: 'Meta',
    tableName: 'meta',
    columns: {
        key: { type: 'text', primary: true },
        value: { type: 'text' }
    }
});

export const Market = new EntitySchema<MarketRow>({
    name: 'Market',
    tableName: 'markets',
    columns: {
        id: { type: 'bigint', primary: true },
        address: { type: 'text' },
        status: { type: 'integer' },
        category: { type: 'text' },
        title_json: { type: 'text' },
        emoji: { type: 'text' },
        rules_json: { type: 'text' },
        image: { type: 'text' },
        creator: { type: 'text' },
        created_at: { type: 'bigint' },
        lock_time: { type: 'bigint' },
        resolve_time: { type: 'bigint' },
        outcome_count: { type: 'integer' },
        volume: { type: 'double precision', default: 0 },
        liquidity: { type: 'double precision', default: 0 },
        collected: { type: 'double precision', default: 0 },
        winning_outcome: { type: 'integer', nullable: true },
        featured: { type: 'integer', default: 0 },
        search_text: { type: 'text' },
        kind: { type: 'integer', default: 0 }
    },
    uniques: [{ name: 'uq_markets_address', columns: ['address'] }],
    indices: [
        { name: 'idx_markets_status', synchronize: false },
        { name: 'idx_markets_category', synchronize: false },
        { name: 'idx_markets_volume', synchronize: false },
        { name: 'idx_markets_created', synchronize: false },
        { name: 'idx_markets_lock', synchronize: false },
        { name: 'idx_markets_featured', synchronize: false }
    ]
});

export const Outcome = new EntitySchema<OutcomeRow>({
    name: 'Outcome',
    tableName: 'outcomes',
    columns: {
        market_id: { type: 'bigint', primary: true },
        idx: { type: 'integer', primary: true },
        oid: { type: 'text' },
        label_json: { type: 'text' },
        icon: { type: 'text', default: '' },
        price: { type: 'double precision' }
    }
});

export const Trade = new EntitySchema<TradeRow>({
    name: 'Trade',
    tableName: 'trades',
    columns: {
        id: { type: 'text', primary: true },
        market_id: { type: 'bigint' },
        account: { type: 'text' },
        outcome_idx: { type: 'integer' },
        action: { type: 'text' },
        amount: { type: 'double precision' },
        shares: { type: 'double precision' },
        price: { type: 'double precision' },
        fee: { type: 'double precision', default: 0 },
        at: { type: 'bigint' },
        block: { type: 'bigint' }
    },
    indices: [
        { name: 'idx_trades_market', synchronize: false },
        { name: 'idx_trades_account', synchronize: false },
        { name: 'idx_trades_at', synchronize: false }
    ]
});

export const PricePoint = new EntitySchema<PricePointRow>({
    name: 'PricePoint',
    tableName: 'price_points',
    columns: {
        id: { type: 'bigint', primary: true, generated: 'increment' },
        market_id: { type: 'bigint' },
        outcome_idx: { type: 'integer' },
        at: { type: 'bigint' },
        price: { type: 'double precision' }
    },
    indices: [{ name: 'idx_points', synchronize: false }]
});

export const Balance = new EntitySchema<BalanceRow>({
    name: 'Balance',
    tableName: 'balances',
    columns: {
        account: { type: 'text', primary: true },
        market_id: { type: 'bigint', primary: true },
        token_id: { type: 'text', primary: true },
        shares: { type: 'double precision' },
        first_at: { type: 'bigint' }
    },
    indices: [{ name: 'idx_balances_market', synchronize: false }]
});

export const Claim = new EntitySchema<ClaimEntityRow>({
    name: 'Claim',
    tableName: 'claims',
    columns: {
        id: { type: 'text', primary: true },
        market_id: { type: 'bigint' },
        account: { type: 'text' },
        amount: { type: 'double precision' },
        at: { type: 'bigint' }
    },
    indices: [{ name: 'idx_claims_account', synchronize: false }]
});

export const Category = new EntitySchema<CategoryRow>({
    name: 'Category',
    tableName: 'categories',
    columns: {
        id: { type: 'text', primary: true },
        label_json: { type: 'text', default: '' },
        sort_order: { type: 'integer', default: 0 },
        retired: { type: 'integer', default: 0 }
    }
});

export const ReferralCampaign = new EntitySchema<ReferralCampaignRow>({
    name: 'ReferralCampaign',
    tableName: 'referral_campaigns',
    columns: {
        code: { type: 'text', primary: true },
        owner: { type: 'text' },
        name: { type: 'text' },
        created_at: { type: 'bigint' }
    },
    indices: [{ name: 'idx_campaigns_owner', synchronize: false }]
});

export const Referral = new EntitySchema<ReferralRow>({
    name: 'Referral',
    tableName: 'referrals',
    columns: {
        account: { type: 'text', primary: true },
        code: { type: 'text' },
        referrer: { type: 'text' },
        at: { type: 'bigint' }
    },
    indices: [
        { name: 'idx_referrals_referrer', synchronize: false },
        { name: 'idx_referrals_code', synchronize: false }
    ]
});

export const MarketOverride = new EntitySchema<MarketOverrideRow>({
    name: 'MarketOverride',
    tableName: 'market_overrides',
    columns: {
        market_id: { type: 'bigint', primary: true },
        patch_json: { type: 'text' },
        origin_json: { type: 'text' },
        edited_by: { type: 'text' },
        edited_at: { type: 'bigint' }
    }
});

export const ChainCategory = new EntitySchema<ChainCategoryRow>({
    name: 'ChainCategory',
    tableName: 'chain_categories',
    columns: {
        id: { type: 'bigint', primary: true },
        enabled: { type: 'integer', default: 1 }
    }
});

export const ChainCategoryName = new EntitySchema<ChainCategoryNameRow>({
    name: 'ChainCategoryName',
    tableName: 'chain_category_names',
    columns: {
        id: { type: 'bigint', primary: true },
        lang: { type: 'text', primary: true },
        meaning: { type: 'text' }
    }
});

export const Setting = new EntitySchema<SettingRow>({
    name: 'Setting',
    tableName: 'app_settings',
    columns: {
        key: { type: 'text', primary: true },
        value: { type: 'text' }
    }
});

export const MarketCreator = new EntitySchema<MarketCreatorRow>({
    name: 'MarketCreator',
    tableName: 'market_creators',
    columns: {
        address: { type: 'text', primary: true },
        label: { type: 'text', default: '' },
        added_by: { type: 'text', default: '' },
        added_at: { type: 'bigint' }
    }
});

export const Proposal = new EntitySchema<ProposalRow>({
    name: 'Proposal',
    tableName: 'proposals',
    columns: {
        id: { type: 'bigint', primary: true, generated: 'increment' },
        draft: { type: 'text' },
        proposer: { type: 'text' },
        state: { type: 'text', default: 'pending' },
        note: { type: 'text', default: '' },
        created_at: { type: 'bigint' },
        decided_at: { type: 'bigint', default: 0 },
        decided_by: { type: 'text', default: '' }
    },
    indices: [{ name: 'idx_proposals_proposer', synchronize: false }]
});

export const Tag = new EntitySchema<TagRow>({
    name: 'Tag',
    tableName: 'tags',
    columns: {
        id: { type: 'bigint', primary: true, generated: 'increment' },
        // Byte order, whatever the database's locale: the autocomplete's prefix range depends on it.
        slug: { type: 'text', collation: 'C' },
        name: { type: 'text' },
        created_at: { type: 'bigint', default: 0 }
    },
    uniques: [{ name: 'uq_tags_slug', columns: ['slug'] }]
});

export const MarketTagLink = new EntitySchema<MarketTagRow>({
    name: 'MarketTag',
    tableName: 'market_tags',
    columns: {
        market_id: { type: 'bigint', primary: true },
        tag_id: { type: 'bigint', primary: true }
    },
    indices: [{ name: 'idx_market_tags_tag', synchronize: false }]
});

/** Every table the index holds - explicit, never a glob, which TypeORM would resolve against the cwd. */
export const ENTITIES = [
    Meta,
    Market,
    Outcome,
    Trade,
    PricePoint,
    Balance,
    Claim,
    Category,
    ReferralCampaign,
    Referral,
    MarketOverride,
    ChainCategory,
    ChainCategoryName,
    Setting,
    MarketCreator,
    Proposal,
    Tag,
    MarketTagLink
];
