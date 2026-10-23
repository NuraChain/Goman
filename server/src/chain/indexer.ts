import { parseAbiItem, type Address, type Log } from 'viem';

import type { Logger } from '@azerothjs/logger';

import { decodeMarketStrings, marketTags, outcomeId, outcomeLabel, searchText, seedTags } from '../derive.ts';
import { isRegistryCategory, localizedOf } from '../wire.ts';
import { reapply } from '../overrides.ts';

import type { ChainReader } from './client.ts';
import { CHAIN_STATUS, type IndexStore } from './store.ts';

// The sync loop: pull logs forward from the cursor, fold them into sqlite, repeat. Events
// are NOT address-filtered at the RPC (the clone set is unbounded); instead each log is
// accepted only when its emitter is the factory or a market this index discovered - which
// also silently drops any unrelated contract sharing an event signature.

const EVENTS = [
    // TWO generations of the same event, and the chain holds both: markets created before the
    // category registry name their category inline, later ones carry an id into it. Only the
    // market id and address are read out of either, so one branch handles both.
    parseAbiItem(
        'event MarketCreated(uint256 indexed marketId, address indexed market, address indexed creator, string category, uint256 outcomeCount, uint256 initialFunding)'
    ),
    parseAbiItem(
        'event MarketCreated(uint256 indexed marketId, address indexed market, address indexed creator, uint32 categoryId, uint256 outcomeCount, uint256 initialFunding)'
    ),
    parseAbiItem('event CategoryAdded(uint32 indexed categoryId)'),
    parseAbiItem('event CategoryMeaningSet(uint32 indexed categoryId, bytes8 indexed lang, string meaning)'),
    parseAbiItem('event CategoryEnabledSet(uint32 indexed categoryId, bool enabled)'),
    parseAbiItem(
        'event PredictionPlaced(address indexed market, address indexed buyer, uint256 indexed outcome, uint256 amountIn, uint256 sharesOut)'
    ),
    parseAbiItem(
        'event PredictionSold(address indexed market, address indexed seller, uint256 indexed outcome, uint256 sharesIn, uint256 amountOut)'
    ),
    parseAbiItem(
        'event LiquidityAdded(address indexed market, address indexed funder, uint256 amount, uint256 lpShares)'
    ),
    parseAbiItem('event LiquidityRemoved(address indexed market, address indexed provider, uint256 lpShares)'),
    parseAbiItem('event MarketResolved(address indexed market, uint256 indexed winningOutcome)'),
    parseAbiItem('event MarketCancelled(address indexed market)'),
    parseAbiItem('event RewardClaimed(address indexed market, address indexed claimant, uint256 amount)'),
    parseAbiItem('event FeeCollected(address indexed market, uint256 amount)'),
    parseAbiItem(
        'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)'
    ),
    parseAbiItem(
        'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)'
    ),
    parseAbiItem(
        'event BetPlaced(address indexed market, address indexed better, uint256 indexed outcome, uint256 amount)'
    )
] as const;

const ZERO = '0x0000000000000000000000000000000000000000';

/** FeeMath's basis-point denominator. */
const BPS = 10_000n;

/**
 * What FeeMath charged a CPMM trade, in ether units. A buy pays `amountIn · bps / BPS`; a sell
 * removes `ceil(amountOut · BPS / (BPS − bps))` from the pool and the seller nets `amountOut`.
 * Wei-exact, so a market's trade fees add up to the one `FeeCollected` its resolve emits.
 */
export function tradeFee(action: 'buy' | 'sell', amount: bigint, bps: bigint): number
{
    const fee = action === 'buy' ? (amount * bps) / BPS : (amount * BPS + BPS - bps - 1n) / (BPS - bps) - amount;
    return Number(fee) / 1e18;
}

// ponytail: process-wide cache, unbounded - one entry per market clone ever traded, fine until
// there are millions. feeBps is fixed at initialization, so an entry never goes stale.
const feeBpsByMarket = new Map<string, bigint>();

