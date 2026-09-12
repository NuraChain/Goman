import {
    createWalletClient,
    defineChain,
    http,
    parseAbiItem,
    parseEventLogs,
    type Address,
    type Hash,
    type PublicClient,
    type WalletClient
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { factoryAbi, type ChainEnv } from './client.ts';

// The ONLY place this server signs anything. Everywhere else it is a reader: markets are
// deployed and resolved from an admin's own wallet in the browser, and that stays true for
// every market a person creates. Two jobs cannot work that way, because both come due at an
// hour nobody is watching: a price round opens and settles every ten minutes, and a scheduled
// market has to come off pause the moment its start time arrives.
//
// It should be a key of its OWN, not the factory owner's: this one lives in a file on a server
// and needs only ADMIN_ROLE plus a seat in the resolution signer set. Losing it costs the
// rounds; losing the owner key costs the factory and the treasury.

/** Transaction receipts are waited for; beyond this the engine gives up and retries next tick. */
const RECEIPT_TIMEOUT_MS = 120_000;

export interface RoundSigner {
    readonly account: Address;

    /** Deploys a parimutuel market and returns its registry id, address, and the tx. */
    createPool(params: PoolParams): Promise<{ marketId: number; address: Address; hash: Hash }>;

    /** Ends betting. The engine's real lock - it never depends on the clone policing lockTime. */
    close(marketId: number): Promise<Hash>;

    /** Votes for an outcome; the last required confirmation resolves in the same transaction. */
    resolve(marketId: number, outcome: number): Promise<Hash>;

    /** Refunds every stake. Used when the two observations come out equal. */
    voidMarket(marketId: number): Promise<Hash>;

    /** Stops trading without ending the market - how a market waits for its start time. */
    pause(marketId: number): Promise<Hash>;

    /** Resumes a paused market: what a scheduled start time actually does when it arrives. */
    unpause(marketId: number): Promise<Hash>;
}

export interface PoolParams {
    title: string;
    description: string;

    /** The registry id to file the market under. The factory rejects one it does not know. */
    categoryId: number;
    imageURI: string;
    lockTime: number;
    resolveTime: number;
    feeBps: number;
    protocolFeeShareBps: number;
    outcomeNames: string[];
}

const CREATED_EVENT = parseAbiItem(
    'event MarketCreated(uint256 indexed marketId, address indexed market, address indexed creator, uint32 categoryId, uint256 outcomeCount, uint256 initialFunding)'
);

/**
 * Serialises every write through one promise chain. Two transactions signed in the same tick
 * would be handed the same nonce - viem reads it from the chain, and the chain does not know
 * about a transaction that has not landed yet.
 */
function serialiser(): (job: () => Promise<unknown>) => Promise<unknown> {
    let tail: Promise<unknown> = Promise.resolve();
    return (job) => {
        const next = tail.then(job, job);
        tail = next.catch(() => undefined);
        return next;
    };
}

/**
 * Builds the engine's signer.
 * @param env The chain environment the reader already loaded.
 * @param privateKey The engine's own key, `0x`-prefixed.
 * @param client The public client used to wait for receipts.
 */
export function createSigner(env: ChainEnv, privateKey: string, client: PublicClient): RoundSigner {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const chain = defineChain({
        id: env.chainId,
        name: 'chain',
        nativeCurrency: { name: 'Native', symbol: 'NATIVE', decimals: 18 },
        rpcUrls: { default: { http: [env.rpcUrl] } }
    });
    const wallet: WalletClient = createWalletClient({ account, chain, transport: http(env.rpcUrl) });
    const queue = serialiser();

    const write = (functionName: string, args: unknown[]): Promise<Hash> =>
        queue(() =>
            wallet.writeContract({ address: env.factory, abi: factoryAbi, functionName, args, chain, account })
        ) as Promise<Hash>;

    const settle = async (hash: Hash): Promise<void> => {
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
        if (receipt.status !== 'success') {
            throw new Error(`Transaction ${hash} reverted`);
        }
    };

    return {
        account: account.address,

        createPool: async (params) => {
            const hash = await write('createMarket2', [
                {
                    title: params.title,
                    description: params.description,
                    categoryId: params.categoryId,
                    imageURI: params.imageURI,
                    creator: account.address,
                    lockTime: BigInt(params.lockTime),
                    resolveTime: BigInt(params.resolveTime),
                    feeBps: params.feeBps,
                    protocolFeeShareBps: params.protocolFeeShareBps,
                    outcomeNames: params.outcomeNames
                }
            ]);
            const receipt = await client.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
            if (receipt.status !== 'success') {
                throw new Error(`Round deploy ${hash} reverted`);
            }
            const [log] = parseEventLogs({ abi: [CREATED_EVENT], logs: receipt.logs });
            if (log === undefined) {
                throw new Error(`Round deploy ${hash} emitted no MarketCreated`);
            }
            return { marketId: Number(log.args.marketId), address: log.args.market, hash };
        },

        close: async (marketId) => {
            const hash = await write('closeMarket', [BigInt(marketId)]);
            await settle(hash);
            return hash;
        },

        resolve: async (marketId, outcome) => {
            const hash = await write('confirmResolution', [BigInt(marketId), BigInt(outcome)]);
            await settle(hash);
            return hash;
        },

        voidMarket: async (marketId) => {
            const hash = await write('voidMarket', [BigInt(marketId)]);
            await settle(hash);
            return hash;
        },

        pause: async (marketId) => {
            const hash = await write('pauseMarket', [BigInt(marketId)]);
            await settle(hash);
            return hash;
        },

        unpause: async (marketId) => {
            const hash = await write('unpauseMarket', [BigInt(marketId)]);
            await settle(hash);
            return hash;
        }
    };
}
