import { parseAbiItem, type Address, type Log } from 'viem';

import type { Logger } from '../logger.ts';

import { decodeMarketStrings, marketTags, outcomeId, outcomeLabel, searchText, seedTags } from '../derive.ts';
import { isRegistryCategory, localizedOf } from '../wire.ts';
import { reapply } from '../overrides.ts';

import type { ChainReader } from './client.ts';
import type { IndexStore } from './store.ts';

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
    parseAbiItem('event MarketPaused(address indexed market)'),
    parseAbiItem('event MarketUnpaused(address indexed market)'),
    parseAbiItem('event MarketClosed(address indexed market)'),
    parseAbiItem('event MarketResolved(address indexed market, uint256 indexed winningOutcome)'),
    parseAbiItem('event MarketVoided(address indexed market)'),
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

/** A bytes8 language tag as the text it spells ("en"), trailing zero bytes dropped. */
function langTag(raw: string): string {
    const hex = raw.startsWith('0x') ? raw.slice(2) : raw;
    let tag = '';
    for (let i = 0; i + 1 < hex.length; i += 2) {
        const code = Number.parseInt(hex.slice(i, i + 2), 16);
        if (code === 0) {
            break;
        }
        tag += String.fromCharCode(code);
    }
    return tag.toLowerCase();
}

/** Blocks per getLogs call; local nodes handle large windows, live RPCs get modest ones. */
const CHUNK = 5000;

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
export async function syncCategories(store: IndexStore, chain: ChainReader, log: Logger): Promise<void> {
    const ids = await chain.categoryIds();
    const missing = ids.filter((id) => !store.hasChainCategory(id));
    if (missing.length === 0) {
        return;
    }
    for (const id of missing) {
        await readCategory(store, chain, id);
    }
    log.info('read categories the index was missing', { ids: missing.join(',') });
}

/** One category, straight from the registry: whether it is open, and what it is called. */
async function readCategory(store: IndexStore, chain: ChainReader, id: number): Promise<void> {
    const [state, meanings] = await Promise.all([chain.categoryState(id), chain.categoryMeanings(id)]);
    if (!state.known) {
        return;
    }
    store.putChainCategory(id, state.enabled);
    for (const entry of meanings) {
        const tag = langTag(entry.lang);
        if (tag !== '') {
            store.putChainCategoryName(id, tag, entry.meaning);
        }
    }
}

type DecodedLog = Log<bigint, number, false, undefined, true, typeof EVENTS>;

export interface IndexerHandle {
    /** Resolves once the index has caught up to the chain head for the first time. */
    ready: Promise<void>;
    stop(): void;
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

/** Called once per batch AFTER it is folded in, so a handler reading the store sees the
 *  result rather than the state before it. Never called with an empty batch. */
export type EventSink = (events: readonly IndexedEvent[]) => void;

/** Starts the background sync loop; resolves `ready` after the first full catch-up. */
export function startIndexer(store: IndexStore, chain: ChainReader, log: Logger, onEvents?: EventSink): IndexerHandle {
    let running = true;
    let resolveReady = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });

    const loop = async (): Promise<void> => {
        const wiped = store.ensureChain(await chain.genesisHash(), chain.env.factory);
        if (wiped) {
            log.warn('chain changed under the index - wiped and resyncing');
        }
        // Before the first catch-up, so the very first market folded in can already be shown
        // under the name of its category rather than under its number.
        try {
            await syncCategories(store, chain, log);
        } catch (error) {
            // A registry that cannot be read is not a reason to index nothing: the events
            // below still carry every category registered inside the replay window.
            log.error('could not read the category registry', { error: String(error) });
        }
        while (running) {
            try {
                await syncOnce(store, chain, log, onEvents);
                resolveReady();
            } catch (error) {
                log.error('sync failed', { error: String(error) });
            }
            await new Promise((resolve) => setTimeout(resolve, chain.env.pollMs));
        }
    };
    void loop();

    return {
        ready,
        stop: () => {
            running = false;
        }
    };
}