/** A bytes8 language tag as the text it spells ("en"), trailing zero bytes dropped. */
function langTag(raw: string): string
{
    const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
    let tag = '';
    for (let i = 0; i + 1 < hex.length; i += 2)
    {
        const code = Number.parseInt(hex.slice(i, i + 2), 16);
        if (code === 0)
        {
            break;
        }
        tag += String.fromCharCode(code);
    }
    return tag.toLowerCase();
}

/** Blocks per getLogs call; local nodes handle large windows, live RPCs get modest ones. */
const CHUNK = 5000;

/** What the registry says about one category: whether it is open, and its name per language. */
interface CategoryState {
    enabled: boolean;
    names: Array<{ lang: string; meaning: string }>;
}

/**
 * Reads the factory's category registry and stores every category the index does not
 * already have.
 *
 * The registry reaches the index by replaying `CategoryAdded` and `CategoryMeaningSet`,
 * which is exact for as long as the replay window CONTAINS those events. It does not when
 * DEPLOY_BLOCK is set past them, when an index is pointed at a chain that has been running
 * a while, or when a category was registered while this server was down and the cursor has
 * since moved past it. A category in that state still exists on chain and still gates
 * `createMarket` - it is only invisible here, which shows up as a market header and a
 * picker printing a bare `#12` that nothing can name.
 *
 * So the registry is also read as STATE, which is what it is. Events stay the fast path;
 * this is the floor under them.
 *
 * Only what is MISSING is written. A category the index already holds is left alone, so a
 * meaning corrected by a later event is not overwritten by a re-read on the next boot.
 */
export async function syncCategories(store: IndexStore, chain: ChainReader, log: Logger): Promise<void>
{
    const ids = await chain.categoryIds();
    const known = await store.chainCategoryIds();
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length === 0)
    {
        return;
    }
    for (const id of missing)
    {
        const state = await readCategory(chain, id);
        if (state !== null)
        {
            await store.transaction(() => writeCategory(store, id, state));
        }
    }
    log.info('read categories the index was missing', { ids: missing.join(',') });
}

/** One category, straight from the registry; null when the registry does not know the id. */
async function readCategory(chain: ChainReader, id: number): Promise<CategoryState | null>
{
    const [state, meanings] = await Promise.all([chain.categoryState(id), chain.categoryMeanings(id)]);
    if (!state.known)
    {
        return null;
    }
    const names: CategoryState['names'] = [];
    for (const entry of meanings)
    {
        const tag = langTag(entry.lang);
        if (tag !== '')
        {
            names.push({ lang: tag, meaning: entry.meaning });
        }
    }
    return { enabled: state.enabled, names };
}

async function writeCategory(store: IndexStore, id: number, state: CategoryState): Promise<void>
{
    await store.putChainCategory(id, state.enabled);
    for (const entry of state.names)
    {
        await store.putChainCategoryName(id, entry.lang, entry.meaning);
    }
}

type DecodedLog = Log<bigint, number, false, undefined, true, typeof EVENTS>;

export interface IndexerHandle {
    /** Resolves once the index has caught up to the chain head for the first time. */
    ready: Promise<void>;

    /** Asks the loop to stop at its next chunk boundary, and resolves once it has. */
    stop(): Promise<void>;
}

/**
 * One indexed log, as a notifier sees it: already accepted as ours, already folded into the
 * store. `args` is viem's decoded argument object, so chain amounts are still bigint wei -
 * whoever renders it decides what a number means, which keeps this side free of presentation.
 */
export interface IndexedEvent {
    event: string;

    /** The market it belongs to. Null only for a log this index could not attribute. */
    marketId: number | null;
    address: string;
    tx: string;
    at: number;
    args: Record<string, unknown>;
}

/** Called once per batch AFTER it is committed, so a handler reading the store sees the
 *  result rather than the state before it. Never called with an empty batch. */
export type EventSink = (events: readonly IndexedEvent[]) => void;

