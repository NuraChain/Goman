import
{
    decodeOutcomeMeta,
    decodeTextMeta,
    decodeTitleMeta,
    MARKET_STATUSES,
    type ActivityItem,
    type Holder,
    type LeaderboardRow,
    type Localized,
    type Market,
    type MarketStatusName,
    type Outcome,
    type Period,
    type Range,
    type SeriesPoint
} from './schemas.ts';

import type { BalanceRow, MarketRow, OutcomeRow, TradeRow } from './chain/store.ts';

// Pure derivations between chain rows and the wire vocabulary. Everything here is
// deterministic in its inputs (time and prices arrive as arguments), which is what makes
// the whole indexer unit-testable without a chain.

/** Emoji shown when a market's envelope carries none, per curated category. */
const CATEGORY_EMOJI: Record<string, string> = {
    politics: '\u{1F3DB}\u{FE0F}',
    crypto: '\u{20BF}',
    sports: '\u{26BD}',
    economy: '\u{1F4B5}',
    tech: '\u{1F916}',
    culture: '\u{1F3AC}',
    science: '\u{1F52C}',
    world: '\u{1F30D}'
};

/** The fallback emoji for a category (custom categories get the compass). */
export function categoryEmoji(category: string): string
{
    return CATEGORY_EMOJI[category] ?? '\u{1F9ED}';
}

/** Contract status number -> wire name. */
export function statusName(status: number): MarketStatusName
{
    return MARKET_STATUSES[status] ?? 'open';
}

/** Wire status name -> contract number. */
export function statusNumber(name: MarketStatusName): number
{
    return MARKET_STATUSES.indexOf(name);
}

/** A stable outcome id from its label: slug of the English text, index-suffixed when empty. */
export function outcomeId(labelEn: string, idx: number): string
{
    const slug = labelEn.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug === '' ? `outcome-${ idx }` : slug;
}

/** True when two on-chain outcomes are a plain Yes/No pair - the binary presentation. */
export function isBinaryPair(labels: readonly Localized[]): boolean
{
    return labels.length === 2
        && labels[0].en.trim().toLowerCase() === 'yes'
        && labels[1].en.trim().toLowerCase() === 'no';
}

/** The lowercased haystack the search LIKE runs against. */
export function searchText(title: Localized, rules: Localized, category: string, labels: readonly Localized[]): string
{
    return [title.en, title.fa, rules.en, rules.fa, category, ...labels.flatMap((label) => [label.en, label.fa])]
        .join(' ')
        .toLowerCase();
}

/** Decodes an on-chain outcome name (may itself carry a text envelope, icon included). */
export function outcomeLabel(raw: string): Localized & { icon: string }
{
    return decodeOutcomeMeta(raw);
}

/** Decodes a market's on-chain strings into the row's presentation columns. */
export function decodeMarketStrings(title: string, description: string, category: string): {
    title: { en: string; fa: string; emoji: string };
    rules: Localized;
}
{
    return {
        title: decodeTitleMeta(title, categoryEmoji(category)),
        rules: decodeTextMeta(description)
    };
}

/**
 * A market row + its outcome rows -> the wire Market. A Yes/No pair collapses into the
 * single-'yes' presentation the UI is built around (`noIndex` keeps the NO leg tradeable).
 */
export function presentMarket(
    row: MarketRow,
    outcomes: OutcomeRow[],
    options: { trending: boolean; change24h: (idx: number) => number }
): Market
{
    const labels = outcomes.map((outcome) => ({ en: outcome.label_en, fa: outcome.label_fa }));
    const binary = isBinaryPair(labels);

    const wireOutcomes: Outcome[] = binary
        ? [{
            id: 'yes',
            index: 0,
            label: labels[0],
            icon: outcomes[0].icon,
            price: outcomes[0].price,
            change24h: options.change24h(0)
        }]
        : outcomes.map((outcome) => ({
            id: outcome.oid,
            index: outcome.idx,
            label: { en: outcome.label_en, fa: outcome.label_fa },
            icon: outcome.icon,
            price: outcome.price,
            change24h: options.change24h(outcome.idx)
        }));

    const winningOutcomeId = row.winning_outcome === null
        ? null
        : binary
            ? (row.winning_outcome === 0 ? 'yes' : 'no')
            : outcomes[row.winning_outcome]?.oid ?? null;

    return {
        id: String(row.id),
        address: row.address,
        category: row.category,
        emoji: row.emoji,
        image: row.image,
        title: { en: row.title_en, fa: row.title_fa },
        rules: { en: row.rules_en, fa: row.rules_fa },
        status: statusName(row.status),
        winningOutcomeId,
        kind: row.kind === 1 ? 'pool' : 'amm',
        noIndex: binary ? 1 : null,
        outcomes: wireOutcomes,
        volume: row.volume,
        liquidity: row.liquidity,
        endsAt: iso(row.resolve_time),
        createdAt: iso(row.created_at),
        featured: row.featured === 1,
        trending: options.trending
    };
}

