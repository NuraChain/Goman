import { createPublicClient, http, parseAbiItem, type Address, type PublicClient } from 'viem';

import { loadConfig, num, str } from '@azerothjs/http';

import factoryAbi from './abis/prediction-factory.json' with { type: 'json' };
import marketAbi from './abis/prediction-market.json' with { type: 'json' };
import poolAbi from './abis/prediction-pool.json' with { type: 'json' };
import treasuryAbi from './abis/prediction-treasury.json' with { type: 'json' };

/** Pre-registry clones only: their category is a string they hold themselves. The current ABI
 *  has no such function, so it is spelled out rather than looked up. */
const LEGACY_CATEGORY = [parseAbiItem('function category() view returns (string)')];

// The chain half of the indexer: environment, the viem client, and the hydration reads.
// Everything is injected from main.ts AFTER the .env load - nothing here runs at import time.

export { factoryAbi, marketAbi, poolAbi, treasuryAbi };

export interface ChainEnv {
    rpcUrl: string;
    chainId: number;
    factory: Address;
    deployBlock: number;
    dbPath: string;
    pollMs: number;
}

/** Reads the chain environment; call after `process.loadEnvFile()`. */
export function loadChainEnv(): ChainEnv
{
    const config = loadConfig({
        rpcUrl: str('RPC_URL', { default: 'https://rpc.nurachain.net' }),
        chainId: num('CHAIN_ID', { default: 1020 }),
        factory: str('FACTORY_ADDRESS', { default: '0xA0f62E92c21425263eb944974B5A6A907e2873F9' }),
        deployBlock: num('DEPLOY_BLOCK', { default: 985251 }),
        dbPath: str('DB_PATH', { default: '.data/index.db' }),
        pollMs: num('POLL_MS', { default: 1500 })
    });
    return { ...config, factory: config.factory as Address };
}

/** The narrow chain surface the API handlers use; ChainReader implements it, tests stub it. */
export interface ChainGateway {
    env: ChainEnv;
    hasAdminRole(account: Address): Promise<boolean>;
    nativeBalance(account: Address): Promise<number>;
}

/** A market's full metadata, read from the clone once at discovery. */
export interface MarketHydration {
    title: string;
    description: string;
    category: string;
    imageURI: string;
    creator: Address;
    createdAt: number;
    lockTime: number;
    resolveTime: number;
    outcomeCount: number;
    outcomeNames: string[];
    prices: number[];
    liquidity: number;
    status: number;
}

/** The chain reads the indexer needs, over one shared public client. */
export class ChainReader
{
    public readonly client: PublicClient;
    public readonly env: ChainEnv;

    constructor(env: ChainEnv)
    {
        this.env = env;
        this.client = createPublicClient({ transport: http(env.rpcUrl) });
    }

    public async latestBlock(): Promise<bigint>
    {
        return this.client.getBlockNumber();
    }

    public async genesisHash(): Promise<string>
    {
        const block = await this.client.getBlock({ blockNumber: 0n });
        return block.hash ?? '0x';
    }

    public async blockTimestamp(blockNumber: bigint): Promise<number>
    {
        const block = await this.client.getBlock({ blockNumber });
        return Number(block.timestamp);
    }

    public async treasuryAddress(): Promise<Address>
    {
        return (await this.client.readContract({
            address: this.env.factory,
            abi: factoryAbi,
            functionName: 'treasury'
        })) as Address;
    }

    /**
     * Every category id the factory's registry holds.
     *
     * The registry is STATE, not a stream of events, and this is the only way to read it as
     * such. The index is normally filled by replaying `CategoryAdded`, which is exact right
     * up until the replay does not start early enough to contain one - a DEPLOY_BLOCK set
     * after a category was registered, or an index pointed at a chain mid-life. Those
     * categories then exist on chain, gate `createMarket`, and are invisible to every picker
     * and every market header, which show a bare id instead of a name.
     */
    public async categoryIds(): Promise<number[]>
    {
        const ids = (await this.client.readContract({
            address: this.env.factory,
            abi: factoryAbi,
            functionName: 'categoryIds'
        })) as readonly number[];
        return ids.map(Number);
    }

    /** Whether the registry knows a category, and whether it takes new markets. */
    public async categoryState(id: number): Promise<{ known: boolean; enabled: boolean }>
    {
        const [known, enabled] = (await this.client.readContract({
            address: this.env.factory,
            abi: factoryAbi,
            functionName: 'categoryState',
            args: [id]
        })) as readonly [boolean, boolean];
        return { known, enabled };
    }

    /** What a category is CALLED, per language tag, straight from the registry. */
    public async categoryMeanings(id: number): Promise<Array<{ lang: string; meaning: string }>>
    {
        const [langs, meanings] = (await this.client.readContract({
            address: this.env.factory,
            abi: factoryAbi,
            functionName: 'categoryMeanings',
            args: [id]
        })) as readonly [readonly string[], readonly string[]];
        return langs.map((lang, at) => ({ lang, meaning: meanings[at] ?? '' }));
    }