/** Starts the background sync loop; resolves `ready` after the first full catch-up. */
export function startIndexer(store: IndexStore, chain: ChainReader, log: Logger, onEvents?: EventSink): IndexerHandle
{
    const stopping = new AbortController();
    let resolveReady = (): void => undefined;
    const ready = new Promise<void>((resolve) =>
    {
        resolveReady = resolve;
    });

    /** The pause between passes, cut short by a stop. */
    const pause = (): Promise<void> => new Promise<void>((resolve) =>
    {
        const timer = setTimeout(done, chain.env.pollMs);
        function done(): void
        {
            clearTimeout(timer);
            stopping.signal.removeEventListener('abort', done);
            resolve();
        }
        stopping.signal.addEventListener('abort', done);
    });

    const loop = async (): Promise<void> =>
    {
        const wiped = await store.ensureChain(await chain.genesisHash(), chain.env.factory);
        if (wiped)
        {
            log.warn('chain changed under the index - wiped and resyncing');
        }
        // Before the first catch-up, so the very first market folded in can already be shown
        // under the name of its category rather than under its number.
        try
        {
            await syncCategories(store, chain, log);
        }
        catch (error)
        {
            // A registry that cannot be read is not a reason to index nothing: the events
            // below still carry every category registered inside the replay window.
            log.error('could not read the category registry', { error: String(error) });
        }
        while (!stopping.signal.aborted)
        {
            try
            {
                await syncOnce(store, chain, log, onEvents, stopping.signal);
                if (!stopping.signal.aborted)
                {
                    resolveReady();
                }
            }
            catch (error)
            {
                log.error('sync failed', { error: String(error) });
            }
            await pause();
        }
    };
    const running = loop();

    return {
        ready,
        stop: () =>
        {
            stopping.abort();
            return running;
        }
    };
}

/**
 * One catch-up pass: cursor+1 .. head, in chunks. A chunk is written in ONE transaction with the
 * cursor that covers it, so a crash leaves all of it or none: before, every row committed on its
 * own and a restart replayed the chunk on top of whatever half had landed - a second copy of every
 * balance delta, price mark and fee in it. `signal` stops the pass at the next chunk boundary.
 */
export async function syncOnce(
    store: IndexStore,
    chain: ChainReader,
    log: Logger,
    onEvents?: EventSink,
    signal?: AbortSignal
): Promise<void>
{
    const head = Number(await chain.latestBlock());
    let from = (await store.cursor()) + 1;
    from = Math.max(from, chain.env.deployBlock);
    while (from <= head && signal?.aborted !== true)
    {
        const to = Math.min(from + CHUNK - 1, head);
        const logs = (await chain.client.getLogs({
            events: EVENTS,
            fromBlock: BigInt(from),
            toBlock: BigInt(to)
        })) as DecodedLog[];
        logs.sort((a, b) =>
            a.blockNumber === b.blockNumber
                ? (a.logIndex ?? 0) - (b.logIndex ?? 0)
                : Number(a.blockNumber - b.blockNumber)
        );
        // Everything the chain has to say about the chunk is read FIRST, and only then is it
        // written: a transaction left open across an RPC call would hold the index for as long
        // as the node takes to answer.
        const read = await readChunk(store, chain, logs);
        await store.transaction(async () =>
        {
            await foldChunk(store, chain, read);
            await store.setCursor(to);
        });
        if (logs.length > 0)
        {
            log.info('indexed', { from, to, events: logs.length });
        }
        if (onEvents !== undefined)
        {
            const notes = notesOf(chain, read);
            if (notes.length > 0)
            {
                onEvents(notes);
            }
        }
        from = to + 1;
    }
}

/** A new market as the chain describes it, read before the chunk that creates it is written. */
interface MarketRead {
    hydrated: Awaited<ReturnType<ChainReader['hydrateMarket']>>;
    kind: number;
}

/** Everything a chunk needs from the chain, gathered before its transaction opens. */
interface ChunkRead {
    logs: DecodedLog[];