/** One catch-up pass: cursor+1 .. head, in chunks. */
export async function syncOnce(
    store: IndexStore,
    chain: ChainReader,
    log: Logger,
    onEvents?: EventSink
): Promise<void> {
    const head = Number(await chain.latestBlock());
    let from = store.cursor() + 1;
    from = Math.max(from, chain.env.deployBlock);
    while (from <= head) {
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
        await applyLogs(store, chain, logs, onEvents);
        store.setCursor(to);
        if (logs.length > 0) {
            log.info('indexed', { from, to, events: logs.length });
        }
        from = to + 1;
    }
}

/** Folds one ordered batch of logs into the store, then refreshes touched markets once. */
async function applyLogs(
    store: IndexStore,
    chain: ChainReader,
    logs: DecodedLog[],
    onEvents?: EventSink
): Promise<void> {
    const stamps = new Map<bigint, number>();
    for (const entry of logs) {
        if (!stamps.has(entry.blockNumber)) {
            stamps.set(entry.blockNumber, await chain.blockTimestamp(entry.blockNumber));
        }
    }

    // Which trade paid which fee. The market calls the treasury's depositFee inside the same
    // transaction it settles the trade in, so a FeeCollected and the PredictionPlaced or
    // PredictionSold that caused it share a transaction hash - that pairing is exact, and it
    // is the only way to know what a single ACCOUNT's trading has paid the protocol. The
    // markets table's running total cannot be split back apart per trader.
    //
    // A transaction that settles several trades on one market divides that market's receipt
    // between them. Even shares is an approximation, but the alternative - handing the whole
    // receipt to each of them - would multiply the fee, and referral earnings are paid from it.
    const receipts = new Map<string, number>();
    const settled = new Map<string, number>();
    for (const entry of logs) {
        if (entry.eventName === 'FeeCollected') {
            const args = entry.args as { market: Address; amount: bigint };
            const key = `${entry.transactionHash}|${args.market.toLowerCase()}`;
            receipts.set(key, (receipts.get(key) ?? 0) + Number(args.amount) / 1e18);
        } else if (
            entry.eventName === 'PredictionPlaced' ||
            entry.eventName === 'PredictionSold' ||
            entry.eventName === 'BetPlaced'
        ) {
            const key = `${entry.transactionHash}|${entry.address.toLowerCase()}`;
            settled.set(key, (settled.get(key) ?? 0) + 1);
        }
    }

    const feeOf = (entry: DecodedLog): number => {
        const key = `${entry.transactionHash}|${entry.address.toLowerCase()}`;
        return (receipts.get(key) ?? 0) / Math.max(1, settled.get(key) ?? 1);
    };

    const touched = new Map<number, Address>();
    let lastAt = 0;

    for (const entry of logs) {
        const at = stamps.get(entry.blockNumber) ?? 0;
        lastAt = at;
        const emitter = entry.address.toLowerCase();
        const eventName = entry.eventName;

        if (eventName === 'MarketCreated') {
            if (emitter !== chain.env.factory.toLowerCase()) {
                continue;
            }
            const args = entry.args as { marketId: bigint; market: Address };
            await ingestMarket(store, chain, Number(args.marketId), args.market, at);
            continue;
        }

        // The category registry lives on the factory and is not about any one market, so it
        // folds in before the market lookups below - and only from the factory itself.
        if (eventName === 'CategoryAdded' || eventName === 'CategoryEnabledSet') {
            if (emitter !== chain.env.factory.toLowerCase()) {
                continue;
            }
            const args = entry.args as { categoryId: number; enabled?: boolean };
            store.putChainCategory(Number(args.categoryId), args.enabled ?? true);
            continue;
        }

        if (eventName === 'CategoryMeaningSet') {
            if (emitter !== chain.env.factory.toLowerCase()) {
                continue;
            }
            const args = entry.args as { categoryId: number; lang: string; meaning: string };
            const tag = langTag(args.lang);
            if (tag !== '') {
                store.putChainCategoryName(Number(args.categoryId), tag, args.meaning);
            }
            continue;
        }

        // The TREASURY emits FeeCollected (depositFee), so the market comes from the event's
        // argument, not the emitter - the known-market lookup is still the spam filter.
        if (eventName === 'FeeCollected') {
            const args = entry.args as { market: Address; amount: bigint };
            const feeMarket = store.marketIdByAddress(args.market.toLowerCase());
            if (feeMarket !== null) {
                store.addCollected(feeMarket, Number(args.amount) / 1e18);
            }
            continue;
        }

        const marketId = store.marketIdByAddress(emitter);
        if (marketId === null) {
            continue;
        }

        switch (eventName) {
            case 'PredictionPlaced': {
                const args = entry.args as { buyer: Address; outcome: bigint; amountIn: bigint; sharesOut: bigint };
                const amount = Number(args.amountIn) / 1e18;
                const shares = Number(args.sharesOut) / 1e18;
                store.insertTrade({
                    id: `${entry.blockNumber}-${entry.logIndex}`,
                    market_id: marketId,
                    account: args.buyer.toLowerCase(),
                    outcome_idx: Number(args.outcome),
                    action: 'buy',
                    amount,
                    shares,
                    price: shares > 0 ? amount / shares : 0,
                    fee: feeOf(entry),
                    at,
                    block: Number(entry.blockNumber)
                });
                // The fill price is the HISTORICAL mark: a backfilled chart keeps its shape
                // instead of flattening to whatever the price is at ingest time.
                store.insertPricePoint(
                    marketId,
                    Number(args.outcome),
                    at,
                    Math.min(1, Math.max(0, shares > 0 ? amount / shares : 0))
                );
                touched.set(marketId, entry.address);
                break;
            }
            case 'PredictionSold': {
                const args = entry.args as { seller: Address; outcome: bigint; sharesIn: bigint; amountOut: bigint };
                const amount = Number(args.amountOut) / 1e18;
                const shares = Number(args.sharesIn) / 1e18;
                store.insertTrade({
                    id: `${entry.blockNumber}-${entry.logIndex}`,
                    market_id: marketId,
                    account: args.seller.toLowerCase(),
                    outcome_idx: Number(args.outcome),
                    action: 'sell',
                    amount,
                    shares,
                    price: shares > 0 ? amount / shares : 0,
                    fee: feeOf(entry),
                    at,
                    block: Number(entry.blockNumber)
                });
                store.insertPricePoint(
                    marketId,
                    Number(args.outcome),
                    at,
                    Math.min(1, Math.max(0, shares > 0 ? amount / shares : 0))
                );
                touched.set(marketId, entry.address);
                break;
            }
            case 'BetPlaced': {
                const args = entry.args as { better: Address; outcome: bigint; amount: bigint };
                // Parimutuel bet: amount is stake, shares concept maps to stake for volume.
                const amount = Number(args.amount) / 1e18;
                store.insertTrade({
                    id: `${entry.blockNumber}-${entry.logIndex}`,
                    market_id: marketId,
                    account: args.better.toLowerCase(),
                    outcome_idx: Number(args.outcome),
                    action: 'buy',
                    amount,
                    shares: amount,
                    price: 0,
                    fee: feeOf(entry),
                    at,
                    block: Number(entry.blockNumber)
                });
                touched.set(marketId, entry.address);
                break;
            }
            case 'LiquidityAdded':
            case 'LiquidityRemoved':
                touched.set(marketId, entry.address);
                break;
            case 'MarketPaused':
                store.setStatus(marketId, 1, null);
                break;
            case 'MarketUnpaused':
                store.setStatus(marketId, 0, null);
                break;
            case 'MarketClosed':
                store.setStatus(marketId, 2, null);
                break;
            case 'MarketResolved': {
                const args = entry.args as { winningOutcome: bigint };
                store.setStatus(marketId, 3, Number(args.winningOutcome));
                break;
            }
            case 'MarketVoided':
                store.setStatus(marketId, 4, null);
                break;
            case 'RewardClaimed': {
                const args = entry.args as { claimant: Address; amount: bigint };
                store.insertClaim(
                    `${entry.blockNumber}-${entry.logIndex}`,
                    marketId,
                    args.claimant.toLowerCase(),
                    Number(args.amount) / 1e18,
                    at
                );
                touched.set(marketId, entry.address);
                break;
            }
            case 'TransferSingle': {
                const args = entry.args as { from: Address; to: Address; id: bigint; value: bigint };
                applyTransfer(store, marketId, args.from, args.to, args.id, args.value, at);
                break;
            }
            case 'TransferBatch': {
                const args = entry.args as {
                    from: Address;
                    to: Address;
                    ids: readonly bigint[];
                    values: readonly bigint[];
                };
                args.ids.forEach((id, i) => {
                    applyTransfer(store, marketId, args.from, args.to, id, args.values[i] ?? 0n, at);
                });
                break;
            }
        }
    }

    for (const [marketId, address] of touched) {
        const [prices, liquidity] = await Promise.all([chain.marketPrices(address), chain.marketLiquidity(address)]);
        store.setPrices(marketId, prices, liquidity, lastAt);
    }

    // A SECOND pass rather than a push inside each branch above. It runs after the fold, so a
    // handler that looks a market up finds the one this batch just created; and it re-uses the
    // same "is this emitter ours" test the fold used, so an unrelated contract sharing an event
    // signature is no more reportable than it is indexable.
    if (onEvents !== undefined) {
        const notes: IndexedEvent[] = [];
        for (const entry of logs) {
            const emitter = entry.address.toLowerCase();
            const args = entry.args as Record<string, unknown>;
            let marketId: number | null;
            if (entry.eventName === 'MarketCreated') {
                if (emitter !== chain.env.factory.toLowerCase()) {
                    continue;
                }
                marketId = Number(args.marketId);
            } else if (entry.eventName === 'FeeCollected') {
                marketId = store.marketIdByAddress(String(args.market).toLowerCase());
            } else {
                marketId = store.marketIdByAddress(emitter);
            }
            if (marketId === null) {
                continue;
            }
            notes.push({
                event: entry.eventName,
                marketId,
                address: emitter,
                tx: entry.transactionHash ?? '',
                at: stamps.get(entry.blockNumber) ?? 0,
                args
            });
        }
        if (notes.length > 0) {
            onEvents(notes);
        }
    }
}