    public async marketKind(marketId: number): Promise<number>
    {
        try
        {
            return Number(
                await this.client.readContract({
                    address: this.env.factory,
                    abi: factoryAbi,
                    functionName: 'marketKind',
                    args: [BigInt(marketId)]
                })
            );
        }
        catch
        {
            return 0;
        }
    }

    public async hasAdminRole(account: Address): Promise<boolean>
    {
        const role = (await this.client.readContract({
            address: this.env.factory,
            abi: factoryAbi,
            functionName: 'ADMIN_ROLE'
        })) as `0x${ string }`;
        return (await this.client.readContract({
            address: this.env.factory,
            abi: factoryAbi,
            functionName: 'hasRole',
            args: [role, account]
        })) as boolean;
    }

    public async nativeBalance(account: Address): Promise<number>
    {
        return Number(await this.client.getBalance({ address: account })) / 1e18;
    }

    /** Reads everything a fresh market row needs, in one parallel burst. */
    public async hydrateMarket(market: Address): Promise<MarketHydration>
    {
        const read = <T>(functionName: string, args: unknown[] = []): Promise<T> =>
            this.client.readContract({ address: market, abi: marketAbi, functionName, args }) as Promise<T>;

        const [
            title,
            description,
            category,
            imageURI,
            creator,
            createdAt,
            lockTime,
            resolveTime,
            outcomeCount,
            status
        ] = await Promise.all([
            read<string>('title'),
            read<string>('description'),
            this.marketCategory(market),
            read<string>('imageURI'),
            read<Address>('creator'),
            read<bigint>('createdAt'),
            read<bigint>('lockTime'),
            read<bigint>('resolveTime'),
            read<bigint>('outcomeCount'),
            read<number>('status')
        ]);

        const count = Number(outcomeCount);
        const [names, prices, liquidity] = await Promise.all([
            Promise.all(Array.from({ length: count }, (_, i) => read<string>('outcomeName', [BigInt(i)]))),
            this.marketPrices(market),
            this.client.getBalance({ address: market }).then((wei) => Number(wei) / 1e18)
        ]);

        return {
            title,
            description,
            category,
            imageURI,
            creator,
            createdAt: Number(createdAt),
            lockTime: Number(lockTime),
            resolveTime: Number(resolveTime),
            outcomeCount: count,
            outcomeNames: names,
            prices,
            liquidity,
            status: Number(status)
        };
    }

    /**
     * The market's category, across both generations of the contracts.
     *
     * A clone deployed before the category registry carries its category as a STRING of its
     * own (`category()`); a newer one carries a `uint32` id into the factory's registry, where
     * the name lives once per language. The index keys on whichever the clone actually has, so
     * one chain can hold both eras - which it does, because the markets already deployed are
     * not going to be re-deployed.
     */
    private async marketCategory(market: Address): Promise<string>
    {
        try
        {
            const id = (await this.client.readContract({
                address: market,
                abi: marketAbi,
                functionName: 'categoryId'
            })) as number;
            return String(id);
        }
        catch
        {
            return (await this.client.readContract({
                address: market,
                abi: LEGACY_CATEGORY,
                functionName: 'category'
            })) as string;
        }
    }

    /** Current marginal prices as 0..1 floats. Pool markets use impliedOdds fallback. */
    public async marketPrices(market: Address): Promise<number[]>
    {
        try
        {
            const prices = (await this.client.readContract({
                address: market,
                abi: marketAbi,
                functionName: 'getPrices'
            })) as readonly bigint[];
            return prices.map((price) => Number(price) / 1e18);
        }
        catch
        {
            // PredictionPool has no getPrices; read impliedOdds per outcome.
            const outcomeCount = Number(
                (await this.client.readContract({
                    address: market,
                    abi: poolAbi,
                    functionName: 'outcomeCount'
                })) as bigint
            );
            const odds = await Promise.all(
                Array.from(
                    { length: outcomeCount },
                    (_, i) =>
                        this.client.readContract({
                            address: market,
                            abi: poolAbi,
                            functionName: 'impliedOdds',
                            args: [BigInt(i)]
                        }) as Promise<bigint>
                )
            );
            return odds.map((o) => Number(o) / 1e18);
        }
    }

    /** The market's native balance in ether units (the row's liquidity figure). */
    public async marketLiquidity(market: Address): Promise<number>
    {
        return Number(await this.client.getBalance({ address: market })) / 1e18;
    }

    /** The CPMM market's trade fee in basis points. Set once at initialization. */
    public async marketFeeBps(market: Address): Promise<bigint>
    {
        return BigInt(
            (await this.client.readContract({ address: market, abi: marketAbi, functionName: 'feeBps' })) as number
        );
    }
}