    /** Block number -> its timestamp. */
    stamps: Map<bigint, number>;

    /** Lowercased address -> market id, for every market a log in the chunk can name: those the
     *  index held before it, and those the chunk itself creates. Anything else is not ours. */
    markets: Map<string, number>;

    /** Market id -> the clone's state, for every market the chunk creates. */
    created: Map<number, MarketRead>;

    /** Registry categories new markets carry that the index did not hold when the chunk was read. */
    categories: Map<number, CategoryState>;

    /** Lowercased market address -> its fee rate, for every market the chunk trades on. */
    feeBps: Map<string, bigint>;

    /** Market id -> its address, prices and liquidity, for every market the chunk touched. */
    touched: Map<number, { prices: number[]; liquidity: number }>;
}

/** The events that change what a market is worth, so its prices are re-read after the chunk. */
const TOUCHES = new Set(['PredictionPlaced', 'PredictionSold', 'BetPlaced', 'LiquidityAdded', 'LiquidityRemoved', 'RewardClaimed']);

/** The market a log is about: the FeeCollected argument, or the emitter for everything else. */
function subjectOf(entry: DecodedLog): string
{
    return entry.eventName === 'FeeCollected'
        ? String((entry.args as { market: Address }).market).toLowerCase()
        : entry.address.toLowerCase();
}

async function readChunk(store: IndexStore, chain: ChainReader, logs: DecodedLog[]): Promise<ChunkRead>
{
    const factory = chain.env.factory.toLowerCase();
    const stamps = new Map<bigint, number>();
    for (const entry of logs)
    {
        if (!stamps.has(entry.blockNumber))
        {
            stamps.set(entry.blockNumber, await chain.blockTimestamp(entry.blockNumber));
        }
    }

    // Which emitters are markets. Events are not address-filtered at the RPC, so most of a busy
    // chunk can be strangers - one read answers for all of them, and a market created inside the
    // chunk joins the set from its own creation log.
    const markets = await store.marketIdsByAddresses(logs.map(subjectOf));
    const created = new Map<number, MarketRead>();
    for (const entry of logs)
    {
        if (entry.eventName === 'MarketCreated' && entry.address.toLowerCase() === factory)
        {
            const args = entry.args as { marketId: bigint; market: Address };
            const marketId = Number(args.marketId);
            markets.set(args.market.toLowerCase(), marketId);
            const [hydrated, kind] = await Promise.all([chain.hydrateMarket(args.market), chain.marketKind(marketId)]);
            created.set(marketId, { hydrated, kind });
        }
    }

    // A market can only carry a category the factory already knows, so one the index has
    // never heard of means the index missed its registration - not that the market is
    // wrong. Read that single category now rather than leave the market showing a number.
    const categories = new Map<number, CategoryState>();
    const knownCategories = created.size === 0 ? new Set<number>() : await store.chainCategoryIds();
    for (const { hydrated } of created.values())
    {
        const id = Number(hydrated.category);
        if (isRegistryCategory(hydrated.category) && !knownCategories.has(id) && !categories.has(id))
        {
            const state = await readCategory(chain, id);
            if (state !== null)
            {
                categories.set(id, state);
            }
        }
    }

    // Which trade paid which fee. The market escrows every trade fee and forwards the lot to
    // the treasury in its resolve transaction (a cancel refunds it), so no trade has a receipt of
    // its own to pair with. It is recomputed from the trade instead - the only way to know what
    // a single ACCOUNT's trading has paid, since the markets table's total cannot be split back
    // apart per trader. Whether it was EARNED is the market's status, read at query time.
    const feeBps = new Map<string, bigint>();
    const touchedAt = new Map<number, Address>();
    for (const entry of logs)
    {
        const emitter = entry.address.toLowerCase();
        const marketId = markets.get(emitter);
        if (marketId === undefined)
        {
            continue;
        }
        if ((entry.eventName === 'PredictionPlaced' || entry.eventName === 'PredictionSold') && !feeBps.has(emitter))
        {
            let bps = feeBpsByMarket.get(emitter);
            if (bps === undefined)
            {
                bps = await chain.marketFeeBps(entry.address);
                feeBpsByMarket.set(emitter, bps);
            }
            feeBps.set(emitter, bps);
        }
        if (TOUCHES.has(entry.eventName))
        {
            touchedAt.set(marketId, entry.address);
        }
    }

    // A touched market's numbers are the chain's CURRENT ones, so reading them before the fold
    // rather than after it changes nothing they say.
    const touched = new Map<number, { prices: number[]; liquidity: number }>();
    for (const [marketId, address] of touchedAt)
    {
        const [prices, liquidity] = await Promise.all([chain.marketPrices(address), chain.marketLiquidity(address)]);
        touched.set(marketId, { prices, liquidity });
    }

    return { logs, stamps, markets, created, categories, feeBps, touched };
}