function applyTransfer(
    store: IndexStore,
    marketId: number,
    from: Address,
    to: Address,
    id: bigint,
    value: bigint,
    at: number
): void {
    const shares = Number(value) / 1e18;
    if (shares === 0) {
        return;
    }
    const tokenId = id.toString();
    if (from.toLowerCase() !== ZERO) {
        store.applyBalanceDelta(from.toLowerCase(), marketId, tokenId, -shares, at);
    }
    if (to.toLowerCase() !== ZERO) {
        store.applyBalanceDelta(to.toLowerCase(), marketId, tokenId, shares, at);
    }
}

/** Discovers a new market: hydrate the clone, decode envelopes, seed the first price marks. */
async function ingestMarket(
    store: IndexStore,
    chain: ChainReader,
    marketId: number,
    address: Address,
    at: number
): Promise<void> {
    const [hydrated, kind] = await Promise.all([chain.hydrateMarket(address), chain.marketKind(marketId)]);

    // A market can only carry a category the factory already knows, so one the index has
    // never heard of means the index missed its registration - not that the market is
    // wrong. Read that single category now rather than leave this market showing a number.
    if (isRegistryCategory(hydrated.category) && !store.hasChainCategory(Number(hydrated.category))) {
        await readCategory(store, chain, Number(hydrated.category));
    }

    const strings = decodeMarketStrings(hydrated.title, hydrated.description, hydrated.category);
    // The title's languages WITHOUT its emoji or its tags, both of which are stored apart.
    const titleText = localizedOf(strings.title);
    const labels = hydrated.outcomeNames.map(outcomeLabel);
    const tags = marketTags(seedTags(strings.title.tags, hydrated.category));

    store.insertMarket(
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
    store.setMarketTags(marketId, tags);
    store.setPrices(marketId, hydrated.prices, hydrated.liquidity, at);

    // A schema bump drops the markets table and replays it from the chain, which would also
    // undo any correction an admin has made to this market's text. The correction outlives
    // that on purpose - it is not chain state and cannot be re-derived - so it goes back on
    // immediately. A no-op for the overwhelming majority of markets, which have none.
    reapply(store, marketId);
}