/** The presented outcome id and side for an on-chain outcome index. */
export function presentSide(binary: boolean, outcomes: OutcomeRow[], idx: number): { outcomeId: string; side: 'yes' | 'no' }
{
    if (binary)
    {
        return idx === 0 ? { outcomeId: 'yes', side: 'yes' } : { outcomeId: 'yes', side: 'no' };
    }
    return { outcomeId: outcomes[idx]?.oid ?? `outcome-${ idx }`, side: 'yes' };
}

/** A trade row -> the wire activity item. */
export function presentTrade(row: TradeRow, outcomes: OutcomeRow[]): ActivityItem
{
    const binary = isBinaryPair(outcomes.map((outcome) => ({ en: outcome.label_en, fa: outcome.label_fa })));
    const { outcomeId: oid, side } = presentSide(binary, outcomes, row.outcome_idx);
    return {
        id: row.id,
        marketId: String(row.market_id),
        user: row.account,
        action: row.action === 'sell' ? 'sell' : 'buy',
        outcomeId: oid,
        side,
        shares: row.shares,
        price: row.price,
        at: iso(row.at)
    };
}

/** A balance row -> the wire holder entry. */
export function presentHolder(row: BalanceRow, outcomes: OutcomeRow[]): Holder
{
    const binary = isBinaryPair(outcomes.map((outcome) => ({ en: outcome.label_en, fa: outcome.label_fa })));
    const { outcomeId: oid, side } = presentSide(binary, outcomes, Number(row.token_id));
    return { user: row.account, outcomeId: oid, side, shares: row.shares };
}

function iso(seconds: number): string
{
    return new Date(seconds * 1000).toISOString();
}

// ----------------------------------------------------------------------------------------
// Time windows
// ----------------------------------------------------------------------------------------

const HOUR = 3600;
const DAY = 24 * HOUR;

/** The window start (unix seconds) for a chart range; 0 for 'all'. */
export function rangeStart(range: Range, now: number): number
{
    switch (range)
    {
        case '1d': return now - DAY;
        case '1w': return now - 7 * DAY;
        case '1m': return now - 30 * DAY;
        case 'all': return 0;
    }
}

/** The window start (unix seconds) for a leaderboard/portfolio period; 0 for 'all'. */
export function periodStart(period: Period, now: number): number
{
    switch (period)
    {
        case 'day': return now - DAY;
        case 'week': return now - 7 * DAY;
        case 'month': return now - 30 * DAY;
        case 'all': return 0;
    }
}

// ----------------------------------------------------------------------------------------
// Series
// ----------------------------------------------------------------------------------------

/** Points a chart draws; the renderer reads `.p` in order, so buckets must be even. */
const SERIES_BUCKETS = 40;

/**
 * Buckets raw price marks into `SERIES_BUCKETS` even steps. Each bucket carries the last
 * price seen; leading buckets before the first mark hold the first known price; the final
 * bucket is pinned to `current` so the chart always ends where the ticket begins.
 */
export function bucketSeries(
    points: Array<{ at: number; price: number }>,
    windowStart: number,
    now: number,
    current: number
): SeriesPoint[]
{
    const start = windowStart > 0 ? windowStart : (points[0]?.at ?? now - DAY);
    const span = Math.max(now - start, 1);
    const out: SeriesPoint[] = [];
    let cursor = 0;
    let last = points[0]?.price ?? current;
    for (let i = 0; i < SERIES_BUCKETS; i++)
    {
        const t = start + (span * (i + 1)) / SERIES_BUCKETS;
        while (cursor < points.length && points[cursor].at <= t)
        {
            last = points[cursor].price;
            cursor += 1;
        }
        out.push({ t, p: clamp01(last) });
    }
    out[out.length - 1] = { t: now, p: clamp01(current) };
    return out;
}