/** Folds one ordered chunk of logs into the store - inside the chunk's transaction, so nothing
 *  here may wait on the chain: whatever it needs was read by {@link readChunk}. */
async function foldChunk(store: IndexStore, chain: ChainReader, read: ChunkRead): Promise<void>
{
    const factory = chain.env.factory.toLowerCase();
    let lastAt = 0;

    for (const entry of read.logs)
    {
        const at = read.stamps.get(entry.blockNumber) ?? 0;
        lastAt = at;
        const emitter = entry.address.toLowerCase();
        const eventName = entry.eventName;

        if (eventName === 'MarketCreated')
        {
            if (emitter !== factory)
            {
                continue;
            }
            const marketId = Number((entry.args as { marketId: bigint }).marketId);
            const market = read.created.get(marketId);
            if (market !== undefined)
            {
                await ingestMarket(store, read, marketId, (entry.args as { market: Address }).market, market, at);
            }
            continue;
        }

        // The category registry lives on the factory and is not about any one market, so it
        // folds in before the market lookups below - and only from the factory itself.
        if (eventName === 'CategoryAdded' || eventName === 'CategoryEnabledSet')
        {
            if (emitter !== factory)
            {
                continue;
            }
            const args = entry.args as { categoryId: number; enabled?: boolean };
            await store.putChainCategory(Number(args.categoryId), args.enabled ?? true);
            continue;
        }

        if (eventName === 'CategoryMeaningSet')
        {
            if (emitter !== factory)
            {
                continue;
            }
            const args = entry.args as { categoryId: number; lang: string; meaning: string };
            const tag = langTag(args.lang);
            if (tag !== '')
            {
                await store.putChainCategoryName(Number(args.categoryId), tag, args.meaning);
            }
            continue;
        }

        // The TREASURY emits FeeCollected (depositFee), so the market comes from the event's
        // argument, not the emitter - the known-market lookup is still the spam filter.
        if (eventName === 'FeeCollected')
        {
            const args = entry.args as { market: Address; amount: bigint };
            const feeMarket = read.markets.get(args.market.toLowerCase());
            if (feeMarket !== undefined)
            {
                await store.addCollected(feeMarket, Number(args.amount) / 1e18);
            }
            continue;
        }

        const marketId = read.markets.get(emitter);
        if (marketId === undefined)
        {
            continue;
        }

        switch (eventName)
        {
            case 'PredictionPlaced': {
                const args = entry.args as { buyer: Address; outcome: bigint; amountIn: bigint; sharesOut: bigint };
                const amount = Number(args.amountIn) / 1e18;
                const shares = Number(args.sharesOut) / 1e18;
                await store.insertTrade({
                    id: `${ entry.blockNumber }-${ entry.logIndex }`,
                    market_id: marketId,
                    account: args.buyer.toLowerCase(),
                    outcome_idx: Number(args.outcome),
                    action: 'buy',
                    amount,
                    shares,
                    price: shares > 0 ? amount / shares : 0,
                    fee: tradeFee('buy', args.amountIn, read.feeBps.get(emitter) ?? 0n),
                    at,
                    block: Number(entry.blockNumber)
                });
                // The fill price is the HISTORICAL mark: a backfilled chart keeps its shape
                // instead of flattening to whatever the price is at ingest time.
                await store.insertPricePoint(
                    marketId,
                    Number(args.outcome),
                    at,
                    Math.min(1, Math.max(0, shares > 0 ? amount / shares : 0))
                );
                break;
            }
            case 'PredictionSold': {
                const args = entry.args as { seller: Address; outcome: bigint; sharesIn: bigint; amountOut: bigint };
                const amount = Number(args.amountOut) / 1e18;
                const shares = Number(args.sharesIn) / 1e18;
                await store.insertTrade({
                    id: `${ entry.blockNumber }-${ entry.logIndex }`,
                    market_id: marketId,
                    account: args.seller.toLowerCase(),
                    outcome_idx: Number(args.outcome),
                    action: 'sell',
                    amount,
                    shares,
                    price: shares > 0 ? amount / shares : 0,
                    fee: tradeFee('sell', args.amountOut, read.feeBps.get(emitter) ?? 0n),
                    at,
                    block: Number(entry.blockNumber)
                });
                await store.insertPricePoint(
                    marketId,
                    Number(args.outcome),
                    at,
                    Math.min(1, Math.max(0, shares > 0 ? amount / shares : 0))
                );
                break;
            }
            case 'BetPlaced': {
                const args = entry.args as { better: Address; outcome: bigint; amount: bigint };
                // Parimutuel bet: amount is stake, shares concept maps to stake for volume.
                const amount = Number(args.amount) / 1e18;
                await store.insertTrade({
                    id: `${ entry.blockNumber }-${ entry.logIndex }`,
                    market_id: marketId,
                    account: args.better.toLowerCase(),
                    outcome_idx: Number(args.outcome),
                    action: 'buy',
                    amount,
                    shares: amount,
                    price: 0,
                    // The pool takes its house fee off the whole pot at resolution, not off a bet.
                    fee: 0,
                    at,
                    block: Number(entry.blockNumber)
                });
                break;
            }
            case 'MarketResolved': {
                const args = entry.args as { winningOutcome: bigint };
                await store.setStatus(marketId, CHAIN_STATUS.resolved, Number(args.winningOutcome));
                break;
            }
            case 'MarketCancelled':
                await store.setStatus(marketId, CHAIN_STATUS.cancelled, null);
                break;
            case 'RewardClaimed': {
                const args = entry.args as { claimant: Address; amount: bigint };
                await store.insertClaim(
                    `${ entry.blockNumber }-${ entry.logIndex }`,
                    marketId,
                    args.claimant.toLowerCase(),
                    Number(args.amount) / 1e18,
                    at
                );
                break;
            }
            case 'TransferSingle': {
                const args = entry.args as { from: Address; to: Address; id: bigint; value: bigint };
                await applyTransfer(store, marketId, args.from, args.to, args.id, args.value, at);
                break;
            }
            case 'TransferBatch': {
                const args = entry.args as {
                    from: Address;
                    to: Address;
                    ids: readonly bigint[];
                    values: readonly bigint[];
                };
                for (const [i, id] of args.ids.entries())
                {
                    await applyTransfer(store, marketId, args.from, args.to, id, args.values[i] ?? 0n, at);
                }
                break;
            }
        }
    }

    for (const [marketId, { prices, liquidity }] of read.touched)
    {
        await store.setPrices(marketId, prices, liquidity, lastAt);
    }
}

