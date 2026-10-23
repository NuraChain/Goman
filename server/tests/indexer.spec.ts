// The sync loop against a stubbed chain: what one chunk of logs leaves in the index, and that it
// leaves all of it or none. A chunk used to commit row by row, and a restart replayed it on top
// of whatever half had landed - a second copy of every balance delta, price mark and fee.
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { createLogger } from '@azerothjs/logger';
import type { IndexStore } from '../src/chain/store.ts';
import { syncOnce, type IndexedEvent } from '../src/chain/indexer.ts';
import type { ChainReader, MarketHydration } from '../src/chain/client.ts';
import { openTestStore } from './support/database.ts';

const FACTORY = '0xfac70aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MARKET = '0x0000000000000000000000000000000000000010';
const STRANGER = '0x00000000000000000000000000000000000000ff';
const ALICE = '0x4ac0000000000000000000000000000000003712';

const silent = createLogger({ level: 'silent' });

/** A decoded log as viem's getLogs hands it over. */
function log(eventName: string, address: string, block: number, logIndex: number, args: Record<string, unknown>): object
{
    return { eventName, address, blockNumber: BigInt(block), logIndex, transactionHash: `0x${ block }${ logIndex }`, args };
}

const created = log('MarketCreated', FACTORY, 10, 0, { marketId: 0n, market: MARKET });
const bought = log('PredictionPlaced', MARKET, 11, 0, {
    market: MARKET,
    buyer: ALICE,
    outcome: 0n,
    amountIn: 2_000_000_000_000_000_000n,
    sharesOut: 4_000_000_000_000_000_000n
});

const hydration: MarketHydration = {
    title: 'Will it rain?',
    description: 'Rules.',
    category: 'weather',
    imageURI: '',
    creator: '0x000000000000000000000000000000000000cafe',
    createdAt: 1_700_000_000,
    lockTime: 1_900_000_000,
    resolveTime: 1_900_000_100,
    outcomeCount: 2,
    outcomeNames: ['Yes', 'No'],
    prices: [0.5, 0.5],
    liquidity: 100,
    status: 0
};

/** A chain holding `logs` up to block `head`. Only the reads the sync loop makes are here. */
function stubChain(logs: object[], head = 20)
{
    const chain = {
        env: { rpcUrl: 'stub', chainId: 31337, factory: FACTORY, deployBlock: 0, pollMs: 1000 },
        client: {
            getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) =>
                logs.filter((entry) =>
                {
                    const block = (entry as { blockNumber: bigint }).blockNumber;
                    return block >= fromBlock && block <= toBlock;
                }))
        },
        latestBlock: vi.fn(async () => BigInt(head)),
        blockTimestamp: vi.fn(async (block: bigint) => 1_700_000_000 + Number(block)),
        hydrateMarket: vi.fn(async () => hydration),
        marketKind: vi.fn(async () => 0),
        marketFeeBps: vi.fn(async () => 100n),
        marketPrices: vi.fn(async () => [0.6, 0.4]),
        marketLiquidity: vi.fn(async () => 120)
    };
    return chain as unknown as ChainReader & typeof chain;
}

describe('one pass of the sync loop', () =>
{
    let store: IndexStore;

    beforeEach(async () =>
    {
        store = await openTestStore();
        await store.ensureChain('0xgenesis', FACTORY);
    });

    it('folds a market and its trade in, and moves the cursor to the head', async () =>
    {
        await syncOnce(store, stubChain([created, bought]), silent);

        const market = await store.marketById(0);
        expect(market?.volume).toBe(2);
        // The trade touched the market, so its numbers are the chain's current ones.
        expect(market?.liquidity).toBe(120);
        expect((await store.outcomesOf(0)).map((outcome) => outcome.price)).toEqual([0.6, 0.4]);
        expect((await store.tradesOfMarket(0, 10)).map((trade) => trade.fee)).toEqual([0.02]);
        expect(await store.cursor()).toBe(20);
    });

    it('writes nothing of a chunk whose transaction fails, and leaves the cursor where it was', async () =>
    {
        const chain = stubChain([created, bought]);
        const write = vi.spyOn(store, 'insertTrade').mockRejectedValueOnce(new Error('disk full'));

        await expect(syncOnce(store, chain, silent)).rejects.toThrow('disk full');
        expect(await store.marketById(0)).toBeNull();
        expect(await store.cursor()).toBe(-1);

        // The retry finds the chunk untouched, so the volume counts the trade exactly once.
        write.mockRestore();
        await syncOnce(store, chain, silent);
        expect((await store.marketById(0))?.volume).toBe(2);
        expect(await store.tradesCount()).toBe(1);
    });

    it('reads nothing of the chain inside the chunk it is writing', async () =>
    {
        // A node that fails mid-read fails the pass BEFORE any row is written.
        const chain = stubChain([created, bought]);
        chain.marketPrices.mockRejectedValueOnce(new Error('rate limited'));

        await expect(syncOnce(store, chain, silent)).rejects.toThrow('rate limited');
        expect(await store.marketById(0)).toBeNull();
        expect(await store.cursor()).toBe(-1);
    });

    it('ignores a contract that is not one of its markets, and never asks it a fee', async () =>
    {
        const chain = stubChain([log('PredictionPlaced', STRANGER, 11, 0, {
            buyer: ALICE,
            outcome: 0n,
            amountIn: 1n,
            sharesOut: 1n
        })]);

        await syncOnce(store, chain, silent);
        expect(await store.tradesCount()).toBe(0);
        expect(chain.marketFeeBps).not.toHaveBeenCalled();
        expect(await store.cursor()).toBe(20);
    });

    it('reports a chunk only once it is committed, and names its markets', async () =>
    {
        const seen: IndexedEvent[] = [];
        await syncOnce(store, stubChain([created, bought]), silent, (events) =>
        {
            seen.push(...events);
        });
        expect(seen.map((event) => [event.event, event.marketId])).toEqual([
            ['MarketCreated', 0],
            ['PredictionPlaced', 0]
        ]);
    });

    it('stops at a chunk boundary once told to', async () =>
    {
        const chain = stubChain([created, bought]);
        const stopping = new AbortController();
        stopping.abort();

        await syncOnce(store, chain, silent, undefined, stopping.signal);
        expect(chain.client.getLogs).not.toHaveBeenCalled();
        expect(await store.cursor()).toBe(-1);
    });
});