function clamp01(value: number): number
{
    return Math.min(1, Math.max(0, value));
}

// ----------------------------------------------------------------------------------------
// P&L
// ----------------------------------------------------------------------------------------

/**
 * VWAP cost basis; 0 when nothing was bought. Deliberately NOT clamped to 1: `amount` is
 * fee-inclusive collateral, so a near-certain buy settles just above 1, and capping it there
 * understated what the trader paid - which overstated their profit everywhere it was used.
 */
export function vwap(amount: number, shares: number): number
{
    return shares > 0 ? amount / shares : 0;
}

/**
 * An account's P&L at chosen times, replayed from its own trades and claims:
 * pnl(t) = cash flow to date (sells + claims - buys) + mark-to-market of shares held at t.
 * `priceAt` answers "the last known price of (market, outcomeIdx) at or before t".
 */
export function profitCurve(
    trades: TradeRow[],
    claims: Array<{ market_id: number; amount: number; at: number }>,
    times: number[],
    priceAt: (marketId: number, outcomeIdx: number, at: number) => number | null
): Array<{ t: number; p: number }>
{
    interface Flow { at: number; cash: number; marketId: number; outcomeIdx: number; shares: number }
    const flows: Flow[] = [
        ...trades.map((trade) => ({
            at: trade.at,
            cash: trade.action === 'sell' ? trade.amount : -trade.amount,
            marketId: trade.market_id,
            outcomeIdx: trade.outcome_idx,
            shares: trade.action === 'sell' ? -trade.shares : trade.shares
        })),
        ...claims.map((claim) => ({ at: claim.at, cash: claim.amount, marketId: claim.market_id, outcomeIdx: -1, shares: 0 }))
    ].sort((a, b) => a.at - b.at);

    const held = new Map<string, { marketId: number; outcomeIdx: number; shares: number }>();
    let cash = 0;
    let cursor = 0;
    const out: Array<{ t: number; p: number }> = [];
    for (const t of times)
    {
        while (cursor < flows.length && flows[cursor].at <= t)
        {
            const flow = flows[cursor];
            cash += flow.cash;
            if (flow.shares !== 0)
            {
                const key = `${ flow.marketId }/${ flow.outcomeIdx }`;
                const entry = held.get(key) ?? { marketId: flow.marketId, outcomeIdx: flow.outcomeIdx, shares: 0 };
                entry.shares += flow.shares;
                held.set(key, entry);
            }
            cursor += 1;
        }
        let marked = 0;
        for (const entry of held.values())
        {
            if (entry.shares > 1e-9)
            {
                marked += entry.shares * (priceAt(entry.marketId, entry.outcomeIdx, t) ?? 0);
            }
        }
        out.push({ t, p: cash + marked });
    }
    return out;
}

/** Evenly spaced sample times across a window, ending at `now`. */
export function sampleTimes(windowStart: number, now: number, buckets: number): number[]
{
    const start = windowStart > 0 ? windowStart : now - 30 * DAY;
    const span = Math.max(now - start, 1);
    return Array.from({ length: buckets }, (_, i) => start + (span * (i + 1)) / buckets);
}

// ----------------------------------------------------------------------------------------
// Leaderboard
// ----------------------------------------------------------------------------------------

/**
 * Merges the windowed trade flow, windowed claims, and (for 'all') the current unrealized
 * value into ranked rows. Profit inside a window is REALIZED profit; lifetime adds marks.
 */
export function leaderboard(
    tradeRollup: Array<{ account: string; flow: number; volume: number }>,
    profitOf: (account: string) => number,
    limit: number
): LeaderboardRow[]
{
    return tradeRollup
        .map((roll) => ({ address: roll.account, profit: profitOf(roll.account), volume: roll.volume }))
        .sort((a, b) => b.profit - a.profit)
        .slice(0, limit)
        .map((row, index) => ({ rank: index + 1, ...row }));
}