/**
 * What a committed chunk reports. A SECOND pass rather than a push inside each branch of the
 * fold: it uses the same "is this emitter ours" test the fold did, so an unrelated contract
 * sharing an event signature is no more reportable than it is indexable.
 */
function notesOf(chain: ChainReader, read: ChunkRead): IndexedEvent[]
{
    const factory = chain.env.factory.toLowerCase();
    const notes: IndexedEvent[] = [];
    for (const entry of read.logs)
    {
        const emitter = entry.address.toLowerCase();
        const args = entry.args as Record<string, unknown>;
        let marketId: number | undefined;
        if (entry.eventName === 'MarketCreated')
        {
            if (emitter !== factory)
            {
                continue;
            }
            marketId = Number(args.marketId);
        }
        else
        {
            marketId = read.markets.get(subjectOf(entry));
        }
        if (marketId === undefined)
        {
            continue;
        }
        notes.push({
            event: entry.eventName,
            marketId,
            address: emitter,
            tx: entry.transactionHash ?? '',
            at: read.stamps.get(entry.blockNumber) ?? 0,
            args
        });
    }
    return notes;
}

async function applyTransfer(
    store: IndexStore,
    marketId: number,
    from: Address,
    to: Address,
    id: bigint,
    value: bigint,
    at: number
): Promise<void>
{
    const shares = Number(value) / 1e18;
    if (shares === 0)
    {
        return;
    }
    const tokenId = id.toString();
    if (from.toLowerCase() !== ZERO)
    {
        await store.applyBalanceDelta(from.toLowerCase(), marketId, tokenId, -shares, at);
    }
    if (to.toLowerCase() !== ZERO)
    {
        await store.applyBalanceDelta(to.toLowerCase(), marketId, tokenId, shares, at);
    }
}

/** Folds in a new market: the clone as {@link readChunk} read it, its envelopes decoded, its
 *  first price marks seeded. */
async function ingestMarket(
    store: IndexStore,
    read: ChunkRead,
    marketId: number,
    address: Address,
    market: MarketRead,
    at: number
): Promise<void>
{
    const { hydrated, kind } = market;

    // The category the index was missing when the chunk was read - unless a registry event
    // earlier in this same chunk has written it since.
    const category = Number(hydrated.category);
    const missing = read.categories.get(category);
    if (missing !== undefined && !(await store.hasChainCategory(category)))
    {
        await writeCategory(store, category, missing);
    }

    const strings = decodeMarketStrings(hydrated.title, hydrated.description, hydrated.category);
    // The title's languages WITHOUT its emoji or its tags, both of which are stored apart.
    const titleText = localizedOf(strings.title);
    const labels = hydrated.outcomeNames.map(outcomeLabel);
    const tags = marketTags(seedTags(strings.title.tags, hydrated.category));

    await store.insertMarket(
        {
            id: marketId,
            address: address.toLowerCase(),
            status: hydrated.status,
            category: hydrated.category,
            title_json: JSON.stringify(titleText),
            emoji: strings.title.emoji,
            rules_json: JSON.stringify(strings.rules),
            image: hydrated.imageURI,
            creator: hydrated.creator.toLowerCase(),
            created_at: hydrated.createdAt,
            lock_time: hydrated.lockTime,
            resolve_time: hydrated.resolveTime,
            outcome_count: hydrated.outcomeCount,
            volume: 0,
            liquidity: hydrated.liquidity,
            collected: 0,
            winning_outcome: null,
            featured: 0,
            search_text: searchText(titleText, strings.rules, hydrated.category, labels, tags),
            kind
        },
        labels.map((label, idx) => ({
            market_id: marketId,
            idx,
            oid: outcomeId(label.en, idx),
            label_json: JSON.stringify(localizedOf(label)),
            icon: label.icon,
            price: hydrated.prices[idx] ?? 0
        }))
    );
    await store.setMarketTags(marketId, tags);
    await store.setPrices(marketId, hydrated.prices, hydrated.liquidity, at);

    // A schema bump drops the markets table and replays it from the chain, which would also
    // undo any correction an admin has made to this market's text. The correction outlives
    // that on purpose - it is not chain state and cannot be re-derived - so it goes back on
    // immediately. A no-op for the overwhelming majority of markets, which have none.
    await reapply(store, marketId);
}
